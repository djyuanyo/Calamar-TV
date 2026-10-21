<?php
// Prueba temporal acotada, no un servicio de retransmisión permanente.
ini_set('display_errors', '0');
@set_time_limit(125);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
function failure($message, $code = 502) {
    http_response_code($code); header('Content-Type: text/plain; charset=utf-8'); echo $message; exit;
}
function publicTarget($address) {
    $u = @parse_url($address);
    if (!is_array($u) || !in_array($u['scheme'] ?? '', array('http', 'https'), true)
        || isset($u['user']) || isset($u['pass']) || preg_match('/[\\r\\n]/', $address)) return null;
    $host = $u['host'] ?? '';
    if (!preg_match('/^[a-zA-Z0-9.-]+$/D', $host)) return null;
    $port = $u['port'] ?? ($u['scheme'] === 'https' ? 443 : 80);
    $ips = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? array($host) : @gethostbynamel($host);
    if (!$ips) return null;
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)
            || (int)explode('.', $ip)[0] >= 224
            || preg_match('/^100[.](6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])[.]/', $ip)) return null;
    }
    // Pin the validated IP so cURL cannot resolve the hostname to an internal address.
    return array('host' => $host, 'port' => $port, 'ip' => $ips[0]);
}
function redirectTarget($base, $location) {
    if (preg_match('/[\\r\\n]/', $location)) return null;
    if (preg_match('~^https?://~i', $location)) return $location;
    if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $location)) return null;
    $u = parse_url($base);
    if (strpos($location, '//') === 0) return $u['scheme'] . ':' . $location;
    $root = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    if (strpos($location, '/') === 0) return $root . $location;
    $path = $u['path'] ?? '/';
    if (strpos($location, '?') === 0) return $root . $path . $location;
    return $root . substr($path, 0, strrpos($path, '/') + 1) . $location;
}


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
    $u = @parse_url($source);
    if (!is_array($u) || ($u['scheme'] ?? '') !== 'http' || ($u['host'] ?? '') !== '31.43.191.125'
        || ($u['port'] ?? 0) !== 8080 || isset($u['user']) || isset($u['pass']) || isset($u['fragment'])
        || preg_match('/[\r\n]/', $source) || !preg_match('~^/[^/]+/[^/]+/[0-9]+(?:[.]ts)?$~D', $u['path'] ?? '')) {
        failure('Este archivo solo prueba el servidor del canal indicado.', 400);
    }
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { if (!@ob_end_clean()) break; }
    $deadline = microtime(true) + 120; $started = false; $total = 0; $lastHttp = 0;
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
            CURLOPT_USERAGENT => 'CalamarTV-Hosting-Test/3.0',
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$location, &$status) {
                if (preg_match('~^HTTP/[^ ]+ ([0-9]{3})~', $line, $m)) $status = (int)$m[1];
                if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$status, &$total, &$started) {
                if (connection_aborted()) return 0;
                if (!in_array($status, array(200, 206), true)) {
                    $total += strlen($chunk); return $total > 67108864 ? 0 : strlen($chunk);
                }
                if (!$started) {
                    header('Content-Type: video/mp2t'); header('X-Accel-Buffering: no');
                    header('X-Content-Type-Options: nosniff'); $started = true;
                }
                $remaining = 67108864 - $total;
                $piece = substr($chunk, 0, max(0, $remaining));
                $total += strlen($piece); echo $piece; flush();
                return $total >= 67108864 ? 0 : strlen($chunk);
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
