<?php
// Player pages for the Calamar TV web player.
//  - GET page=…&hls=1: the app reads a player page (a web with the video inside) and plays its HLS list
//    itself; browsers cannot, because those video servers do not allow other webs (CORS). The hosting reads
//    the page as the app does (ZT_SOURCES lists, <video> tags, JW Player setups, packed or not) and relays
//    the list and its pieces with signed addresses (seg=…). Only pages of channels in the catalog are read.
//    Nothing is written to disk except a one-minute copy of the public catalog, but every minute watched
//    on the web passes through here.
//  - GET page=…&cast=1: the signed address of that list, which Chromecast loads from its own origin.

const PLAYER_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PLAYER_CATALOG = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom';
require_once __DIR__ . '/calamar-http-source.php';

function playerAnswer($data, $code = 200) {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8'); echo json_encode($data, JSON_UNESCAPED_SLASHES); exit;
}

/** Key that signs relayed addresses, so this file only relays what it handed out itself. */
function playerSecret() {
    if (getenv('CALAMAR_PLAYER_SECRET')) return getenv('CALAMAR_PLAYER_SECRET');
    $path = dirname(__DIR__) . '/calamar-player-secret.php';
    $saved = is_file($path) ? @include $path : null;
    if (is_string($saved) && strlen($saved) >= 32) return $saved;
    $secret = bin2hex(random_bytes(32));
    if (@file_put_contents($path, '<?php return ' . var_export($secret, true) . ";\n", LOCK_EX) !== false) @chmod($path, 0600);
    return $secret;
}
function playerZicoConfigPath() {
    return getenv('CALAMAR_ZICO_CONFIG') ?: dirname(__DIR__) . '/calamar-zico-config.php';
}
function playerZicoTokenValid($token) {
    return is_string($token) && preg_match('/^[!-~]{16,512}$/D', $token);
}
function playerZicoToken() {
    static $token;
    if ($token !== null) return $token;
    $path = playerZicoConfigPath();
    $saved = is_file($path) ? @include $path : null;
    return $token = playerZicoTokenValid($saved) ? $saved : '';
}
function playerSaveZicoToken($token) {
    $path = playerZicoConfigPath();
    $dir = realpath(dirname($path));
    $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? '/nonexistent');
    if ($dir === false || ($public !== false && ($dir === $public || strpos($dir, $public . DIRECTORY_SEPARATOR) === 0))) return false;
    $temp = @tempnam($dir, '.calamar-zico-');
    if ($temp === false) return false;
    try {
        if (!@chmod($temp, 0600) || @file_put_contents($temp, '<?php return ' . var_export($token, true) . ";\n", LOCK_EX) === false
            || !@rename($temp, $path)) return false;
        if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
        return true;
    } finally { if (is_file($temp)) @unlink($temp); }
}
function playerZicoConfig($method) {
    $answer = ['zicoConfig' => 1];
    if ($method === 'GET') playerAnswer($answer + ['configured' => playerZicoToken() !== '']);
    if ($method !== 'POST') playerAnswer($answer + ['error' => 'Método no permitido.'], 405);
    $images = __DIR__ . '/calamar-images.php';
    if (!is_file($images)) playerAnswer($answer + ['error' => 'Falta calamar-images.php en el hosting.'], 503);
    require_once $images;
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    try {
        $admin = preg_match('/^Bearer ([A-Za-z0-9_.-]{1,8192})$/D', $header, $auth) && imageAdministrator($auth[1]);
    } catch (Throwable $error) { playerAnswer($answer + ['error' => 'No se pudo verificar la sesión de Google.'], 502); }
    if (!$admin) playerAnswer($answer + ['error' => 'Entra con la cuenta administradora de Google.'], 401);
    $raw = file_get_contents('php://input', false, null, 0, 4097);
    $data = is_string($raw) && strlen($raw) <= 4096 ? json_decode($raw, true) : null;
    $token = $data['token'] ?? null;
    if ($token !== '' && !playerZicoTokenValid($token)) playerAnswer($answer + ['error' => 'El token tiene un formato no válido.'], 400);
    if (!playerSaveZicoToken($token)) playerAnswer($answer + ['error' => 'El hosting no pudo guardar el token fuera de la carpeta pública.'], 503);
    playerAnswer($answer + ['configured' => $token !== '']);
}

function playerZicoPage($url) {
    if (!is_string($url)) return '';
    $p = parse_url($url);
    if (($p['scheme'] ?? '') !== 'https' || !in_array(strtolower($p['host'] ?? ''), ['bp.zicotv.cc', 'zicotv.cc'], true)
        || isset($p['user']) || isset($p['port']) || isset($p['fragment'])
        || !preg_match('#^/(?:api/player|channels)/([0-9]{1,16})/?$#D', $p['path'] ?? '', $id)) return '';
    return 'https://bp.zicotv.cc/api/player/' . $id[1];
}
function playerZicoProof($page, $event, $secret) {
    return substr(hash_hmac('sha256', "zico-event\n" . $page . "\n" . $event, $secret), 0, 32);
}
function playerZicoSignedSource($page, $catalog, $secret) {
    $clean = playerZicoPage($page);
    $query = parse_url($page, PHP_URL_QUERY);
    if ($clean === '' || !is_string($query) || !preg_match('/^ct_event=([0-9]{1,16})&ct_sig=([a-f0-9]{32})$/D', $query, $m)) return false;
    $event = 'https://bp.zicotv.cc/events/' . $m[1];
    return isset($catalog[$event]) && hash_equals(playerZicoProof($clean, $event, $secret), $m[2]);
}
function playerContainsZicoToken($value, $token) {
    if ($token === '' || !is_string($value)) return false;
    for ($i = 0; $i < 3; $i++) {
        if (strpos($value, $token) !== false) return true;
        $decoded = rawurldecode($value);
        if ($decoded === $value) break;
        $value = $decoded;
    }
    return false;
}
function playerOpenPage($page, $token, $get = 'playerGet') {
    $clean = playerZicoPage($page);
    $query = parse_url($page, PHP_URL_QUERY);
    if ($clean !== '' && preg_match('#^/channels/[0-9]+/?$#D', parse_url($page, PHP_URL_PATH) ?: '')) $query = null;
    if ($clean === '' || ($query !== null && !preg_match('/^ct_event=[0-9]+&ct_sig=[a-f0-9]{32}$/D', $query))) return $get($page, '');
    if ($token === '') return $get($clean, '');
    // The documented credential only goes to this exact player host. Its URL is never returned or used as a Referer.
    [$status, $body] = $get($clean . '?token=' . rawurlencode($token), 'https://calamarmenciano.com/', 3145728, 1);
    return [$status, $body, $clean];
}

