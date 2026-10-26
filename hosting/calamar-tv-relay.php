<?php
// HTTPS transport for public HTTP IPTV streams, with bounded connections.
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
    // Browsers get bounded connections (15 min / 512 MiB). The hosting's own video worker
    // (calamar-cast.php, shared by every viewer of the channel) keeps one open connection.
    $worker = calamarWorkerKey();
    $long = $worker !== null && hash_equals($worker, (string)($_SERVER['HTTP_X_CALAMAR_WORKER'] ?? ''));
    if ($long) @set_time_limit(0);
    // A browser keeps its connection up to 15 minutes / 512 MiB (it reconnects by itself after): each
    // end is a jump in the picture, and 120 s / 64 MiB cut a 4 Mbps channel every two minutes.
    if (!$long) @set_time_limit(930);
    $limit = $long ? PHP_INT_MAX : 536870912;
    $deadline = microtime(true) + ($long ? 6 * 3600 : 900); $started = false; $total = 0; $lastHttp = 0;
    for ($hop = 0; $hop < 4; $hop++) {
        $target = publicTarget($source);
        if ($target === null) { if (!$started) failure('Redirección no pública o no compatible.'); break; }
        $ms = (int)(($deadline - microtime(true)) * 1000);
        if ($ms <= 0) break;
        $location = ''; $status = 0;
        $ch = curl_init($source);
        curl_setopt_array($ch, array(
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT_MS => min(4000, $ms),
            CURLOPT_TIMEOUT_MS => $ms, CURLOPT_PROXY => '',
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
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$status, &$total, &$started, $limit) {
                if (connection_aborted()) return 0;
                if (!in_array($status, array(200, 206), true)) {
                    $total += strlen($chunk); return $total > $limit ? 0 : strlen($chunk);
                }
                if (!$started) {
                    header('Content-Type: video/mp2t'); header('X-Accel-Buffering: no');
                    header('X-Content-Type-Options: nosniff'); $started = true;
                }
                $remaining = $limit - $total;
                $piece = substr($chunk, 0, max(0, $remaining));
                $total += strlen($piece); echo $piece; flush();
                return $total >= $limit ? 0 : strlen($chunk);
            },
        ));
        curl_exec($ch); $lastHttp = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($started) break;
        if (!in_array($lastHttp, array(301, 302, 303, 307, 308), true) || !$location) break;
        $next = redirectTarget($source, $location); if ($next === null) break; $source = $next;
    }
    if (!$started) failure('No se recibió vídeo. HTTP del proveedor: ' . ($lastHttp ?: 'sin respuesta'));
    exit;
}

failure('Abre este puente desde Calamar TV.', 400);