<?php
/** Resolve Google share links once, at event creation. No arbitrary URL proxy or match scraping. */
require_once __DIR__ . '/calamar-http-source.php';
function matchGoogleAllowed($url) {
    $u = @parse_url($url);
    if (!is_array($u) || strlen($url) > 8192 || preg_match('/[\r\n]/', $url) || ($u['scheme'] ?? '') !== 'https'
        || isset($u['user']) || isset($u['pass']) || isset($u['port'])) return false;
    $host = $u['host'] ?? '';
    if ($host === 'share.google') return (bool)preg_match('~^/[A-Za-z0-9_-]+$~D', $u['path'] ?? '');
    return in_array($host, ['google.com','www.google.com','google.es','www.google.es'], true)
        && in_array($u['path'] ?? '', ['/search','/share.google'], true);
}
function matchSearch($url) {
    if (!matchGoogleAllowed($url)) return false;
    $u = parse_url($url); parse_str($u['query'] ?? '', $q);
    return ($u['path'] ?? '') === '/search' && is_string($q['q'] ?? null) && trim($q['q']) !== '';
}
function resolveGoogleMatch($url, $request = null) {
    if (!matchGoogleAllowed($url)) throw new RuntimeException('Enlace de Google no válido.');
    for ($i = 0; $i < 5; $i++) {
        if (matchSearch($url)) return $url;
        if ($request) $response = $request($url);
        else {
            $target = publicTarget($url);
            if (!$target || !function_exists('curl_init')) throw new RuntimeException('No se pudo conectar con Google.');
            $ch = curl_init($url); $location = ''; $body = '';
            curl_setopt_array($ch, [CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 8,
                CURLOPT_USERAGENT => 'Mozilla/5.0', CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_RESOLVE => [$target['host'].':443:'.$target['ip']],
                CURLOPT_HEADERFUNCTION => function($c, $h) use (&$location) { if (stripos($h,'Location:') === 0) $location = trim(substr($h,9)); return strlen($h); },
                CURLOPT_WRITEFUNCTION => function($c, $chunk) use (&$body) { if (strlen($body)+strlen($chunk)>524288) return 0; $body.=$chunk; return strlen($chunk); }]);
            curl_exec($ch); $code = curl_getinfo($ch,CURLINFO_RESPONSE_CODE); curl_close($ch);
            $response = ['status'=>$code, 'location'=>$location, 'body'=>$body];
        }
        if ($response['status'] >= 300 && $response['status'] < 400 && $response['location']) {
            $next = redirectTarget($url, $response['location']);
        } elseif ($response['status'] === 200) {
            $html = html_entity_decode(str_replace(['\\u003d','\\u0026','\\/'], ['=','&','/'], $response['body']), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            preg_match_all('~https://(?:www\.)?google\.(?:com|es)/search\?[^\s"<>]+~', $html, $links);
            $next = null;
            foreach ($links[0] as $link) if (matchSearch($link)) { $next=$link; break; }
        } else throw new RuntimeException('Google no permite consultar este enlace ahora. Abre el enlace y copia la dirección completa del partido.');
        if (!$next || !matchGoogleAllowed($next)) throw new RuntimeException('No se encontró un partido en el enlace compartido. Usa la dirección completa de Google.');
        $url = $next;
    }
    throw new RuntimeException('Demasiadas redirecciones de Google.');
}
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') !== __FILE__) return;
header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *'); header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { http_response_code(405); echo json_encode(['error'=>'Método no permitido']); exit; }
try { echo json_encode(['url'=>resolveGoogleMatch($_GET['url'] ?? '')], JSON_UNESCAPED_SLASHES); }
catch (Throwable $e) { http_response_code(422); echo json_encode(['error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE); }