/** Read JSON configuration, never execute JavaScript returned by a provider. */
function playerJsonConfig($html, $name) {
    if (!is_string($html) || !preg_match('/\b(?:var|let|const)\s+' . preg_quote($name, '/') . '\s*=\s*/', $html, $m, PREG_OFFSET_CAPTURE)) return null;
    $start = $m[0][1] + strlen($m[0][0]);
    if (substr($html, $start, 4) === 'true') return true;
    if (substr($html, $start, 5) === 'false') return false;
    if (!isset($html[$start]) || !in_array($html[$start], ['{', '['], true)) return null;
    $depth = 0; $quoted = false; $escaped = false;
    for ($i = $start, $end = min(strlen($html), $start + 262144); $i < $end; $i++) {
        $c = $html[$i];
        if ($quoted) { if ($escaped) $escaped = false; elseif ($c === '\\') $escaped = true; elseif ($c === '"') $quoted = false; }
        elseif ($c === '"') $quoted = true;
        elseif ($c === '{' || $c === '[') $depth++;
        elseif (($c === '}' || $c === ']') && --$depth === 0) return json_decode(substr($html, $start, $i - $start + 1), true);
    }
    return null;
}

/** Zico now publishes null URLs in cacheable HTML and supplies them through a signed POST. */
function playerZicoRenewSources($html, $page, $post = 'playerPost') {
    $clean = playerZicoPage($page);
    $renew = playerJsonConfig($html, 'ZT_RENEW');
    if ($clean === '' || !is_array($renew)) return null; // Older players still expose ZT_SOURCES directly.
    if (!empty($renew['conn']) || playerJsonConfig($html, 'ZT_SRC_GATE') !== null
        || playerJsonConfig($html, 'ZT_CONN_LIMIT') === true || playerJsonConfig($html, 'ZT_PREMIUM_GATE') === true
        || playerJsonConfig($html, 'ZT_APP_GATE') === true)
        throw new RuntimeException('ZicoTV requiere verificar el acceso o gestionar la sesión en su reproductor oficial.');
    $url = playerResolve($page, is_string($renew['url'] ?? null) ? $renew['url'] : '');
    $p = parse_url($url); $base = parse_url($page);
    $id = basename(parse_url($clean, PHP_URL_PATH));
    if (!is_array($p) || ($p['scheme'] ?? '') !== 'https' || ($p['host'] ?? '') !== ($base['host'] ?? '')
        || isset($p['user']) || isset($p['port']) || isset($p['fragment']) || ($p['path'] ?? '') !== '/api/player/' . $id . '/renew'
        || !preg_match('/^expires=[0-9]{10}&signature=[a-f0-9]{64}$/D', $p['query'] ?? ''))
        throw new RuntimeException('ZicoTV ha devuelto una ruta de renovación no compatible.');
    [$status, $body] = $post($url, $page, ['native' => false]);
    $data = is_string($body) ? json_decode($body, true) : null;
    if ($status !== 200 || !is_array($data) || !is_array($data['sources'] ?? null))
        throw new RuntimeException('ZicoTV no ha entregado las señales al renovar (HTTP ' . (int)$status . ').');
    if (!empty($data['over']) || !empty($data['blocked'])) throw new RuntimeException('ZicoTV ha rechazado esta sesión de reproducción.');
    $entries = [];
    foreach (array_slice($data['sources'], 0, 100) as $source) {
        if (!is_array($source) || !empty($source['locked']) || !empty($source['off']) || !empty($source['hidden'])) continue;
        $address = $source['url'] ?? null; $parts = is_string($address) ? parse_url($address) : false;
        if (!is_array($parts) || strlen($address) > 8192 || preg_match('/[\r\n]/', $address)
            || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['fragment'])
            || !preg_match('/\.m3u8$/i', $parts['path'] ?? '')) continue;
        $entries[$address] = ['url' => $address, 'label' => (string)($source['label'] ?? 'Señal')];
    }
    // The provider shuffles CDNs at every renewal. Keep source menu identities and ordering stable.
    $entries = array_values($entries);
    usort($entries, function ($a, $b) { return strcmp(playerSourceId($a['url']), playerSourceId($b['url'])); });
    return ['sources' => $entries, 'ttl' => max(1, min(10800, (int)($data['ttl'] ?? 300)))];
}
function playerSourceId($url) {
    $p = parse_url($url);
    return substr(hash('sha256', ($p['scheme'] ?? '') . '://' . ($p['host'] ?? '') . ':' . ($p['port'] ?? 443) . ($p['path'] ?? '')), 0, 16);
}
/** Credential-scoped private cache; concurrent viewers reuse a token only for non-session-gated players. */
function playerZicoCacheFile($page, $token) {
    $dir = getenv('CALAMAR_ZICO_CACHE') ?: dirname(__DIR__) . '/calamar-zico-cache';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) return '';
    $dir = realpath($dir); $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? '/nonexistent');
    if (!$dir || ($public && ($dir === $public || strpos($dir, $public . DIRECTORY_SEPARATOR) === 0))) return '';
    return $dir . '/' . hash('sha256', playerZicoPage($page) . "\n" . $token) . '.json';
}
function playerZicoCurrent($page, $token, $force = false, $get = 'playerGet', $post = 'playerPost') {
    $cache = playerZicoCacheFile($page, $token);
    $saved = $cache !== '' && is_file($cache) ? json_decode((string)@file_get_contents($cache), true) : null;
    if (!$force && is_array($saved) && ($saved['until'] ?? 0) > time() && is_array($saved['sources'] ?? null)) return $saved;
    [$status, $html, $final] = playerOpenPage($page, $token, $get);
    if ($status !== 200 || !is_string($html)) throw new RuntimeException('La página de ZicoTV no responde (HTTP ' . (int)$status . ').');
    $current = playerZicoRenewSources($html, $final, $post);
    $renewal = $current !== null;
    if ($current === null) {
        $current = ['ttl' => 300, 'sources' => array_map(function ($url) { return ['url' => $url, 'label' => 'Señal']; }, playerIsList($html) ? [$final] : playerSources($html, $final))];
    }
    $current['sources'] = array_values(array_filter($current['sources'], function ($entry) use ($token) { return !playerContainsZicoToken($entry['url'], $token); }));
    $current['page'] = $final;
    $current['renewal'] = $renewal;
    $current['preferred'] = $saved['preferred'] ?? '';
    $current['until'] = time() + min(300, max(1, $current['ttl'] - 90));
    if ($current['sources'] && $cache !== '') {
        $temp = @tempnam(dirname($cache), '.sources-');
        if ($temp !== false) { @chmod($temp, 0600); if (@file_put_contents($temp, json_encode($current), LOCK_EX) !== false) @rename($temp, $cache); if (is_file($temp)) @unlink($temp); }
    }
    return $current;
}
function playerZicoRememberSource($page, $token, $url) {
    $cache = playerZicoCacheFile($page, $token);
    $data = $cache !== '' && is_file($cache) ? json_decode((string)@file_get_contents($cache), true) : null;
    if (!is_array($data) || !is_array($data['sources'] ?? null)) return;
    $id = playerSourceId($url);
    foreach ($data['sources'] as $entry) if (playerSourceId($entry['url']) === $id) {
        $data['preferred'] = $id;
        $temp = @tempnam(dirname($cache), '.sources-');
        if ($temp !== false) { @chmod($temp, 0600); if (@file_put_contents($temp, json_encode($data), LOCK_EX) !== false) @rename($temp, $cache); if (is_file($temp)) @unlink($temp); }
        return;
    }
}
/** Repair an expiring signed playlist on the same CDN; do not switch the user's signal or decoder. */
function playerZicoCatalogPage($page, $catalog = null) {
    $catalog = $catalog === null ? playerCatalogStreams() : $catalog;
    if (playerZicoSignedSource($page, $catalog, playerSecret())) return true;
    $clean = playerZicoPage($page);
    if ($clean === '') return false;
    foreach ($catalog as $saved => $_) if (playerZicoPage($saved) === $clean) return true;
    return false;
}
function playerZicoFreshPlaylist($url, $page, $force = false, $lookup = 'playerZicoCurrent', $authorize = 'playerZicoCatalogPage') {
    if (playerZicoPage($page) === '') return $url;
    $old = parse_url($url); parse_str($old['query'] ?? '', $query);
    $expiry = null;
    foreach (['e', 'expires'] as $key) if (isset($query[$key]) && is_string($query[$key]) && preg_match('/^[0-9]{10}$/D', $query[$key])) $expiry = (int)$query[$key];
    if (is_string($query['token'] ?? null) && preg_match('/(?:^|-)([0-9]{10})(?:-|$)/', $query['token'], $m)) $expiry = (int)$m[1];
    if (!$force && ($expiry === null || $expiry > time() + 90)) return $url;
    // An old relay signature must not keep renewing a channel removed from the catalog.
    if (!$authorize($page)) return $url;
    try { $current = $lookup($page, playerZicoToken(), $force); } catch (RuntimeException $error) { return $url; }
    foreach ($current['sources'] as $entry) {
        $fresh = parse_url($entry['url']);
        if (($old['scheme'] ?? '') !== ($fresh['scheme'] ?? '') || ($old['host'] ?? '') !== ($fresh['host'] ?? '')
            || ($old['port'] ?? 443) !== ($fresh['port'] ?? 443)) continue;
        if (($old['path'] ?? '') === ($fresh['path'] ?? '')) return $entry['url'];
        $directory = rtrim(dirname($fresh['path'] ?? ''), '/') . '/';
        if ($directory === '/' || strpos($old['path'] ?? '', $directory) !== 0 || strpos($old['path'], '..') !== false
            || !preg_match('/\.m3u8$/i', $old['path'])) continue;
        parse_str($fresh['query'] ?? '', $credentials);
        if (!is_string($credentials['token'] ?? null)) continue;
        $query['token'] = $credentials['token'];
        foreach (['e', 'expires'] as $key) if (isset($credentials[$key])) $query[$key] = $credentials[$key];
        return $old['scheme'] . '://' . $old['host'] . (isset($old['port']) ? ':' . $old['port'] : '') . $old['path'] . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }
    return $url;
}
function playerZicoEventSources($data, $event, $catalog, $secret, $token) {
    $sources = [];
    foreach (($data['data']['sources'] ?? []) as $source) {
        if (!is_array($source)) continue;
        $url = $source['player_url'] ?? $source['url'] ?? '';
        $clean = playerZicoPage($url);
        if ($clean === '') continue;
        if ((!empty($source['is_premium']) || !empty($source['locked'])) && ($token === '' || ($source['source'] ?? '') !== 'own')) continue;
        if ($token === '' && !empty(parse_url($url, PHP_URL_QUERY))) continue;
        if ($event === 'https://bp.zicotv.cc/events/' . basename($event) && !isset($catalog[$clean])) {
            $clean .= '?ct_event=' . basename($event) . '&ct_sig=' . playerZicoProof($clean, $event, $secret);
        } elseif (!isset($catalog[$clean]) && $token === '') {
            $clean = $url;
        }
        $name = (string)($source['name'] ?? 'Fuente del evento');
        if (playerContainsZicoToken($name, $token)) $name = 'Fuente del evento';
        $sources[$clean] = ['name' => $name, 'player_url' => $clean];
    }
    return array_values($sources);
}

