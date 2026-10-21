<?php
// Link preview of a Calamar TV event for WhatsApp, Telegram, X, Facebook…
// Those apps read the HTML without running JavaScript and never receive the "#/evento/ID" part of the
// web address, so each event gets its own address here: calamar-evento.php?id=ID. The page carries the
// cover photo and the event name as Open Graph tags and sends people straight to the event on the web.
// It reads the public catalog document of Firestore; nothing is stored apart from a 60-second cache.

const CALAMAR_WEB = 'https://djyuanyo.github.io/Calamar-TV/';
const CALAMAR_CATALOG = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom';
const CALAMAR_CACHE_SECONDS = 60;

function eventCatalog(string $url = CALAMAR_CATALOG): ?array {
    $cache = sys_get_temp_dir() . '/calamar-evento-' . md5($url) . '.json';
    if (is_file($cache) && time() - filemtime($cache) < CALAMAR_CACHE_SECONDS) {
        $data = json_decode((string) file_get_contents($cache), true);
        if (is_array($data)) return $data;
    }
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
        $body = curl_exec($curl);
        curl_close($curl);
    } else {
        $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true]]));
    }
    $data = is_string($body) ? parseCatalog($body) : null;
    if (!is_array($data)) {
        // A stale copy is better than a preview without photo while Firestore does not answer.
        $old = is_file($cache) ? json_decode((string) file_get_contents($cache), true) : null;
        return is_array($old) ? $old : null;
    }
    @file_put_contents($cache, json_encode($data), LOCK_EX);
    return $data;
}

/** The catalog inside Firestore's REST answer: fields.json is the same JSON as data/custom.json. */
function parseCatalog(string $body): ?array {
    $document = json_decode($body, true);
    $json = $document['fields']['json']['stringValue'] ?? null;
    $data = is_string($json) ? json_decode($json, true) : null;
    return is_array($data) ? $data : null;
}

function findEvent(?array $catalog, string $id): ?array {
    foreach (($catalog['events'] ?? []) as $event) {
        if (is_array($event) && ($event['id'] ?? null) === $id) return $event;
    }
    return null;
}

/** "Liga · sábado 24 de octubre, 21:00 · Jornada 9", in Madrid time. */
function eventSummary(array $event, ?array $catalog): string {
    $parts = [];
    foreach (($catalog['leagues'] ?? []) as $league) {
        if (is_array($league) && ($league['id'] ?? null) === ($event['leagueId'] ?? '') && ($league['name'] ?? '') !== '') $parts[] = $league['name'];
    }
    if (!empty($event['startAt'])) {
        try {
            $date = new DateTime($event['startAt']);
            $date->setTimezone(new DateTimeZone('Europe/Madrid'));
            $days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
            $months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
            $parts[] = $days[(int) $date->format('w')] . ' ' . $date->format('j') . ' de ' . $months[(int) $date->format('n') - 1] . ', ' . $date->format('H:i');
        } catch (Exception $invalid) {
            // Without a valid date the preview simply leaves it out.
        }
    }
    foreach (['round', 'venue'] as $key) if (!empty($event[$key]) && is_string($event[$key])) $parts[] = $event[$key];
    return implode(' · ', $parts);
}

/** Uploaded covers are stored as data URIs; previews need a real image address, served here. */
function coverImage(string $cover): ?array {
    if (!preg_match('#^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$#', $cover, $m)) return null;
    $bytes = base64_decode($m[2], true);
    return $bytes === false ? null : ['type' => $m[1], 'bytes' => $bytes];
}

function selfUrl(): string {
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', $_SERVER['HTTP_HOST'] ?? 'calamarmenciano.com');
    return 'https://' . $host . strtok($_SERVER['REQUEST_URI'] ?? '/calamar-evento.php', '?');
}

function eventPage(?array $event, ?array $catalog, string $id, string $self): string {
    $h = fn($text) => htmlspecialchars((string) $text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $target = CALAMAR_WEB . ($event ? '#/evento/' . rawurlencode($id) : '');
    $title = $event ? $event['name'] : 'Calamar TV';
    $summary = $event ? eventSummary($event, $catalog) : 'Canales y eventos en directo.';
    $cover = (string) ($event['cover'] ?? '');
    $image = str_starts_with($cover, 'https://') ? $cover : ($event && coverImage($cover) ? $self . '?id=' . rawurlencode($id) . '&imagen=1' : '');
    $tags = [
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Calamar TV">',
        '<meta property="og:title" content="' . $h($title) . '">',
        '<meta property="og:description" content="' . $h($summary) . '">',
        '<meta property="og:url" content="' . $h($self . ($event ? '?id=' . rawurlencode($id) : '')) . '">',
        '<meta name="twitter:card" content="' . ($image ? 'summary_large_image' : 'summary') . '">',
        '<meta name="twitter:title" content="' . $h($title) . '">',
        '<meta name="twitter:description" content="' . $h($summary) . '">',
    ];
    if ($image) {
        array_push($tags, '<meta property="og:image" content="' . $h($image) . '">', '<meta property="og:image:alt" content="' . $h($title) . '">', '<meta name="twitter:image" content="' . $h($image) . '">');
    }
    return "<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        . '<title>' . $h($title) . "</title>\n<meta name=\"description\" content=\"" . $h($summary) . "\">\n" . implode("\n", $tags) . "\n"
        . '<meta http-equiv="refresh" content="0; url=' . $h($target) . "\">\n<link rel=\"canonical\" href=\"" . $h($target) . "\">\n"
        . "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f5f5f5;font:16px system-ui,sans-serif}a{color:#d6ff00}</style>\n</head>\n<body>\n"
        . '<p><a href="' . $h($target) . '">Abrir ' . $h($title) . " en Calamar TV</a></p>\n"
        . '<script>location.replace(' . json_encode($target, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ");</script>\n</body>\n</html>\n";
}

if (defined('CALAMAR_EVENT_TEST_ONLY')) return;

$id = (string) ($_GET['id'] ?? '');
if (!preg_match('/^[A-Za-z0-9_-]{1,100}$/', $id)) $id = '';
$catalog = $id === '' ? null : eventCatalog();
$event = $id === '' ? null : findEvent($catalog, $id);

if (isset($_GET['imagen'])) {
    $image = $event ? coverImage((string) ($event['cover'] ?? '')) : null;
    if (!$image) { http_response_code(404); exit; }
    header('Content-Type: ' . $image['type']);
    header('Content-Length: ' . strlen($image['bytes']));
    header('Cache-Control: public, max-age=600');
    header('X-Content-Type-Options: nosniff');
    echo $image['bytes'];
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=60');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
echo eventPage($event, $catalog, $id, selfUrl());
