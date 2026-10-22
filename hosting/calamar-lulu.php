<?php
// Finds the HLS address of a LuluStream video for the web player. Only the player page (about 100 KB)
// passes through the hosting; the video itself goes straight from LuluStream to the browser.
ini_set('display_errors', '0');
@set_time_limit(20);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header('Content-Type: application/json; charset=utf-8');
function answer($data, $code = 200) {
    http_response_code($code); echo json_encode($data, JSON_UNESCAPED_SLASHES); exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com');
if ($origin !== '' && !in_array($origin, $allowed, true)) answer(array('error' => 'Origen no permitido.'), 403);
if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
// The admin page lists its folders through here when the browser may not call the API itself: only the
// folder listing is relayed, with the key the administrator sends (it is not stored on the hosting).
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $api = $_POST['api'] ?? '';
    $key = $_POST['key'] ?? '';
    $folder = $_POST['fld_id'] ?? '0';
    if ($api !== 'folder/list' || !is_string($key) || !preg_match('/^[A-Za-z0-9]{10,64}$/', $key) || !is_string($folder) || !preg_match('/^\d{1,12}$/', $folder))
        answer(array('error' => 'Consulta de LuluStream no válida.'), 400);
    if (!function_exists('curl_init')) answer(array('error' => 'cURL no disponible.'), 502);
    $ch = curl_init('https://api.lulustream.com/api/folder/list?' . http_build_query(array('key' => $key, 'fld_id' => $folder, 'files' => '1')));
    curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => 15, CURLOPT_ENCODING => ''));
    $body = curl_exec($ch);
    curl_close($ch);
    $data = is_string($body) && strlen($body) < 4194304 ? json_decode($body, true) : null;
    if (!is_array($data)) answer(array('error' => 'LuluStream no ha respondido.'), 502);
    answer($data);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') answer(array('error' => 'Método no permitido.'), 405);
$code = $_GET['code'] ?? '';
if (!is_string($code) || !preg_match('/^[A-Za-z0-9]{8,20}$/', $code)) answer(array('error' => 'Código de vídeo no válido.'), 400);
if (!function_exists('curl_init')) answer(array('error' => 'cURL no disponible.'), 502);

$ch = curl_init('https://lulustream.com/e/' . $code);
curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_TIMEOUT => 12, CURLOPT_ENCODING => '',
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    CURLOPT_HTTPHEADER => array('Accept: text/html', 'Referer: https://lulustream.com/'),
));
$html = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
$debug = isset($_GET['debug']);
if (!is_string($html) || $status !== 200 || strlen($html) > 2097152)
    answer(array('error' => 'LuluStream no responde (' . $status . ').') + ($debug && is_string($html) ? array('inicio' => substr(strip_tags($html), 0, 400)) : array()), 502);

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
$scripts = $html;
if (preg_match_all("/\}\('((?:[^'\\\\]++|\\\\.)*+)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\\\]++|\\\\.)*+)'\.split\('\|'\)/", $html, $packed, PREG_SET_ORDER))
    foreach ($packed as $m) $scripts .= "\n" . unpackScript($m);
$scripts = str_replace('\\/', '/', $scripts);
if ($debug) {
    // Diagnosis for the administrator: what the player page contains, without playing anything.
    preg_match_all('/https:\/\/[^"\'\s<>]+/', $scripts, $links);
    $at = stripos($scripts, 'sources');
    answer(array('bytes' => strlen($html), 'packed' => isset($packed) ? count($packed) : 0,
        'enlaces' => array_values(array_unique(array_map(function ($l) { return strtok($l, '?'); }, $links[0]))),
        'sources' => $at === false ? null : substr($scripts, max(0, $at - 100), 700),
        'titulo' => preg_match('/<title>(.*?)<\/title>/is', $html, $t) ? trim($t[1]) : null));
}
if (!preg_match_all('/\bfile\s*:\s*(["\'])(https:\/\/[^"\']+)\1/', $scripts, $files, PREG_SET_ORDER)) answer(array('error' => 'No se encontró el vídeo en LuluStream.'), 404);
foreach ($files as $f) {
    $path = strtolower(parse_url($f[2], PHP_URL_PATH) ?: '');
    if (!preg_match('/\.(m3u8|mp4)$/', $path)) continue;
    // ?code=…&probar=1 opens the video address itself, to check from a phone whether it plays there.
    if (isset($_GET['probar'])) { header('Location: ' . $f[2], true, 302); exit; }
    answer(array('url' => $f[2]));
}
answer(array('error' => 'No se encontró el vídeo en LuluStream.'), 404);