function playerB64($text) { return rtrim(strtr(base64_encode($text), '+/', '-_'), '='); }
function playerUnB64($text) { return base64_decode(strtr((string)$text, '-_', '+/'), true); }
/** The page the video comes from goes with each piece: its servers only answer visits from that page. */
function playerSign($url, $page, $secret) { return substr(hash_hmac('sha256', $url . "\n" . $page, $secret), 0, 32); }
function playerRelayed($url, $page, $secret) {
    $token = playerZicoToken();
    if (playerContainsZicoToken($url, $token) || playerContainsZicoToken($page, $token))
        playerAnswer(['error' => 'No se pudo preparar una dirección segura del vídeo.'], 502);
    return 'calamar-player.php?seg=' . playerB64($url) . '&p=' . playerB64($page) . '&sig=' . playerSign($url, $page, $secret);
}

/** An address in a page or list, made absolute against the page's or list's own address. */
function playerResolve($base, $ref) {
    $ref = trim(html_entity_decode($ref, ENT_QUOTES));
    if (preg_match('#^https?://#i', $ref)) return $ref;
    $u = parse_url($base);
    $origin = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    if (strpos($ref, '//') === 0) return $u['scheme'] . ':' . $ref;
    if ($ref !== '' && $ref[0] === '/') return $origin . $ref;
    if ($ref !== '' && $ref[0] === '?') return $origin . ($u['path'] ?? '/') . $ref;
    return $origin . preg_replace('#/[^/]*$#', '/', $u['path'] ?? '/') . $ref;
}

