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
function playerB64($text) { return rtrim(strtr(base64_encode($text), '+/', '-_'), '='); }
function playerUnB64($text) { return base64_decode(strtr((string)$text, '-_', '+/'), true); }
/** The page the video comes from goes with each piece: its servers only answer visits from that page. */
function playerSign($url, $page, $secret) { return substr(hash_hmac('sha256', $url . "\n" . $page, $secret), 0, 32); }
function playerRelayed($url, $page, $secret) {
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
        $url = playerResolve($page, $value);
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
    if (preg_match_all('/\b(?:file|src|source)\s*:\s*(["\'])(https:\/\/[^"\']+)\1/', $scripts, $files, PREG_SET_ORDER))
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
    $target = publicTarget($url);
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
        CURLOPT_RESOLVE => array($target['host'] . ':' . $target['port'] . ':' . $target['ip']),
    ));
    return $ch;
}
/** Status, body and final address of a page or list (redirects followed, each to a public server). */
function playerGet($url, $page, $limit = 3145728) {
    for ($hop = 0; $hop < 5; $hop++) {
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
function playerIsList($body) { return is_string($body) && strncmp(ltrim($body, "\xEF\xBB\xBF \r\n\t"), '#EXTM3U', 7) === 0; }
function playerList($body) { header('Content-Type: application/vnd.apple.mpegurl'); echo $body; exit; }

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
    if ($method === 'OPTIONS') { header('Access-Control-Allow-Methods: GET'); header('Access-Control-Allow-Headers: Range'); http_response_code(204); exit; }
    if ($method !== 'GET') playerAnswer(array('error' => 'Método no permitido.'), 405);
    $secret = playerSecret();

    // A list or piece handed out by this file: relayed only with its signature.
    if (isset($_GET['seg'])) {
        $url = playerUnB64($_GET['seg']); $page = playerUnB64($_GET['p'] ?? '');
        if (!is_string($url) || !is_string($page) || !preg_match('#^https://#', $url) || !hash_equals(playerSign($url, $page, $secret), (string)($_GET['sig'] ?? '')))
            playerAnswer(array('error' => 'Dirección no válida.'), 403);
        // l=1: a list without .m3u8 in its address (a page that is already the list).
        if (preg_match('/\.m3u8$/i', parse_url($url, PHP_URL_PATH) ?: '') || ($_GET['l'] ?? '') === '1') {
            list($status, $body, $final) = playerGet($url, $page, 2097152);
            if ($status !== 200 || !playerIsList($body)) playerAnswer(array('error' => 'El servidor no entrega la lista (' . $status . ').'), 502);
            playerList(playerRewrite($body, $final, $page, $secret));
        }
        playerStream($url, $page);
    }

    $page = trim((string)($_GET['page'] ?? ''));
    if (!preg_match('#^https://#i', $page) || strlen($page) > 2048) playerAnswer(array('error' => 'Enlace de reproductor no válido.'), 400);
    // Only channels of the catalog: the hosting is not a relay for any page on the internet.
    if (!playerAllowedPage($page, playerCatalogStreams())) playerAnswer(array('error' => 'Este enlace no es de ningún canal del catálogo. Si lo acabas de añadir, espera un minuto.'), 403);
    // cast=1: the signed address of the list instead of the list, for Chromecast (it cannot send the page).
    $cast = isset($_GET['cast']);
    list($status, $html, $final) = playerGet($page, '');
    if ($status !== 200 || $html === null) playerAnswer(array('error' => 'La página del reproductor no responde (' . $status . ').'), 502);
    // The «page» is already an HLS list without .m3u8 in its address.
    if (playerIsList($html)) {
        if ($cast) playerAnswer(array('url' => playerRelayed($final, $final, $secret) . '&l=1'));
        playerList(playerRewrite($html, $final, $final, $secret));
    }
    $sources = playerSources($html, $final);
    if (!$sources) playerAnswer(array('error' => 'No se encontró ningún vídeo en la página del reproductor.'), 404);
    $pick = $_GET['src'] ?? '';
    if (is_string($pick) && preg_match('/^\d{1,2}$/', $pick) && isset($sources[(int)$pick])) $sources = array($sources[(int)$pick]);
    // A new attempt after the video was cut (intento=1, 2…) starts from another source of the page.
    $round = $_GET['intento'] ?? '';
    if (is_string($round) && preg_match('/^[1-9]$/', $round) && count($sources) > 1) {
        $shift = (int)$round % count($sources);
        $sources = array_merge(array_slice($sources, $shift), array_slice($sources, 0, $shift));
    }
    if (isset($_GET['list'])) playerAnswer(array('sources' => count($sources)));
    // The first source that answers: servers of the same page often fail one at a time.
    foreach ($sources as $video) {
        if (!preg_match('/\.m3u8$/i', parse_url($video, PHP_URL_PATH) ?: '')) continue;
        list($status, $body, $at) = playerGet($video, $final, 2097152);
        if ($status === 200 && playerIsList($body)) {
            if ($cast) playerAnswer(array('url' => playerRelayed($at, $final, $secret) . '&l=1'));
            playerList(playerRewrite($body, $at, $final, $secret));
        }
    }
    playerAnswer(array('error' => 'Ninguna fuente HLS de la página del reproductor responde.'), 502);
}

if (PHP_SAPI !== 'cli') playerMain();
