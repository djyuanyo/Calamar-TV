<?php
// Read-only bridge for Vidara's API. The key arrives in POST and is not stored or returned.
const VIDARA_ORIGINS = ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'];
const VIDARA_BASE = 'https://api.vidara.so/v1/';

function vidaraReply($body, $status = 200) {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !in_array($origin, VIDARA_ORIGINS, true)) {
    http_response_code(403);
    exit;
}
if ($origin !== '') {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST, OPTIONS');
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
    $query += ['fld_id' => $id, 'page' => $page, 'limit' => 100, 'status' => 'active'];
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
curl_close($curl);
if ($http === 401 || $http === 403) vidaraReply(['error' => 'vidara_key'], 401);
$data = $received ? json_decode($body, true) : null;
if (is_array($data) && in_array((int) ($data['status'] ?? 0), [401, 403], true)) {
    vidaraReply(['error' => 'vidara_key'], 401);
}
if ($http !== 200 || !is_array($data) || (int) ($data['status'] ?? 0) !== 200 || !is_array($data['result'] ?? null)) {
    vidaraReply(['error' => 'vidara_unavailable'], 502);
}
$result = $data['result'];
if ($action === 'folders') {
    if (!is_array($result['folders'] ?? null)) vidaraReply(['error' => 'vidara_response'], 502);
    vidaraReply(['folders' => array_map(function ($row) {
        return is_array($row) ? array_intersect_key($row, array_flip(['fld_id', 'name'])) : null;
    }, $result['folders'])]);
}
if (!is_array($result['videos'] ?? null)) vidaraReply(['error' => 'vidara_response'], 502);
vidaraReply([
    'videos' => array_map(function ($row) {
        return is_array($row) ? array_intersect_key($row, array_flip(['filecode', 'title', 'uploaded'])) : null;
    }, $result['videos']),
    'page' => $result['page'] ?? null,
    'total_pages' => $result['total_pages'] ?? null,
    'total' => $result['total'] ?? null,
]);