/** Every address of an HLS list (variants, pieces, keys, subtitles) goes through the relay. */
function playerRewrite($list, $base, $page, $secret) {
    if (playerContainsZicoToken($list, playerZicoToken())) playerAnswer(['error' => 'No se pudo preparar una lista segura del vídeo.'], 502);
    $out = array();
    foreach (preg_split('/\r?\n/', $list) as $line) {
        $trimmed = trim($line);
        if ($trimmed === '') { $out[] = $line; continue; }
        if ($trimmed[0] !== '#') { $out[] = playerRelayed(playerResolve($base, $trimmed), $page, $secret); continue; }
        $out[] = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($base, $page, $secret) {
            return 'URI="' . playerRelayed(playerResolve($base, $m[1]), $page, $secret) . '"';
        }, $line);
    }
    return implode("\n", $out);
}

// Players often pack their setup with Dean Edwards' p,a,c,k,e,d: each word is an index into a list.
function playerUnpack($m) {
    $payload = str_replace(array("\\'", '\\\\'), array("'", '\\'), $m[1]);
    $base = (int)$m[2]; $words = explode('|', $m[4]);
    if ($base < 2 || $base > 62) return '';
    $digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return preg_replace_callback('/\b\w+\b/', function ($t) use ($base, $words, $digits) {
        $index = 0;
        foreach (str_split($t[0]) as $c) {
            $d = strpos($digits, $c);
            if ($d === false || $d >= $base || $index > PHP_INT_MAX / 64) return $t[0];
            $index = $index * $base + $d;
        }
        return isset($words[$index]) && $words[$index] !== '' ? $words[$index] : $t[0];
    }, $payload);
}

/** The ZT_SOURCES list of a page (var ZT_SOURCES = [...]), or null when it has none. */
function playerZtSources($html) {
    if (!preg_match('/\b(?:var|let|const)\s+ZT_SOURCES\s*=\s*(\[)/', $html, $m, PREG_OFFSET_CAPTURE)) return null;
    $start = $m[1][1]; $depth = 0; $quoted = false; $escaped = false;
    for ($i = $start, $n = strlen($html); $i < $n; $i++) {
        $c = $html[$i];
        if ($quoted) { if ($escaped) $escaped = false; elseif ($c === '\\') $escaped = true; elseif ($c === '"') $quoted = false; }
        elseif ($c === '"') $quoted = true;
        elseif ($c === '[') $depth++;
        elseif ($c === ']' && --$depth === 0) {
            $list = json_decode(substr($html, $start, $i - $start + 1), true);
            return is_array($list) ? $list : array();
        }
    }
    return array();
}

