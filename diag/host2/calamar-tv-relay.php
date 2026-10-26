<?php
// HTTPS transport for public HTTP IPTV streams, open while the viewer watches.
ini_set('display_errors', '0');
@set_time_limit(125);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
function failure($message, $code = 502) {
    http_response_code($code); header('Content-Type: text/plain; charset=utf-8'); echo $message; exit;
}
require_once __DIR__ . '/calamar-http-source.php';


$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com');
if ($origin !== '' && !in_array($origin, $allowed, true)) failure('Origen no permitido.', 403);
if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: X-Calamar-Source, Range');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') failure('Método no permitido.', 405);
if (isset($_GET['stream'])) {
    if (!function_exists('curl_init')) failure('cURL no disponible.');
    $source = base64_decode($_SERVER['HTTP_X_CALAMAR_SOURCE'] ?? '', true);
    if (!is_string($source) || strlen($source) > 2048) failure('Falta el enlace de la prueba.', 400);
    if (!httpTsSourceAllowed($source)) failure('Enlace IPTV HTTP no válido para el puente.', 400);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { if (!@ob_end_clean()) break; }
    // The connection lasts while the viewer stays on the channel. Many IPTV servers close each connection
    // after a few seconds or megabytes (VLC and the app open the next one by themselves): the relay does
    // the same and keeps one continuous answer, so the browser plays on with no restart.
    @set_time_limit(0);
    $headers = false; $lastHttp = 0; $misses = 0;
    while (!connection_aborted()) {
        $got = relayConnection($source, $headers, $lastHttp);
        if (!$headers) failure($got === null ? 'Redirección no pública o no compatible.' : 'No se recibió vídeo. HTTP del proveedor: ' . ($lastHttp ?: 'sin respuesta'));
        if ($got) $misses = 0; elseif (++$misses >= 4) break;
        usleep($got ? 100000 : 1500000);
    }
    exit;
}

/** One connection to the provider, following its redirects: true if it sent video, false if not, null if
 * a redirect left the public internet. The first video sends the answer's headers ($headers). */
function relayConnection($source, &$headers, &$lastHttp) {
    $got = false;
    for ($hop = 0; $hop < 4; $hop++) {
        $target = publicTarget($source);
        if ($target === null) return $got ?: null;
        $location = ''; $status = 0;
        $ch = curl_init($source);
        curl_setopt_array($ch, array(
            // It also ends when the provider stops sending video for 20 s; the next connection follows.
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT_MS => 4000,
            CURLOPT_LOW_SPEED_LIMIT => 1, CURLOPT_LOW_SPEED_TIME => 20, CURLOPT_PROXY => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_RESOLVE => array($target['host'] . ':' . $target['port'] . ':' . $target['ip']),
            // Many IPTV servers only answer known players; VLC's name is the one they accept.
            CURLOPT_USERAGENT => 'VLC/3.0.20 LibVLC/3.0.20',
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$location, &$status) {
                if (preg_match('~^HTTP/[^ ]+ ([0-9]{3})~', $line, $m)) $status = (int)$m[1];
                if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$status, &$headers, &$got) {
                if (connection_aborted()) return 0;
                // Error pages and redirects are read but not passed on (at most 64 KiB).
                if (!in_array($status, array(200, 206), true)) return curl_getinfo($ch, CURLINFO_SIZE_DOWNLOAD) > 65536 ? 0 : strlen($chunk);
                if (!$headers) {
                    header('Content-Type: video/mp2t'); header('X-Accel-Buffering: no');
                    header('X-Content-Type-Options: nosniff'); $headers = true;
                }
                $got = true;
                echo $chunk; flush();
                return strlen($chunk);
            },
        ));
        curl_exec($ch); $lastHttp = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($got) return true;
        if (!in_array($lastHttp, array(301, 302, 303, 307, 308), true) || !$location) return false;
        $next = redirectTarget($source, $location); if ($next === null) return null; $source = $next;
    }
    return $got;
}

failure('Abre este puente desde Calamar TV.', 400);