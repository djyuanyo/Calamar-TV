<?php
// The visitors' 1X2 poll of a match (web and app), kept on the hosting: one small JSON file per match.
//  - GET  ?match=2026-10-30-villarreal-espanyol            → {"h":12,"d":3,"a":5}
//  - POST {"match":"…","voter":"<24 letters>","pick":"1|X|2"} → the same totals, with the vote counted.
// One vote per browser or app install and match (its random id, stored only as a hash), which can be
// changed. Nothing personal is kept. The files go one folder above this one when it can be written
// (outside the public web), or in calamar-votes-data/ next to it, closed by its .htaccess.

const VOTES_MAX_PER_MATCH = 50000;
const VOTES_IP_LIMIT = 60;          // votes from one address every 10 minutes
const VOTES_KEEP_DAYS = 120;        // older matches are removed now and then

function votesAnswer($data, $code = 200) {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit;
}

function votesDir() {
    $base = getenv('CALAMAR_VOTES_DIR');
    if ($base) { if (!is_dir($base)) @mkdir($base, 0700, true); return $base; }
    $outside = dirname(__DIR__) . '/calamar-votes';
    if (is_dir($outside) || (is_writable(dirname(__DIR__)) && @mkdir($outside, 0700))) return $outside;
    $inside = __DIR__ . '/calamar-votes-data';
    if (!is_dir($inside)) @mkdir($inside, 0700, true);
    if (!is_file($inside . '/.htaccess')) @file_put_contents($inside . '/.htaccess', "Require all denied\nDeny from all\n");
    return $inside;
}

/** «2026-10-30-villarreal-espanyol»: the day of kick-off (UTC) and the teams, as web/votes.js builds it. */
function votesValidMatch($match) {
    if (!is_string($match) || strlen($match) > 140 || !preg_match('/^(20\d{2})-([01]\d)-([0-3]\d)(-[a-z0-9]+)+$/', $match, $m)) return false;
    if (!checkdate((int)$m[2], (int)$m[3], (int)$m[1])) return false;
    return true;
}

/** New votes only for matches from yesterday to two months ahead. */
function votesOpenDay($match, $now = null) {
    $day = strtotime(substr($match, 0, 10) . ' 00:00:00 UTC');
    $now = $now ?? time();
    return $day !== false && $day > $now - 2 * 86400 && $day < $now + 60 * 86400;
}

function votesTotals($votes) {
    $out = ['h' => 0, 'd' => 0, 'a' => 0];
    foreach ($votes as $pick) { if ($pick === '1') $out['h']++; elseif ($pick === 'X') $out['d']++; elseif ($pick === '2') $out['a']++; }
    return $out;
}

function votesRead($file) {
    $data = is_file($file) ? json_decode((string)@file_get_contents($file), true) : null;
    return is_array($data['votes'] ?? null) ? $data['votes'] : [];
}

/** Counts (or changes) one vote under a lock, and returns the totals. */
function votesCast($dir, $match, $voter, $pick) {
    $file = $dir . '/' . $match . '.json';
    $handle = fopen($file, 'c+');
    if (!$handle) throw new RuntimeException('No se puede guardar el voto.');
    try {
        flock($handle, LOCK_EX);
        $data = json_decode((string)stream_get_contents($handle), true);
        $votes = is_array($data['votes'] ?? null) ? $data['votes'] : [];
        $id = substr(hash('sha256', 'calamar-votes|' . $voter), 0, 20);
        if (!isset($votes[$id]) && count($votes) >= VOTES_MAX_PER_MATCH) throw new RuntimeException('Se ha alcanzado el máximo de votos de este partido.');
        $votes[$id] = $pick;
        ftruncate($handle, 0); rewind($handle);
        fwrite($handle, json_encode(['votes' => $votes], JSON_UNESCAPED_SLASHES));
        fflush($handle);
        return votesTotals($votes);
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}

/** At most VOTES_IP_LIMIT votes from one address every 10 minutes (the address is kept only as a hash). */
function votesAllowed($dir, $ip, $now = null) {
    $now = $now ?? time();
    $file = $dir . '/ip-' . floor($now / 600) . '.json';
    $handle = @fopen($file, 'c+');
    if (!$handle) return true;
    try {
        flock($handle, LOCK_EX);
        $data = json_decode((string)stream_get_contents($handle), true) ?: [];
        $key = substr(hash('sha256', 'calamar-ip|' . $ip), 0, 16);
        $data[$key] = ($data[$key] ?? 0) + 1;
        ftruncate($handle, 0); rewind($handle); fwrite($handle, json_encode($data)); fflush($handle);
        return $data[$key] <= VOTES_IP_LIMIT;
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}

/** Removes old address counters and matches older than VOTES_KEEP_DAYS. */
function votesClean($dir, $now = null) {
    $now = $now ?? time();
    foreach (glob($dir . '/ip-*.json') ?: [] as $f) if (filemtime($f) < $now - 1800) @unlink($f);
    foreach (glob($dir . '/20*.json') ?: [] as $f) {
        $day = strtotime(substr(basename($f), 0, 10) . ' 00:00:00 UTC');
        if ($day !== false && $day < $now - VOTES_KEEP_DAYS * 86400) @unlink($f);
    }
}

function votesMain() {
    ini_set('display_errors', '0');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'];
    if ($origin !== '' && !in_array($origin, $allowed, true)) votesAnswer(['error' => 'Origen no permitido.'], 403);
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') {
        header('Access-Control-Allow-Methods: GET, POST'); header('Access-Control-Allow-Headers: Content-Type'); header('Access-Control-Max-Age: 86400');
        http_response_code(204); exit;
    }
    $dir = votesDir();
    if ($method === 'GET') {
        $match = (string)($_GET['match'] ?? '');
        if (!votesValidMatch($match)) votesAnswer(['error' => 'Partido no válido.'], 400);
        votesAnswer(votesTotals(votesRead($dir . '/' . $match . '.json')));
    }
    if ($method !== 'POST') votesAnswer(['error' => 'Método no permitido.'], 405);
    $body = json_decode((string)file_get_contents('php://input', false, null, 0, 2000), true);
    $match = $body['match'] ?? ''; $voter = $body['voter'] ?? ''; $pick = $body['pick'] ?? '';
    if (!votesValidMatch($match) || !votesOpenDay($match)) votesAnswer(['error' => 'Partido no válido.'], 400);
    if (!is_string($voter) || !preg_match('/^[A-Za-z0-9]{20,40}$/', $voter) || !in_array($pick, ['1', 'X', '2'], true)) votesAnswer(['error' => 'Voto no válido.'], 400);
    if (!votesAllowed($dir, $_SERVER['REMOTE_ADDR'] ?? '')) votesAnswer(['error' => 'Demasiados votos desde esta conexión. Espera unos minutos.'], 429);
    if (mt_rand(1, 50) === 1) votesClean($dir);
    try { votesAnswer(votesCast($dir, $match, $voter, $pick)); }
    catch (RuntimeException $e) { votesAnswer(['error' => $e->getMessage()], 503); }
}

if (PHP_SAPI !== 'cli' && !defined('CALAMAR_VOTES_TEST_ONLY')) votesMain();