/** The video addresses a player page exposes, in its own order. Same rules as VideoResolver.parse() in the app. */
function playerSources($html, $page) {
    $found = array();
    $add = function ($value) use (&$found, $page) {
        if (!is_string($value) || $value === '') return;
        $value = html_entity_decode(str_replace('\\/', '/', $value), ENT_QUOTES | ENT_HTML5);
        $value = str_replace('\\u0026', '&', $value);
        if (strlen($value) > 8192 || preg_match('/[\r\n]/', $value)) return;
        $url = playerResolve($page, $value);
        $parts = parse_url($url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) return;
        $path = strtolower(parse_url($url, PHP_URL_PATH) ?: '');
        if (preg_match('#^https://#i', $url) && preg_match('/\.(m3u8|mp4|webm)$/', $path) && !in_array($url, $found, true)) $found[] = $url;
    };
    $zt = playerZtSources($html);
    if ($zt !== null) {
        // Locked sources are never picked up from elsewhere in the same page.
        foreach ($zt as $s) if (is_array($s) && empty($s['locked'])) $add($s['url'] ?? '');
        return $found;
    }
    if (preg_match_all('/<(?:video|source)\b[^>]*\bsrc\s*=\s*(["\'])(.*?)\1/is', $html, $tags, PREG_SET_ORDER))
        foreach ($tags as $t) $add($t[2]);
    if ($found) return $found;
    $scripts = $html;
    if (preg_match_all("/\}\('((?:[^'\\\\]++|\\\\.)*+)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\\\]++|\\\\.)*+)'\.split\('\|'\)/", $html, $packed, PREG_SET_ORDER))
        foreach ($packed as $m) $scripts .= "\n" . playerUnpack($m);
    $scripts = str_replace('\\/', '/', $scripts);
    if (preg_match_all('/\b(?:file|src|source|url)\s*[:=]\s*(["\'])(https:\/\/[^"\']+)\1/i', $scripts, $files, PREG_SET_ORDER))
        foreach ($files as $f) $add($f[2]);
    if (preg_match_all('/\b(?:loadSource|setSource)\s*\(\s*(["\'])(https:\/\/[^"\']+)\1\s*\)/i', $scripts, $files, PREG_SET_ORDER))
        foreach ($files as $f) $add($f[2]);
    return $found;
}

/** The channel addresses of the public catalog; a copy is kept for a minute so pages do not wait for it. */
function playerCatalogStreams($fetch = null) {
    $cache = sys_get_temp_dir() . '/calamar-player-catalog.json';
    $json = is_file($cache) && time() - filemtime($cache) < 60 ? @file_get_contents($cache) : false;
    if ($json === false) {
        $fresh = $fetch ? $fetch(PLAYER_CATALOG) : null;
        if ($fresh === null) {
            $ch = curl_init(PLAYER_CATALOG);
            curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10));
            $body = curl_exec($ch);
            $ok = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
            curl_close($ch);
            $document = $ok && is_string($body) ? json_decode($body, true) : null;
            $fresh = $document['fields']['json']['stringValue'] ?? null;
        }
        if (is_string($fresh)) { $json = $fresh; @file_put_contents($cache, $json, LOCK_EX); }
        elseif (is_file($cache)) $json = @file_get_contents($cache); // Firestore down: the last copy still works.
    }
    $catalog = is_string($json) ? json_decode($json, true) : null;
    $streams = array();
    foreach (array('channels', 'events', 'fixtures') as $kind)
        foreach (($catalog[$kind] ?? array()) as $entry)
            foreach ((is_array($entry) ? ($entry['streams'] ?? array()) : array()) as $url)
                if (is_string($url)) $streams[trim($url)] = true;
    return $streams;
}

/** A player mentioned by the public Zico API for a catalog event is an authorized source too. */
function playerAllowedPage($page, $catalogStreams, $get = null) {
    if (isset($catalogStreams[$page])) return true;
    // A saved channel page authorizes only the player with the same channel id (and vice versa).
    $channel = playerZicoPage($page);
    if ($channel !== '') foreach ($catalogStreams as $saved => $_)
        if (playerZicoPage($saved) === $channel) return true;
    $parts = parse_url($page);
    $host = strtolower($parts['host'] ?? '');
    if (($parts['scheme'] ?? '') !== 'https' || ($host !== 'zicotv.cc' && substr($host, -strlen('.zicotv.cc')) !== '.zicotv.cc')
        || !preg_match('#^/api/player/[0-9]+/?$#', $parts['path'] ?? '')) return false;
    foreach ($catalogStreams as $event => $_) {
        $eventParts = parse_url($event);
        $eventHost = strtolower($eventParts['host'] ?? '');
        if (($eventParts['scheme'] ?? '') !== 'https' || ($eventHost !== 'zicotv.cc' && substr($eventHost, -strlen('.zicotv.cc')) !== '.zicotv.cc')
            || !preg_match('#^/events/([0-9]+)/?$#', $eventParts['path'] ?? '', $match)) continue;
        $api = 'https://' . $eventHost . '/api/v1/events/' . $match[1];
        list($status, $body) = $get ? $get($api) : playerGet($api, '');
        if ($status !== 200 || !is_string($body)) continue;
        $json = json_decode($body, true);
        foreach (($json['data']['sources'] ?? array()) as $source)
            if (is_array($source) && empty($source['is_premium']) && empty($source['locked'])
                && ($source['player_url'] ?? $source['url'] ?? '') === $page) return true;
    }
    return false;
}

