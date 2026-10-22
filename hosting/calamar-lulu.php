<?php
// LuluStream for Calamar TV.
//  - POST api=folder/list: relays the folder listing for «Leer carpetas de LuluStream» (the key is not stored).
//  - GET code=…&hls=1: the video as an HLS list for the web player. LuluStream ties each video address to the
//    address that opened its player page, so the hosting reads the page and relays the list and its pieces
//    (seg=…): nothing is written to disk, but every film watched on the web passes through here (1–2 GB).
//  - GET code=…: the video address (debug=1: what the player page contains; probar=1: open that address).

const LULU_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function answer($data, $code = 200) {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8'); echo json_encode($data, JSON_UNESCAPED_SLASHES); exit;
}

/** Key that signs relayed addresses, so this file only relays what it handed out itself. */
function luluSecret() {
    if (getenv('CALAMAR_LULU_SECRET')) return getenv('CALAMAR_LULU_SECRET');
    $path = dirname(__DIR__) . '/calamar-lulu-secret.php';
    $saved = is_file($path) ? @include $path : null;
    if (is_string($saved) && strlen($saved) >= 32) return $saved;
    $secret = bin2hex(random_bytes(32));
    if (@file_put_contents($path, '<?php return ' . var_export($secret, true) . ";\n", LOCK_EX) !== false) @chmod($path, 0600);
    return $secret;
}
function luluSign($url, $secret) { return substr(hash_hmac('sha256', $url, $secret), 0, 32); }
function luluRelayed($url, $secret) {
    return 'calamar-lulu.php?seg=' . rtrim(strtr(base64_encode($url), '+/', '-_'), '=') . '&sig=' . luluSign($url, $secret);
}

/** An address in a list, made absolute against the list's own address. */
function luluResolve($base, $ref) {
    if (preg_match('#^https?://#i', $ref)) return $ref;
    $u = parse_url($base);
    $origin = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    if (strpos($ref, '//') === 0) return $u['scheme'] . ':' . $ref;
    if ($ref !== '' && $ref[0] === '/') return $origin . $ref;
    $dir = preg_replace('#/[^/]*$#', '/', $u['path'] ?? '/');
    return $origin . $dir . $ref;
}

/** Every address of an HLS list (variants, pieces, keys, subtitles) goes through the relay. */
function luluRewrite($list, $base, $secret) {
    $out = array();
    foreach (preg_split('/\r?\n/', $list) as $line) {
        $trimmed = trim($line);
        if ($trimmed === '') { $out[] = $line; continue; }
        if ($trimmed[0] !== '#') { $out[] = luluRelayed(luluResolve($base, $trimmed), $secret); continue; }
        $out[] = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($base, $secret) {
            return 'URI="' . luluRelayed(luluResolve($base, $m[1]), $secret) . '"';
        }, $line);
    }
    return implode("\n", $out);
}

// The player setup is usually packed with Dean Edwards' p,a,c,k,e,d: each word is an index into a list.
function unpackScript($m) {
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
/** The player page's scripts with the packed ones expanded. */
function luluScripts($html) {
    $scripts = $html;
    if (preg_match_all("/\}\('((?:[^'\\\\]++|\\\\.)*+)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\\\]++|\\\\.)*+)'\.split\('\|'\)/", $html, $packed, PREG_SET_ORDER))
        foreach ($packed as $m) $scripts .= "\n" . unpackScript($m);
    return str_replace('\\/', '/', $scripts);
}
/** The HLS or MP4 address in the player setup (sources: [{file: "…"}]), or null. */
function luluVideo($scripts) {
    if (!preg_match_all('/\bfile\s*:\s*(["\'])(https:\/\/[^"\']+)\1/', $scripts, $files, PREG_SET_ORDER)) return null;
    foreach ($files as $f) if (preg_match('/\.(m3u8|mp4)$/', strtolower(parse_url($f[2], PHP_URL_PATH) ?: ''))) return $f[2];
    return null;
}

function luluCurl($url, $timeout) {
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => $timeout, CURLOPT_USERAGENT => LULU_BROWSER,
        CURLOPT_HTTPHEADER => array('Referer: https://lulustream.com/', 'Origin: https://lulustream.com'),
    ));
    return $ch;
}
function luluGet($url, $limit = 2097152) {
    $ch = luluCurl($url, 15);
    curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_ENCODING => ''));
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return array($status, is_string($body) && strlen($body) <= $limit ? $body : null);
}
function luluList($body) {
    header('Content-Type: application/vnd.apple.mpegurl');
    echo $body; exit;
}

