<?php
// Photos and ratings of the players of a match, for the line-ups on the pitch (web and app), from
// API-Football (api-sports.io). The key stays on the hosting: calamar-apifootball-key.php next to this
// file (or one folder above it) with <?php return 'YOUR_KEY'; or the CALAMAR_APIFOOTBALL_KEY variable.
//  - GET home=…&away=…&date=YYYY-MM-DD: {"teams":{"home":[{number,name,photo,rating}],"away":[…]}}.
// Answers are kept in the hosting's temporary folder, so every viewer of a match spends one request:
// the day's fixtures 6 hours, the players 5 minutes during the match, a day once it ended.

const LINEUPS_API = 'https://v3.football.api-sports.io';

function lineupsAnswer($data, $code = 200) {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit;
}

function lineupsKey() {
    if (getenv('CALAMAR_APIFOOTBALL_KEY')) return trim(getenv('CALAMAR_APIFOOTBALL_KEY'));
    foreach ([dirname(__DIR__) . '/calamar-apifootball-key.php', __DIR__ . '/calamar-apifootball-key.php'] as $path) {
        $key = is_file($path) ? @include $path : null;
        if (is_string($key) && trim($key) !== '' && trim($key) !== 'TU_CLAVE') return trim($key);
    }
    return '';
}

/** Lower case, without accents or punctuation: «Atlético de Madrid» and «Atletico Madrid» compare. */
function lineupsWords($name) {
    $text = mb_strtolower((string)$name, 'UTF-8');
    $text = strtr($text, ['á' => 'a', 'à' => 'a', 'ä' => 'a', 'â' => 'a', 'ã' => 'a', 'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ê' => 'e',
        'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'î' => 'i', 'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ô' => 'o', 'õ' => 'o', 'ø' => 'o',
        'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'û' => 'u', 'ñ' => 'n', 'ç' => 'c', 'ß' => 'ss', 'ł' => 'l', 'š' => 's', 'ž' => 'z', 'č' => 'c', 'ć' => 'c']);
    $words = preg_split('/[^a-z0-9]+/', $text, -1, PREG_SPLIT_NO_EMPTY);
    $common = ['fc', 'cf', 'cd', 'ud', 'sd', 'ac', 'as', 'afc', 'sc', 'ss', 'ssc', 'club', 'de', 'del', 'la', 'el', 'the', 'calcio', 'football', 'futbol', 'sad'];
    return array_values(array_diff($words, $common));
}

/** How well two team names match: 0 none, more is better. */
function lineupsTeamScore($a, $b) {
    $x = lineupsWords($a); $y = lineupsWords($b);
    if (!$x || !$y) return 0;
    if (implode(' ', $x) === implode(' ', $y)) return 10;
    $shared = count(array_intersect($x, $y));
    $joinedX = implode('', $x); $joinedY = implode('', $y);
    if (strlen($joinedX) > 3 && strlen($joinedY) > 3 && (strpos($joinedX, $joinedY) !== false || strpos($joinedY, $joinedX) !== false)) $shared += 2;
    // «Real» alone is not a match: Real Madrid is not Real Sociedad.
    if ($shared === 1 && count(array_intersect($x, $y)) === 1 && in_array(array_values(array_intersect($x, $y))[0], ['real', 'atletico', 'sporting', 'united', 'city', 'inter'], true)) return 0;
    return $shared;
}

/** The fixture of the day with the best matching teams, or null. */
function lineupsPick($fixtures, $home, $away) {
    $best = null; $bestScore = 0;
    foreach ($fixtures as $f) {
        $h = lineupsTeamScore($home, $f['teams']['home']['name'] ?? ''); $a = lineupsTeamScore($away, $f['teams']['away']['name'] ?? '');
        if ($h > 0 && $a > 0 && $h + $a > $bestScore) { $best = $f; $bestScore = $h + $a; }
    }
    return $best;
}

function lineupsCache() {
    $dir = sys_get_temp_dir() . '/calamar-lineups-' . substr(hash('sha256', __DIR__), 0, 16);
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return $dir;
}

/** An API-Football answer, from the cache while it is fresh. */
function lineupsApi($path, $ttl, $key, $fetch = null) {
    $file = lineupsCache() . '/' . hash('sha256', $path) . '.json';
    if (is_file($file) && time() - filemtime($file) < $ttl) {
        $saved = json_decode((string)file_get_contents($file), true);
        if (is_array($saved)) return $saved;
    }
    if ($fetch) $body = $fetch(LINEUPS_API . $path);
    else {
        if (!function_exists('curl_init')) lineupsAnswer(['error' => 'cURL no disponible.'], 502);
        $ch = curl_init(LINEUPS_API . $path);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => ['x-apisports-key: ' . $key, 'Accept: application/json']]);
        $body = curl_exec($ch); curl_close($ch);
    }
    $data = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($data)) lineupsAnswer(['error' => 'API-Football no responde.'], 502);
    $errors = $data['errors'] ?? [];
    if ($errors) {
        // Its own words (no key, plan without that season, requests of the day used up…).
        $message = is_array($errors) ? implode(' ', array_map('strval', array_values($errors))) : (string)$errors;
        lineupsAnswer(['error' => 'API-Football: ' . $message], 502);
    }
    @file_put_contents($file, json_encode($data), LOCK_EX);
    return $data;
}

