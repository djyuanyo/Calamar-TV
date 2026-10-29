<?php
/** Renewable HLS session, isolated from the working Zico relay. No network in this class. */
final class MadplayPlaybackFailure extends RuntimeException {
    public $upstreamStatus;
    public function __construct($message, $status = 0) { parent::__construct($message); $this->upstreamStatus = $status; }
}
final class MadplaySession {
    private $state, $resolve, $fetch, $clock, $secret, $match, $source;
    private $playlistDepth = 0;
    public function __construct($match, $source, &$state, callable $resolve, callable $fetch, callable $clock, $secret) {
        $this->match = $match; $this->source = $source; $this->state =& $state;
        $this->resolve = $resolve; $this->fetch = $fetch; $this->clock = $clock; $this->secret = $secret;
    }
    private function now() { return (int)call_user_func($this->clock); }
    private function authorise($force = false, $offeredSession = null) {
        if (!$force && isset($this->state['url']) && ($this->state['expires'] ?? 0) > $this->now()) return;
        // Bound API requests across concurrent players and persistent failures. Never loop on a 403.
        if (($this->state['attempted'] ?? -100) + 5 > $this->now()) throw new MadplayPlaybackFailure('La sesión todavía no se pudo renovar. Prueba de nuevo en unos segundos.');
        $this->state['attempted'] = $this->now();
        $session = call_user_func($this->resolve, $this->match, $this->source, $offeredSession);
        if (!is_array($session) || !isset($session['url']) || !preg_match('#^https://#', $session['url'])) throw new MadplayPlaybackFailure('El proveedor no entregó una sesión válida.');
        $this->state['url'] = $session['url'];
        $this->state['generation'] = ($this->state['generation'] ?? 0) + 1;
        // Opaque provider tokens must not be decoded to guess their expiry. Re-resolve at most once/minute.
        $this->state['expires'] = min($this->now() + 60, $session['expiresAt'] ?? ($this->now() + 60));
    }
    public static function resolveUrl($base, $part) {
        if (preg_match('#^https://#i', $part)) return $part;
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $part)) throw new MadplayPlaybackFailure('Protocolo de recurso no permitido.');
        $p = parse_url($base); $origin = 'https://' . ($p['host'] ?? '');
        if (substr($part, 0, 2) === '//') return 'https:' . $part;
        if (substr($part, 0, 1) === '?') return $origin . $p['path'] . $part;
        $joined = substr($part, 0, 1) === '/' ? $part : substr($p['path'], 0, strrpos($p['path'], '/') + 1) . $part;
        $queryAt = strpos($joined, '?'); $path = $queryAt === false ? $joined : substr($joined, 0, $queryAt); $suffix = $queryAt === false ? '' : substr($joined, $queryAt);
        $segments = []; foreach (explode('/', $path) as $s) { if ($s === '..') array_pop($segments); elseif ($s !== '.' && $s !== '') $segments[] = $s; }
        return $origin . '/' . implode('/', $segments) . $suffix;
    }
    private function request($url, $range = null) {
        $r = call_user_func($this->fetch, $url, $range);
        if (!is_array($r) || !isset($r['status'], $r['body'])) throw new MadplayPlaybackFailure('Respuesta incompleta del servidor de vídeo.');
        return $r;
    }
    private function expiryResponse($r) {
        $headers = array_change_key_case($r['headers'] ?? [], CASE_LOWER);
        return $r['status'] === 401 || ($r['status'] === 403 && (!empty($headers['rb-session']) || preg_match('/(?:token|session).*(?:expired|caduc)/i', $headers['rb-message'] ?? '')));
    }
    private function checked($r) {
        if ($r['status'] < 200 || $r['status'] >= 300) throw new MadplayPlaybackFailure('El servidor de vídeo rechaza la descarga (HTTP ' . $r['status'] . ').', $r['status']);
        if (preg_match('/^\s*(?:<!doctype\s+html|<html\b)/i', $r['body'])) throw new MadplayPlaybackFailure('El servidor devolvió una página en lugar del vídeo.');
        return $r;
    }
    public function playlist($asset = 'root') {
        if ($this->playlistDepth >= 8) throw new MadplayPlaybackFailure('Demasiados niveles de listas HLS.');
        $this->playlistDepth++;
        try { return $this->readPlaylist($asset); } finally { $this->playlistDepth--; }
    }
    private function readPlaylist($asset) {
        $this->authorise();
        $url = $asset === 'root' ? $this->state['url'] : $this->currentAssetUrl($asset);
        $r = $this->request($url);
        if ($this->expiryResponse($r)) {
            $headers = array_change_key_case($r['headers'] ?? [], CASE_LOWER);
            $this->authorise(true, $headers['rb-session'] ?? null);
            $url = $asset === 'root' ? $this->state['url'] : $this->currentAssetUrl($asset);
            $r = $this->request($url);
        }
        $this->checked($r);
        if (strpos(ltrim($r['body'], "\xef\xbb\xbf\r\n "), '#EXTM3U') !== 0) throw new MadplayPlaybackFailure('El proveedor no devolvió una lista HLS.');
        return $this->rewrite($r['body'], $r['url'] ?? $url, $asset);
    }
    private function assetUrl($id) {
        if (!isset($this->state['assets'][$id]) || $this->state['assets'][$id]['seen'] < $this->now() - 180) throw new MadplayPlaybackFailure('El fragmento ya no está en la ventana del directo.', 410);
        return $this->state['assets'][$id]['url'];
    }
    private function currentAssetUrl($id) {
        if (!isset($this->state['assets'][$id])) throw new MadplayPlaybackFailure('Recurso no disponible.', 404);
        if (($this->state['assets'][$id]['generation'] ?? 0) !== $this->state['generation']) {
            $this->playlist($this->state['assets'][$id]['parent']);
            if (($this->state['assets'][$id]['generation'] ?? 0) !== $this->state['generation']) throw new MadplayPlaybackFailure('El fragmento ha salido de la ventana del directo.', 410);
        }
        return $this->assetUrl($id);
    }
    public function segment($id, $range = null) {
        if (!isset($this->state['assets'][$id])) throw new MadplayPlaybackFailure('Recurso no disponible.', 404);
        $this->authorise();
        $r = $this->request($this->currentAssetUrl($id), $range);
        if ($this->expiryResponse($r)) {
            $headers = array_change_key_case($r['headers'] ?? [], CASE_LOWER);
            $this->authorise(true, $headers['rb-session'] ?? null);
            // Re-read parent lists: changing a root token leaves stale signatures on segments.
            $r = $this->request($this->currentAssetUrl($id), $range);
        }
        return $this->checked($r);
    }
    private function rewrite($list, $base, $parent) {
        $remember = function ($uri) use ($base, $parent) {
            $url = self::resolveUrl($base, $uri); $p = parse_url($uri); $path = $p['path'] ?? '';
            // A renewed query is the same media resource. Different renditions have different parents.
            parse_str($p['query'] ?? '', $query);
            foreach (['token','auth','expires','exp','_ver','_ctump','_ctuph','_ctutt','_s1'] as $key) unset($query[$key]);
            ksort($query); $identity = $path . '?' . http_build_query($query);
            $id = substr(hash_hmac('sha256', $this->match . '|' . $this->source . '|' . $parent . '|' . $identity, $this->secret), 0, 32);
            $this->state['assets'][$id] = ['url'=>$url, 'parent'=>$parent, 'seen'=>$this->now(), 'generation'=>$this->state['generation']];
            return '/calamar-madplay.php/match/' . $this->match . '/source/' . $this->source . '/asset/' . $id . (preg_match('/\.m3u8$/i', $path) ? '.m3u8' : '.bin');
        };
        $out = [];
        foreach (preg_split('/\r?\n/', $list) as $line) {
            if (trim($line) !== '' && substr($line, 0, 1) !== '#') $out[] = $remember(trim($line));
            else $out[] = preg_replace_callback('/URI="([^"\r\n]+)"/', function ($m) use ($remember) { return 'URI="' . $remember($m[1]) . '"'; }, $line);
        }
        foreach ($this->state['assets'] ?? [] as $id=>$item) if ($item['seen'] < $this->now() - 180) unset($this->state['assets'][$id]);
        if (count($this->state['assets'] ?? []) > 1000) throw new MadplayPlaybackFailure('La lista contiene demasiados recursos.');
        return implode("\n", $out);
    }
}