/** Streams one piece of the video from LuluStream to the browser as it arrives, without storing it. */
function luluStream($url) {
    @set_time_limit(300);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { if (!@ob_end_clean()) break; }
    $headers = array(); $status = 0; $sent = false;
    $ch = luluCurl($url, 300);
    $range = $_SERVER['HTTP_RANGE'] ?? '';
    if (preg_match('/^bytes=\d*-\d*$/', $range)) curl_setopt($ch, CURLOPT_HTTPHEADER, array('Referer: https://lulustream.com/', 'Origin: https://lulustream.com', 'Range: ' . $range));
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$headers, &$status) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) { $status = (int)$m[1]; $headers = array(); }
        elseif (preg_match('/^(content-type|content-length|content-range|accept-ranges):\s*(.+?)\s*$/i', $line, $m)) $headers[strtolower($m[1])] = $m[2];
        return strlen($line);
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) use (&$headers, &$status, &$sent) {
        if (!$sent) {
            $sent = true;
            http_response_code($status ?: 200);
            if ($status >= 400) return -1; // Nothing of an error page is relayed.
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
    if ($failed) answer(array('error' => 'LuluStream no ha entregado el vídeo (' . $status . ').'), 502);
    exit;
}

function luluMain() {
    ini_set('display_errors', '0');
    @set_time_limit(20);
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com');
    if ($origin !== '' && !in_array($origin, $allowed, true)) answer(array('error' => 'Origen no permitido.'), 403);
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); header('Access-Control-Expose-Headers: Content-Length, Content-Range'); }
    if (!function_exists('curl_init')) answer(array('error' => 'cURL no disponible.'), 502);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'OPTIONS') { header('Access-Control-Allow-Methods: GET, POST'); header('Access-Control-Allow-Headers: Range'); http_response_code(204); exit; }

    // The admin page lists its folders through here when the browser may not call the API itself.
    if ($method === 'POST') {
        $api = $_POST['api'] ?? ''; $key = $_POST['key'] ?? ''; $folder = $_POST['fld_id'] ?? '0';
        if ($api !== 'folder/list' || !is_string($key) || !preg_match('/^[A-Za-z0-9]{10,64}$/', $key) || !is_string($folder) || !preg_match('/^\d{1,12}$/', $folder))
            answer(array('error' => 'Consulta de LuluStream no válida.'), 400);
        list(, $body) = luluGet('https://api.lulustream.com/api/folder/list?' . http_build_query(array('key' => $key, 'fld_id' => $folder, 'files' => '1')), 4194304);
        $data = $body !== null ? json_decode($body, true) : null;
        if (!is_array($data)) answer(array('error' => 'LuluStream no ha respondido.'), 502);
        answer($data);
    }
    if ($method !== 'GET') answer(array('error' => 'Método no permitido.'), 405);

    // A list or piece handed out by this file: relayed only with its signature.
    if (isset($_GET['seg'])) {
        $url = base64_decode(strtr((string)$_GET['seg'], '-_', '+/'), true);
        if (!is_string($url) || !preg_match('#^https://#', $url) || !hash_equals(luluSign($url, luluSecret()), (string)($_GET['sig'] ?? '')))
            answer(array('error' => 'Dirección no válida.'), 403);
        if (preg_match('/\.m3u8$/i', parse_url($url, PHP_URL_PATH) ?: '')) {
            list($status, $body) = luluGet($url);
            if ($status !== 200 || $body === null) answer(array('error' => 'LuluStream no entrega la lista (' . $status . ').'), 502);
            luluList(luluRewrite($body, $url, luluSecret()));
        }
        luluStream($url);
    }

    $code = $_GET['code'] ?? '';
    if (!is_string($code) || !preg_match('/^[A-Za-z0-9]{8,20}$/', $code)) answer(array('error' => 'Código de vídeo no válido.'), 400);
    list($status, $html) = luluGet('https://lulustream.com/e/' . $code);
    if ($status !== 200 || $html === null)
        answer(array('error' => 'LuluStream no responde (' . $status . ').') + (isset($_GET['debug']) && $html ? array('inicio' => substr(strip_tags($html), 0, 400)) : array()), 502);
    $scripts = luluScripts($html);
    if (isset($_GET['debug'])) {
        // Diagnosis for the administrator: what the player page contains, without playing anything.
        preg_match_all('/https:\/\/[^"\'\s<>]+/', $scripts, $links);
        $at = stripos($scripts, 'sources');
        answer(array('bytes' => strlen($html), 'enlaces' => array_values(array_unique(array_map(function ($l) { return strtok($l, '?'); }, $links[0]))),
            'sources' => $at === false ? null : substr($scripts, max(0, $at - 100), 700),
            'titulo' => preg_match('/<title>(.*?)<\/title>/is', $html, $t) ? trim($t[1]) : null));
    }
    $video = luluVideo($scripts);
    if ($video === null) answer(array('error' => 'No se encontró el vídeo en LuluStream.'), 404);
    if (isset($_GET['probar'])) { header('Location: ' . $video, true, 302); exit; }
    if (isset($_GET['hls'])) {
        if (!preg_match('/\.m3u8$/i', parse_url($video, PHP_URL_PATH) ?: '')) answer(array('error' => 'Este vídeo no es HLS.'), 415);
        list($status, $body) = luluGet($video);
        if ($status !== 200 || $body === null) answer(array('error' => 'LuluStream no entrega la lista (' . $status . ').'), 502);
        luluList(luluRewrite($body, $video, luluSecret()));
    }
    answer(array('url' => $video));
}

if (PHP_SAPI !== 'cli') luluMain();