/** The players of one team: number, name, photo and rating. */
function lineupsPlayers($team) {
    $out = [];
    foreach (($team['players'] ?? []) as $p) {
        $games = $p['statistics'][0]['games'] ?? [];
        $rating = is_numeric($games['rating'] ?? null) ? round((float)$games['rating'], 1) : null;
        $photo = (string)($p['player']['photo'] ?? '');
        $out[] = ['number' => isset($games['number']) ? (string)$games['number'] : '', 'name' => (string)($p['player']['name'] ?? ''),
            'photo' => preg_match('#^https://#', $photo) ? $photo : '', 'rating' => $rating];
    }
    return $out;
}

function lineupsMain() {
    ini_set('display_errors', '0');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'];
    if ($origin !== '' && !in_array($origin, $allowed, true)) lineupsAnswer(['error' => 'Origen no permitido.'], 403);
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    $home = trim((string)($_GET['home'] ?? '')); $away = trim((string)($_GET['away'] ?? '')); $date = (string)($_GET['date'] ?? '');
    if ($home === '' || $away === '' || strlen($home . $away) > 200 || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) lineupsAnswer(['error' => 'Partido no válido.'], 400);
    $key = lineupsKey();
    if ($key === '') lineupsAnswer(['error' => 'Falta la clave de API-Football en el hosting (calamar-apifootball-key.php).'], 503);
    // The match by its teams on its day (UTC), or the day before or after for matches near midnight.
    $fixture = null;
    foreach ([0, -1, 1] as $shift) {
        $day = gmdate('Y-m-d', strtotime($date . ' 12:00 UTC') + $shift * 86400);
        $fixture = lineupsPick(lineupsApi('/fixtures?date=' . $day, 6 * 3600, $key)['response'] ?? [], $home, $away);
        if ($fixture) break;
    }
    if (!$fixture) lineupsAnswer(['error' => 'API-Football no tiene este partido.'], 404);
    $status = $fixture['fixture']['status']['short'] ?? '';
    $ttl = in_array($status, ['FT', 'AET', 'PEN', 'AWD', 'WO'], true) ? 86400 : (in_array($status, ['NS', 'TBD', 'PST'], true) ? 1800 : 300);
    $id = (int)($fixture['fixture']['id'] ?? 0);
    $teams = lineupsApi('/fixtures/players?fixture=' . $id, $ttl, $key)['response'] ?? [];
    $out = ['home' => [], 'away' => []];
    foreach ($teams as $t) {
        $side = ($t['team']['id'] ?? null) === ($fixture['teams']['home']['id'] ?? false) ? 'home' : 'away';
        $out[$side] = lineupsPlayers($t);
    }
    lineupsAnswer(['fixture' => $id, 'status' => $status, 'teams' => $out]);
}

if (PHP_SAPI !== 'cli') lineupsMain();