/** cURL for an address on a public server only (never the hosting's own network), as a browser on that page. */
function playerCurl($url, $page, $timeout, $extra = array()) {
    $host = strtolower(parse_url($url, PHP_URL_HOST) ?: '');
    // Zico's Cloudflare IPv6 route responds where its IPv4 route may return 403.
    // Keep DNS validation and pinning: only published public Cloudflare ranges are accepted.
    $zico = $host === 'zicotv.cc' || substr($host, -strlen('.zicotv.cc')) === '.zicotv.cc';
    $target = publicTarget($url, null, $zico);
    if ($target === null || strtolower(parse_url($url, PHP_URL_SCHEME) ?: '') !== 'https') return null;
    $headers = array('Accept: */*');
    if ($page !== '') {
        $p = parse_url($page);
        $headers[] = 'Referer: ' . $page;
        $headers[] = 'Origin: ' . $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => PLAYER_BROWSER, CURLOPT_HTTPHEADER => array_merge($headers, $extra), CURLOPT_PROXY => '',
        CURLOPT_RESOLVE => array($target['host'] . ':' . $target['port'] . ':'
            . (strpos($target['ip'], ':') !== false ? '[' . $target['ip'] . ']' : $target['ip'])),
    ));
    return $ch;
}
/** Status, body and final address of a page or list (redirects followed, each to a public server). */
function playerGet($url, $page, $limit = 3145728, $maxHops = 5) {
    for ($hop = 0; $hop < $maxHops; $hop++) {
        $ch = playerCurl($url, $page, 15);
        if ($ch === null) return array(0, null, $url);
        curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_ENCODING => '', CURLOPT_HEADER => false));
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        curl_close($ch);
        if ($status >= 300 && $status < 400 && is_string($location) && $location !== '') { $url = redirectTarget($url, $location) ?: ''; continue; }
        return array($status, is_string($body) && strlen($body) <= $limit ? $body : null, $url);
    }
    return array(0, null, $url);
}
/** A provider-issued same-player renewal URL; redirects and JavaScript are never executed. */
function playerPost($url, $page, $data) {
    $ch = playerCurl($url, $page, 15, ['Content-Type: application/json', 'Accept: application/json']);
    if ($ch === null) return [0, null];
    $body = '';
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($data), CURLOPT_ENCODING => '',
        CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body) {
            if (strlen($body) + strlen($chunk) > 262144) return 0;
            $body .= $chunk; return strlen($chunk);
        }]);
    $ok = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    return [$status, $ok === false ? null : $body];
}
function playerIsList($body) { return is_string($body) && strncmp(ltrim($body, "\xEF\xBB\xBF \r\n\t"), '#EXTM3U', 7) === 0; }
function playerList($body) { header('Content-Type: application/vnd.apple.mpegurl'); echo $body; exit; }
function playerHasMedia($body) {
    return playerIsList($body) && preg_match('/^#EXT(?:INF|-X-STREAM-INF):/m', $body)
        && preg_match('/(?:^|\n)[^#\s][^\r\n]*/', $body);
}

/** Shared hosts may disable curl_multi_exec. Keep the same public-target checks, with short bounded probes. */
function playerFirstListSequential($sources, $page, $factory = null) {
    $deadline = microtime(true) + 18;
    foreach (array_unique($sources) as $url) {
        if (!preg_match('/\.m3u8$/i', parse_url($url, PHP_URL_PATH) ?: '')) continue;
        for ($hop = 0; $hop < 5 && microtime(true) < $deadline && !connection_aborted(); $hop++) {
            $ch = $factory ? $factory($url, $page) : playerCurl($url, $page, 2);
            if (!$ch) break;
            $body = '';
            curl_setopt_array($ch, array(CURLOPT_ENCODING => '', CURLOPT_HEADER => false,
                CURLOPT_TIMEOUT_MS => max(1, min(2000, (int)(($deadline - microtime(true)) * 1000))),
                CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body) {
                    if (strlen($body) + strlen($chunk) > 2097152) return 0;
                    $body .= $chunk; return strlen($chunk);
                }));
            curl_exec($ch); $error = curl_errno($ch);
            $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
            curl_close($ch);
            if (!$error && $status === 200 && playerHasMedia($body)) return array($status, $body, $url);
            if ($status >= 300 && $status < 400 && is_string($location) && $location !== '') {
                $next = redirectTarget($url, $location);
                if ($next) { $url = $next; continue; }
            }
            break;
        }
    }
    return array(0, null, '');
}

/** Race HLS lists: a silent first CDN must never hold up another CDN that is already responding. */
function playerFirstList($sources, $page, $factory = null) {
    foreach (array('curl_multi_init', 'curl_multi_add_handle', 'curl_multi_exec', 'curl_multi_info_read',
        'curl_multi_remove_handle', 'curl_multi_select', 'curl_multi_close') as $function)
        if (!function_exists($function)) return playerFirstListSequential($sources, $page, $factory);
    $queue = array();
    foreach (array_unique($sources) as $url)
        if (preg_match('/\.m3u8$/i', parse_url($url, PHP_URL_PATH) ?: '')) $queue[] = array($url, 0);
    $multi = curl_multi_init(); $active = array(); $bodies = array(); $serial = 0;
    $deadline = microtime(true) + 18;
    $add = function ($url, $hops) use (&$active, &$bodies, &$serial, $multi, $page, $factory) {
        $ch = $factory ? $factory($url, $page) : playerCurl($url, $page, 15);
        if (!$ch) return;
        $id = ++$serial; $bodies[$id] = '';
        curl_setopt_array($ch, array(CURLOPT_ENCODING => '', CURLOPT_HEADER => false,
            CURLOPT_PRIVATE => (string)$id, CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$bodies, $id) {
                if (strlen($bodies[$id]) + strlen($chunk) > 2097152) return 0;
                $bodies[$id] .= $chunk; return strlen($chunk);
            }));
        $active[$id] = array($ch, $url, $hops); curl_multi_add_handle($multi, $ch);
    };
    try {
        while (($queue || $active) && microtime(true) < $deadline && !connection_aborted()) {
            while ($queue && count($active) < 16) { list($url, $hops) = array_shift($queue); $add($url, $hops); }
            do { $code = curl_multi_exec($multi, $running); } while ($code === CURLM_CALL_MULTI_PERFORM);
            if ($code !== CURLM_OK) break;
            while ($done = curl_multi_info_read($multi)) {
                $ch = $done['handle']; $id = (int)curl_getinfo($ch, CURLINFO_PRIVATE);
                list($_, $url, $hops) = $active[$id];
                $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL); $body = $bodies[$id];
                curl_multi_remove_handle($multi, $ch); curl_close($ch); unset($active[$id], $bodies[$id]);
                if ($done['result'] === CURLE_OK && $status === 200 && playerHasMedia($body))
                    return array($status, $body, $url);
                // Every redirect is revalidated and pinned by playerCurl, just like playerGet.
                if ($status >= 300 && $status < 400 && $hops < 4 && is_string($location) && $location !== '') {
                    $next = redirectTarget($url, $location);
                    if ($next) $queue[] = array($next, $hops + 1);
                }
            }
            if ($active && curl_multi_select($multi, 0.05) === -1) usleep(1000);
        }
    } finally {
        // Stop losing probes immediately; no background downloads remain after selecting a signal.
        foreach ($active as $entry) { curl_multi_remove_handle($multi, $entry[0]); curl_close($entry[0]); }
        curl_multi_close($multi);
    }
    return array(0, null, '');
}

