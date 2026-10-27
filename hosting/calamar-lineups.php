<?php
// Photos and ratings of the players of a match, for the line-ups on the pitch (web and app), from
// API-Football (api-sports.io). The key stays on the hosting: calamar-apifootball-key.php next to this
// file (or one folder above it) with <?php return 'YOUR_KEY'; or the CALAMAR_APIFOOTBALL_KEY variable.
//  - GET home=…&away=…&date=YYYY-MM-DD: {"teams":{"home":[{number,name,photo,rating}],"away":[…]}}.
//  - GET …&stats=1: the match statistics with ESPN's names, for matches ESPN leaves at 0 (small cup ties):
//    {"stats":{"home":{"possessionPct":"55%","totalShots":"12",…},"away":{…}}}.
// Answers are kept in the hosting's temporary folder, so every viewer of a match spends one request:
// the day's fixtures 6 hours, the players 5 minutes during the match, a day once it ended. Before
// kick-off API-Football has no player statistics yet: the photos then come from the published line-up
// (asked from 75 minutes before kick-off, every 5 minutes until it is out, then kept 6 hours).

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

/** An API-Football answer, from the cache while it is fresh ($emptyTtl for an answer with nothing yet). */
function lineupsApi($path, $ttl, $key, $fetch = null, $emptyTtl = null) {
    $file = lineupsCache() . '/' . hash('sha256', $path) . '.json';
    $saved = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    if (is_array($saved)) {
        $fresh = $emptyTtl !== null && empty($saved['response']) ? min($ttl, $emptyTtl) : $ttl;
        if (time() - filemtime($file) < $fresh) return $saved;
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
    // When API-Football fails or limits the requests of the minute, the last answer kept is better than nothing.
    if ((!is_array($data) || !empty($data['errors'])) && is_array($saved)) return $saved;
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
        // Players who did not play come with no rating or a 0: they show none.
        $rating = is_numeric($games['rating'] ?? null) && (float)$games['rating'] > 0 ? round((float)$games['rating'], 1) : null;
        $photo = (string)($p['player']['photo'] ?? '');
        $out[] = ['number' => isset($games['number']) ? (string)$games['number'] : '', 'name' => (string)($p['player']['name'] ?? ''),
            'photo' => preg_match('#^https://#', $photo) ? $photo : '', 'rating' => $rating];
    }
    return $out;
}

/** The players of one team from its published line-up: number, name and photo (by player id), no rating yet. */
function lineupsFromLineup($team) {
    $out = [];
    foreach (array_merge($team['startXI'] ?? [], $team['substitutes'] ?? []) as $p) {
        $player = $p['player'] ?? [];
        $id = (int)($player['id'] ?? 0);
        $out[] = ['number' => isset($player['number']) ? (string)$player['number'] : '', 'name' => (string)($player['name'] ?? ''),
            'photo' => $id > 0 ? 'https://media.api-sports.io/football/players/' . $id . '.png' : '', 'rating' => null];
    }
    return $out;
}

/** Players' photos from the line-up for the sides the statistics left empty or without photos. */
function lineupsFill($out, $lineups, $homeId) {
    foreach ($lineups as $t) {
        $side = ($t['team']['id'] ?? null) === $homeId ? 'home' : 'away';
        $known = $out[$side] ?? [];
        $photos = count(array_filter($known, fn($p) => $p['photo'] !== ''));
        if (!$known) { $out[$side] = lineupsFromLineup($t); continue; }
        if ($photos === count($known)) continue;
        $byNumber = [];
        foreach (lineupsFromLineup($t) as $p) if ($p['number'] !== '') $byNumber[$p['number']] = $p['photo'];
        foreach ($known as $i => $p) if ($p['photo'] === '' && isset($byNumber[$p['number']])) $out[$side][$i]['photo'] = $byNumber[$p['number']];
    }
    return $out;
}

// API-Football's statistic names and ESPN's, so the pages show them as they show ESPN's.
const LINEUPS_STATS = ['Ball Possession' => 'possessionPct', 'Total Shots' => 'totalShots', 'Shots on Goal' => 'shotsOnTarget',
    'Corner Kicks' => 'wonCorners', 'Fouls' => 'foulsCommitted', 'Offsides' => 'offsides', 'Yellow Cards' => 'yellowCards',
    'Red Cards' => 'redCards', 'Goalkeeper Saves' => 'saves', 'Total passes' => 'totalPasses', 'Passes accurate' => 'accuratePasses',
    'Passes %' => 'passPct', 'Blocked Shots' => 'blockedShots'];

/** One team's statistics from /fixtures/statistics with ESPN's names; empty when it has none. */
function lineupsStats($team) {
    $out = [];
    foreach (($team['statistics'] ?? []) as $s) {
        $key = LINEUPS_STATS[$s['type'] ?? ''] ?? null;
        if (!$key || $s['value'] === null || $s['value'] === '') continue;
        $out[$key] = (string)$s['value'];
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
    // The day's fixtures are kept 6 hours, so their status may be old: the kick-off time decides too.
    $kickoff = (int)($fixture['fixture']['timestamp'] ?? 0);
    $ended = in_array($status, ['FT', 'AET', 'PEN', 'AWD', 'WO'], true) || ($kickoff > 0 && time() > $kickoff + 3 * 3600);
    $soon = $kickoff > 0 && time() >= $kickoff - 75 * 60;
    $ttl = $ended ? 86400 : ($soon ? 300 : 1800);
    $id = (int)($fixture['fixture']['id'] ?? 0);
    $homeId = $fixture['teams']['home']['id'] ?? false;
    if (($_GET['stats'] ?? '') === '1') {
        $stats = ['home' => [], 'away' => []];
        foreach (lineupsApi('/fixtures/statistics?fixture=' . $id, $ttl, $key, null, 300)['response'] ?? [] as $t) {
            $stats[($t['team']['id'] ?? null) === $homeId ? 'home' : 'away'] = lineupsStats($t);
        }
        lineupsAnswer(['fixture' => $id, 'status' => $status, 'stats' => $stats]);
    }
    // Statistics (photos and ratings) appear once the match starts: an empty answer is asked again in 5 minutes.
    $teams = lineupsApi('/fixtures/players?fixture=' . $id, $ttl, $key, null, 300)['response'] ?? [];
    $out = ['home' => [], 'away' => []];
    foreach ($teams as $t) {
        $side = ($t['team']['id'] ?? null) === $homeId ? 'home' : 'away';
        $out[$side] = lineupsPlayers($t);
    }
    $missing = !$out['home'] || !$out['away'] || in_array('', array_column(array_merge($out['home'], $out['away']), 'photo'), true);
    if ($missing && $soon) {
        $out = lineupsFill($out, lineupsApi('/fixtures/lineups?fixture=' . $id, 6 * 3600, $key, null, 300)['response'] ?? [], $homeId);
    }
    lineupsAnswer(['fixture' => $id, 'status' => $status, 'teams' => $out]);
}

if (PHP_SAPI !== 'cli') lineupsMain();
