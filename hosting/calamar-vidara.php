<?php
// Vidara catalogue and playback. The catalogue key arrives in POST and is never stored or returned.
const VIDARA_ORIGINS = ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'];
const VIDARA_BASE = 'https://api.vidara.so/v1/';
const VIDARA_BRIDGE = 4;
const VIDARA_PLAYER = 'https://vidara.to';

function vidaraReply($body, $status = 200) {
    http_response_code($status);
    echo json_encode(['bridge' => VIDARA_BRIDGE] + $body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function vidaraHlsUrl($data, $code) {
    $url = $data['streaming_url'] ?? null;
    if (($data['filecode'] ?? null) !== $code || !is_string($url) || strlen($url) > 8192
        || !filter_var($url, FILTER_VALIDATE_URL) || str_contains($url, chr(92))) return null;
    $parts = parse_url($url);
    if (($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || isset($parts['fragment'])
        || !preg_match('/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+$/iD', $parts['host'] ?? '')
        || preg_match('/\.(?:local|localhost|internal|test)$/iD', $parts['host'])
        || !preg_match('/\.m3u8$/iD', $parts['path'] ?? '')) return null;
    return $url;
}

/** Only the playlist is fetched here. Chromecast reads variants and segments from Vidara. */
function vidaraCastPlaylist($url, $language, $label) {
    require_once __DIR__ . '/calamar-http-source.php';
    require_once __DIR__ . '/calamar-cast-audio.php';
    $target = publicTarget($url, null, true);
    if (!$target) return;
    $body = '';
    $ip = $target['ip'];
    $pinned = strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip;
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RESOLVE => [$target['host'] . ':443:' . $pinned],
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 8,
        CURLOPT_REFERER => VIDARA_PLAYER . '/', CURLOPT_ENCODING => '',
        CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$body) {
            if (strlen($body) + strlen($chunk) > 524288) return 0;
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    $received = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if (!$received || $status !== 200 || strpos($body, '#EXTM3U') !== 0 || strpos($body, '#EXT-X-STREAM-INF:') === false) return;
    $selected = castAudioManifest($body, $language, $label);
    if ($selected === str_replace("\r\n", "\n", $body)) return;
    $lines = explode("\n", $selected);
    foreach ($lines as &$line) {
        if ($line !== '' && $line[0] !== '#') {
            $line = redirectTarget($url, trim($line));
            if ($line === null) return;
        } else {
            $line = preg_replace_callback('/URI="([^"]+)"/', function ($match) use ($url) {
                $absolute = redirectTarget($url, $match[1]);
                return $absolute === null ? $match[0] : 'URI="' . $absolute . '"';
            }, $line);
        }
    }
    unset($line);
    header('Content-Type: application/vnd.apple.mpegurl');
    echo implode("\n", $lines);
    exit;
}

function vidaraPlayback($code) {
    if (!is_string($code) || !preg_match('/^[A-Za-z0-9]{8,24}$/D', $code)) vidaraReply(['error' => 'video_code'], 400);
    if (!function_exists('curl_init')) vidaraReply(['error' => 'curl'], 503);
    $body = '';
    $curl = curl_init(VIDARA_PLAYER . '/api/stream');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['filecode' => $code, 'device' => 'web', 'codecs' => []]),
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Origin: ' . VIDARA_PLAYER],
        CURLOPT_REFERER => VIDARA_PLAYER . '/e/' . $code,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 12, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$body) {
            if (strlen($body) + strlen($chunk) > 65536) return 0;
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);
    $received = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    $url = $received && $status === 200 ? vidaraHlsUrl(json_decode($body, true), $code) : null;
    if (!$url) vidaraReply(['error' => 'vidara_playback', 'upstream_http' => $status], 502);
    if (isset($_GET['cast_audio'])) vidaraCastPlaylist($url, $_GET['cast_audio'], $_GET['cast_audio_name'] ?? '');
    header('Location: ' . $url, true, 302);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
$play = ($method === 'GET' || $method === 'HEAD' || $method === 'OPTIONS') && ($_GET['hls'] ?? '') === '1';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !$play && !in_array($origin, VIDARA_ORIGINS, true)) {
    http_response_code(403);
    exit;
}
if ($play) {
    header('Access-Control-Allow-Origin: *');
} elseif ($origin !== '') {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Range');
    http_response_code(204);
    exit;
}
if ($play) vidaraPlayback($_GET['code'] ?? '');
if ($method === 'GET' && ($_GET['status'] ?? '') === '1') {
    vidaraReply(['curl' => function_exists('curl_init')]);
}
if ($method !== 'POST') {
    header('Allow: GET, HEAD, POST, OPTIONS');
    vidaraReply(['error' => 'method'], 405);
}
$key = $_POST['key'] ?? '';
$action = $_POST['action'] ?? '';
if (!is_string($key) || !preg_match('/^[A-Za-z0-9_-]{8,128}$/D', $key)) {
    vidaraReply(['error' => 'vidara_key'], 401);
}

$query = ['api_key' => $key];
if ($action === 'folders') {
    $path = 'folder/list';
} elseif ($action === 'videos') {
    $id = $_POST['id'] ?? '';
    $page = $_POST['page'] ?? '';
    if (!is_string($id) || !preg_match('/^[1-9][0-9]{0,11}$/D', $id)
            || !is_string($page) || !preg_match('/^[1-9][0-9]{0,2}$/D', $page) || (int) $page > 250) {
        vidaraReply(['error' => 'folder'], 400);
    }
    $path = 'video/list';
    $query += ['fld_id' => $id, 'page' => $page, 'limit' => 100];
} else {
    vidaraReply(['error' => 'action'], 400);
}
if (!function_exists('curl_init')) vidaraReply(['error' => 'curl'], 503);

$body = '';
$curl = curl_init(VIDARA_BASE . $path . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986));
curl_setopt_array($curl, [
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$body) {
        if (strlen($body) + strlen($chunk) > 1048576) return 0;
        $body .= $chunk;
        return strlen($chunk);
    },
]);
$received = curl_exec($curl);
$http = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$curlError = curl_errno($curl);
curl_close($curl);
$data = $received ? json_decode($body, true) : null;
$apiStatus = is_numeric($data['status'] ?? null) ? (int) $data['status'] : 0;
$diagnostic = ['upstream_http' => $http, 'upstream_status' => $apiStatus];
if (!$received) vidaraReply(['error' => 'vidara_transport', 'curl_error' => $curlError] + $diagnostic, 502);
if (in_array($apiStatus, [401, 403], true) || $http === 401) {
    vidaraReply(['error' => 'vidara_key'], 401);
}
$result = $data['result'] ?? null;
if ($action === 'videos' && $page === '1') {
    $rows = $result['videos'] ?? null;
    $total = $result['total'] ?? null;
    $results = $result['results'] ?? null;
    $zero = $total === 0 || $total === '0' || ($total === null && ($results === 0 || $results === '0'));
    $message = $data['msg'] ?? '';
    $emptyMessage = is_string($message)
        && preg_match('/^(?:no (?:videos|files) found(?: in (?:this|the) folder)?|(?:the )?folder is empty)[.!]?$/iD', trim($message));
    // Only an explicit empty first page can be normalized. Never mask an upstream failure as a deletion.
    $emptySuccess = $http === 200 && $apiStatus === 200 && is_array($result) && $zero;
    $emptyNotice = in_array($http, [200, 404], true) && in_array($apiStatus, [200, 404], true) && $emptyMessage
        && ($result === null || $result === [] || $zero);
    $consistent = !((int) ($total ?? 0) > 0 || (int) ($results ?? 0) > 0 || (int) ($result['total_pages'] ?? 0) > 1);
    if (($rows === null || $rows === []) && $consistent && ($emptySuccess || $emptyNotice)) {
        vidaraReply(['complete_inventory' => true, 'videos' => [], 'page' => 1, 'total_pages' => 0, 'total' => 0]);
    }
}
if ($http === 200 && !is_array($data)) vidaraReply(['error' => 'vidara_response'] + $diagnostic, 502);
if ($http !== 200 || $apiStatus !== 200) {
    vidaraReply(['error' => 'vidara_upstream'] + $diagnostic, 502);
}
if (!is_array($result)) vidaraReply(['error' => 'vidara_response'] + $diagnostic, 502);
if ($action === 'folders') {
    if (!is_array($result['folders'] ?? null)) vidaraReply(['error' => 'vidara_response'] + $diagnostic, 502);
    vidaraReply(['folders' => array_map(function ($row) {
        return is_array($row) ? array_intersect_key($row, array_flip(['fld_id', 'name', 'videos'])) : null;
    }, $result['folders'])]);
}
if (!is_array($result['videos'] ?? null)) vidaraReply(['error' => 'vidara_response'] + $diagnostic, 502);
vidaraReply([
    'complete_inventory' => true,
    'videos' => array_map(function ($row) {
        return is_array($row) ? array_intersect_key($row, array_flip(['filecode', 'title', 'uploaded', 'status', 'file_active'])) : null;
    }, $result['videos']),
    'page' => $result['page'] ?? null,
    'total_pages' => $result['total_pages'] ?? null,
    'total' => $result['total'] ?? null,
]);