/** Streams one piece of the video to the browser as it arrives, without storing it. */
function playerStream($url, $page) {
    @set_time_limit(300);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { if (!@ob_end_clean()) break; }
    $headers = array(); $status = 0; $sent = false;
    $range = $_SERVER['HTTP_RANGE'] ?? '';
    $ch = playerCurl($url, $page, 300, preg_match('/^bytes=\d*-\d*$/', $range) ? array('Range: ' . $range) : array());
    if ($ch === null) playerAnswer(array('error' => 'Dirección no válida.'), 403);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$headers, &$status) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) { $status = (int)$m[1]; $headers = array(); }
        elseif (preg_match('/^(content-type|content-length|content-range|accept-ranges):\s*(.+?)\s*$/i', $line, $m)) $headers[strtolower($m[1])] = $m[2];
        return strlen($line);
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) use (&$headers, &$status, &$sent) {
        if (!$sent) {
            $sent = true;
            http_response_code($status ?: 200);
            if ($status >= 300) return -1; // Nothing of an error page or a redirect is relayed.
            header('Content-Type: ' . ($headers['content-type'] ?? 'video/mp2t'));
            foreach (array('content-length' => 'Content-Length', 'content-range' => 'Content-Range', 'accept-ranges' => 'Accept-Ranges') as $k => $name)
                if (isset($headers[$k])) header($name . ': ' . $headers[$k]);
        }
        echo $data; flush();
        return connection_aborted() ? -1 : strlen($data);
    });
    curl_exec($ch);
    $failed = !$sent;
    curl_close($ch);
    if ($failed) playerAnswer(array('error' => 'El servidor del vídeo no lo ha entregado (' . $status . ').'), 502);
    exit;
}

function playerMain() {
    ini_set('display_errors', '0');
    @set_time_limit(25);
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com');
    // Signed addresses are handed out by this file: Chromecast plays them from its own origin.
    if (isset($_GET['seg'])) header('Access-Control-Allow-Origin: *');
    elseif ($origin !== '' && !in_array($origin, $allowed, true)) playerAnswer(array('error' => 'Origen no permitido.'), 403);
    elseif ($origin !== '') header('Access-Control-Allow-Origin: ' . $origin);
    if ($origin !== '') { header('Vary: Origin'); header('Access-Control-Expose-Headers: Content-Length, Content-Range'); }
    if (!function_exists('curl_init')) playerAnswer(array('error' => 'cURL no disponible.'), 502);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'OPTIONS') { header('Access-Control-Allow-Methods: GET, POST, OPTIONS'); header('Access-Control-Allow-Headers: Range, Content-Type, Authorization'); http_response_code(204); exit; }
    if (isset($_GET['zico_config'])) playerZicoConfig($method);
    if ($method !== 'GET') playerAnswer(array('error' => 'Método no permitido.'), 405);
    $secret = playerSecret();

    // A list or piece handed out by this file: relayed only with its signature.
    if (isset($_GET['seg'])) {
        $url = playerUnB64($_GET['seg']); $page = playerUnB64($_GET['p'] ?? '');
        if (!is_string($url) || !is_string($page) || !preg_match('#^https://#', $url) || !hash_equals(playerSign($url, $page, $secret), (string)($_GET['sig'] ?? '')))
            playerAnswer(array('error' => 'Dirección no válida.'), 403);
        // l=1: a list without .m3u8 in its address (a page that is already the list).
        if (preg_match('/\.m3u8$/i', parse_url($url, PHP_URL_PATH) ?: '') || ($_GET['l'] ?? '') === '1') {
            $url = playerZicoFreshPlaylist($url, $page);
            list($status, $body, $final) = playerGet($url, $page, 2097152);
            if (in_array($status, [401, 403], true)) {
                $fresh = playerZicoFreshPlaylist($url, $page, true);
                if ($fresh !== $url) list($status, $body, $final) = playerGet($fresh, $page, 2097152);
            }
            if ($status !== 200 || !playerIsList($body)) playerAnswer(array('error' => 'El servidor no entrega la lista (' . $status . ').'), 502);
            playerList(playerRewrite($body, $final, $page, $secret));
        }
        playerStream($url, $page);
    }

    // Resolve catalog event sources from the hosting when the device's operator resets Zico API requests.
    if (isset($_GET['event'])) {
        $event = trim((string)$_GET['event']);
        $catalog = playerCatalogStreams();
        $parts = parse_url($event);
        $host = strtolower($parts['host'] ?? '');
        if (($parts['scheme'] ?? '') !== 'https' || ($host !== 'zicotv.cc' && substr($host, -strlen('.zicotv.cc')) !== '.zicotv.cc')
            || isset($parts['user']) || isset($parts['port']) || isset($parts['query']) || isset($parts['fragment'])
            || !preg_match('#^/events/([0-9]+)/?$#', $parts['path'] ?? '', $match)
            || !isset($catalog[$event])) playerAnswer(array('error' => 'Evento fuera del catálogo.'), 403);
        list($status, $body) = playerGet('https://' . $host . '/api/v1/events/' . $match[1], '');
        if ($status !== 200 || !is_string($body)) playerAnswer(array('error' => 'La API del evento no responde.'), 502);
        $data = json_decode($body, true);
        $sources = playerZicoEventSources($data, $event, $catalog, $secret, playerZicoToken());
        playerAnswer(['data' => ['sources' => $sources]]);

    }

    $page = trim((string)($_GET['page'] ?? ''));
    if (!preg_match('#^https://#i', $page) || strlen($page) > 2048) playerAnswer(array('error' => 'Enlace de reproductor no válido.'), 400);
    // Only channels of the catalog: the hosting is not a relay for any page on the internet.
    $catalog = playerCatalogStreams();
    if (!playerZicoSignedSource($page, $catalog, $secret) && !playerAllowedPage($page, $catalog)) playerAnswer(array('error' => 'Este enlace no es de ningún canal del catálogo. Si lo acabas de añadir, espera un minuto.'), 403);
    // cast=1: the signed address of the list instead of the list, for Chromecast (it cannot send the page).
    $cast = isset($_GET['cast']);
    $token = playerZicoToken();
    $current = null;
    if (playerZicoPage($page) !== '') {
        try { $current = playerZicoCurrent($page, $token); }
        catch (RuntimeException $error) { playerAnswer(['error' => $error->getMessage()], 502); }
        $status = 200; $final = $current['page'];
        $html = '<script>var ZT_SOURCES = ' . json_encode($current['sources'], JSON_HEX_TAG) . ';</script>';
    } else list($status, $html, $final) = playerOpenPage($page, $token);
    if (isset($_GET['diagnose'])) playerAnswer(['catalog' => 'authorized', 'configured' => $token !== '',
        'configured_http' => $status, 'configured_public_sources' => $current === null ? count(playerSources($html ?? '', $final)) : count($current['sources']),
        'renewal' => $current['renewal'] ?? false, 'ttl' => $current['ttl'] ?? null,
        'message' => 'No se incluyen credenciales ni direcciones de vídeo.']);
    if ($status !== 200 || $html === null) playerAnswer(array('error' => 'La página del reproductor no responde (' . $status . ').'), 502);
    // The «page» is already an HLS list without .m3u8 in its address.
    if (playerIsList($html)) {
        if ($cast) playerAnswer(array('url' => playerRelayed($final, $final, $secret) . '&l=1'));
        playerList(playerRewrite($html, $final, $final, $secret));
    }
    $sources = array_values(array_filter(playerSources($html, $final), function ($url) use ($token) { return !playerContainsZicoToken($url, $token); }));
    if (!$sources) playerAnswer(array('error' => 'No se encontró ningún vídeo en la página del reproductor.'), 404);
    if (isset($_GET['source_id'])) {
        $id = (string)$_GET['source_id'];
        if (!preg_match('/^[a-f0-9]{16}$/D', $id)) playerAnswer(['error' => 'Señal no válida.'], 400);
        $sources = array_values(array_filter($sources, function ($url) use ($id) { return playerSourceId($url) === $id; }));
        if (!$sources) playerAnswer(['error' => 'La señal seleccionada ya no está disponible.'], 404);
    }
    $pick = $_GET['src'] ?? '';
    if (is_string($pick) && preg_match('/^\d{1,2}$/', $pick) && isset($sources[(int)$pick])) $sources = array($sources[(int)$pick]);
    // A new attempt after the video was cut (intento=1, 2…) starts from another source of the page.
    $round = $_GET['intento'] ?? '';
    if (is_string($round) && preg_match('/^[1-9]$/', $round) && count($sources) > 1) {
        $shift = (int)$round % count($sources);
        $sources = array_merge(array_slice($sources, $shift), array_slice($sources, 0, $shift));
    }
    if (isset($_GET['list'])) {
        $items = [];
        foreach ($sources as $url) {
            $label = 'Señal';
            foreach (($current['sources'] ?? []) as $entry) if ($entry['url'] === $url) { $label = $entry['label']; break; }
            $items[] = ['id' => playerSourceId($url), 'name' => $label];
        }
        playerAnswer(['sources' => count($sources), 'items' => $items]);
    }
    $status = 0; $body = null; $at = '';
    $automatic = !isset($_GET['source_id']) && !isset($_GET['src']) && empty($_GET['intento']);
    if ($automatic && !empty($current['preferred'])) {
        $preferred = array_values(array_filter($sources, function ($url) use ($current) { return playerSourceId($url) === $current['preferred']; }));
        if ($preferred) list($status, $body, $at) = playerFirstList($preferred, $final);
    }
    if ($status !== 200) list($status, $body, $at) = playerFirstList($sources, $final);
    if ($status === 200) {
        if (playerContainsZicoToken($body, $token)) playerAnswer(['error' => 'No se pudo preparar una lista segura del vídeo.'], 502);
        if ($automatic && $current !== null) playerZicoRememberSource($page, $token, $at);
        $relayPage = playerZicoSignedSource($page, $catalog, $secret) ? $page : $final;
        if ($cast) playerAnswer(array('url' => playerRelayed($at, $relayPage, $secret) . '&l=1'));
        playerList(playerRewrite($body, $at, $relayPage, $secret));
    }
    playerAnswer(array('error' => 'Ninguna fuente HLS de la página del reproductor responde.'), 502);
}

if (PHP_SAPI !== 'cli') playerMain();
