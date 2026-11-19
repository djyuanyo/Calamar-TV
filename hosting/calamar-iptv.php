<?php
// Calamar TV as an IPTV list (M3U) for WisePlay, TiviMate, IPTV Smarters, VLC…
//   https://calamarmenciano.com/calamar-iptv.php?clave=TU_CLAVE    (yours, key in calamar-iptv-key.php)
//   https://calamarmenciano.com/calamar-iptv.php?lista=…           (a user's, made in Administración → Usuarios)
// The list is made again each time the app asks for it, from the published catalog: the channels
// (yours and the TDT list), films, series and documentaries. Whatever you change in Administración
// appears on the next refresh of the app, with nothing to upload.
//
// It is private: some channels carry the provider's user and password in their address, and whoever
// has the list watches without an account. The key is in calamar-iptv-key.php (see README-IPTV.txt).
// Players that only work inside a web page (Zico TV, YouTube, Dailymotion, AnonMP4) are left out.

const IPTV_PROJECT = 'menciamedia';
const IPTV_API_KEY = 'AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk'; // Public web key (web/firebase-config.js).
const IPTV_TDT = 'https://djyuanyo.github.io/Calamar-TV/data/tdt.json';
const IPTV_HOSTING = 'https://calamarmenciano.com';

function iptvFail($code, $text) {
    http_response_code($code); header('Content-Type: text/plain; charset=utf-8'); header('Cache-Control: no-store');
    echo $text, "\n"; exit;
}

/** The key chosen in calamar-iptv-key.php (a folder above the web first, then next to this file). */
function iptvKey() {
    foreach (array(dirname(__DIR__) . '/calamar-iptv-key.php', __DIR__ . '/calamar-iptv-key.php') as $path) {
        $key = is_file($path) ? @include $path : null;
        if (is_string($key)) return trim($key);
    }
    return '';
}

function iptvGet($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => array('Accept: application/json')));
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status === 404) return null;
    if ($body === false || $status !== 200) throw new RuntimeException('HTTP ' . $status);
    return $body;
}

/** A published Firestore document whose «json» field holds the data (catalog and library parts). */
function iptvDocument($path) {
    $body = iptvGet('https://firestore.googleapis.com/v1/projects/' . IPTV_PROJECT . '/databases/(default)/documents/'
        . $path . '?key=' . IPTV_API_KEY);
    if ($body === null) return null;
    $doc = json_decode($body, true);
    $json = isset($doc['fields']['json']['stringValue']) ? $doc['fields']['json']['stringValue'] : null;
    $data = is_string($json) ? json_decode($json, true) : null;
    return is_array($data) ? $data : null;
}

/**
 * The address an IPTV app can open, or null. The same links the web turns into its own player
 * (web/catalog.js webPlayback): LuluStream, Vidara and Drive go through the hosting as HLS.
 * $pages: a channel's player page is read by the hosting (calamar-player.php), as on the web.
 */
function iptvAddress($value, $pages) {
    $url = trim((string)$value);
    $u = parse_url($url);
    if (!$u || empty($u['host']) || !in_array(strtolower($u['scheme'] ?? ''), array('http', 'https'), true)) return null;
    $host = strtolower($u['host']);
    $path = $u['path'] ?? '/';
    $plain = preg_replace('/^www\./', '', $host);
    if ($plain === 'zicotv.cc' || substr($host, -10) === '.zicotv.cc') return null;
    if (preg_match('/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|dailymotion\.com|dai\.ly)$/', $host)) return null;
    if (preg_match('/^anonmp4\.[a-z]{2,10}$/', $plain)) return null;
    if (preg_match('/^(lulustream|luluvdoo?|luluvido|luluvid|lulu)\.(com|st|to|net|org|io|live|pw)$/', $plain)) {
        if (!preg_match('#^/(?:e/|d/|v/)?([A-Za-z0-9]{8,20})(?:\.html)?/?$#', $path, $m) || $m[1] === 'api') return null;
        return IPTV_HOSTING . '/calamar-lulu.php?code=' . $m[1] . '&hls=1';
    }
    if (preg_match('/^vidara\.(to|so)$/', $plain)) {
        if (!preg_match('#^/(?:v/|e/)?([A-Za-z0-9]{8,24})/?$#', $path, $m)) return null;
        return IPTV_HOSTING . '/calamar-vidara.php?code=' . $m[1] . '&hls=1';
    }
    if ($plain === 'calamarmenciano.com') {
        if ($path === '/calamar-drive.php') {
            parse_str($u['query'] ?? '', $q);
            if (empty($q['id']) || empty($q['v'])) return null;
            return IPTV_HOSTING . '/calamar-drive.php?' . http_build_query(array('id' => $q['id'], 'v' => $q['v'], 'hls' => '1'));
        }
        return $url;
    }
    if ($host === 'www.googleapis.com' && strpos($path, '/drive/v3/files/') === 0) return $url;
    if (preg_match('/\.(m3u8|mp4|webm|ts|mkv|avi|mov|m4v|mpg|mpeg|flv|wmv|mpd)$/i', $path)) return $url;
    if (strtolower($u['scheme']) === 'http') return $url; // IPTV providers (TS streams) and the like.
    return $pages ? IPTV_HOSTING . '/calamar-player.php?page=' . rawurlencode($url) . '&hls=1' : null;
}

function iptvText($value) { return trim(preg_replace('/[\s",]+/u', ' ', (string)$value)); }

function iptvEntry(&$out, $name, $group, $logo, $address, $id = '') {
    $attrs = '';
    if ($id !== '') $attrs .= ' tvg-id="' . iptvText($id) . '"';
    $attrs .= ' tvg-name="' . iptvText($name) . '"';
    if (is_string($logo) && strpos($logo, 'https://') === 0) $attrs .= ' tvg-logo="' . iptvText($logo) . '"';
    $attrs .= ' group-title="' . iptvText($group) . '"';
    $out[] = '#EXTINF:-1' . $attrs . ',' . iptvText($name);
    $out[] = $address;
}

/** Channels as the web lists them (web/catalog.js merge): yours first, then the TDT ones not hidden. */
function iptvChannels(&$out, $custom, $tdt) {
    $hidden = array_flip(array_map('strval', (array)($custom['hidden'] ?? array())));
    $tdtIds = array();
    foreach ((array)($tdt['channels'] ?? array()) as $o) if (is_array($o)) $tdtIds[(string)($o['id'] ?? '')] = true;
    $names = array();
    foreach ((array)($custom['categories'] ?? array()) as $c) if (is_array($c) && isset($c['id'])) $names[(string)$c['id']] = (string)($c['name'] ?? $c['id']);
    $seen = array(); $count = 0;
    $add = function ($o, $own) use (&$out, &$seen, &$count, $names) {
        $id = (string)($o['id'] ?? '');
        if ($id === '' || isset($seen[$id])) return;
        foreach ((array)($o['streams'] ?? array()) as $stream) {
            $address = iptvAddress($stream, true);
            if ($address === null) continue;
            $seen[$id] = true; $count++;
            $group = trim((string)($o['group'] ?? '')) ?: ($own ? 'Calamar TV' : 'Otros');
            iptvEntry($out, (string)($o['name'] ?? 'Canal'), $names[$group] ?? $group, $o['logo'] ?? '', $address, $id);
            return; // The first source that an IPTV app can open.
        }
    };
    foreach ((array)($custom['channels'] ?? array()) as $o) {
        if (!is_array($o) || !empty($o['hidden'])) continue;
        if (!empty($o['tdt']) && isset($tdtIds[(string)($o['id'] ?? '')])) continue;
        $add($o, empty($o['tdt']));
    }
    foreach ((array)($tdt['channels'] ?? array()) as $o) {
        if (is_array($o) && !isset($hidden[(string)($o['id'] ?? '')])) $add($o, false);
    }
    return $count;
}

/** Films, series and documentaries; a series (or documentary series) is a group of its own. */
function iptvLibrary(&$out) {
    $index = iptvDocument('calamarLibrary/index');
    if (!$index) return 0;
    $labels = array('movies' => 'Películas', 'series' => 'Series', 'documentaries' => 'Documentales');
    $today = (new DateTime('now', new DateTimeZone('Europe/Madrid')))->format('Y-m-d');
    $count = 0;
    foreach ($labels as $section => $label) {
        $parts = (int)($index['sections'][$section] ?? 0);
        for ($n = 0; $n < $parts; $n++) {
            $part = iptvDocument('calamarLibrary/' . $section . '-' . $n);
            foreach ((array)($part['items'] ?? array()) as $item) {
                if (!is_array($item)) continue;
                $title = (string)($item['tmdb']['title'] ?? $item['title'] ?? '');
                if ($title === '') continue;
                $year = (string)($item['tmdb']['year'] ?? $item['year'] ?? '');
                $poster = $item['tmdb']['poster'] ?? '';
                if (!empty($item['episodes']) && is_array($item['episodes'])) {
                    foreach ($item['episodes'] as $e) {
                        if (!is_array($e) || !empty($e['aired']) && (string)$e['aired'] > $today) continue;
                        $address = iptvAddress($e['url'] ?? '', false);
                        if ($address === null) continue;
                        $name = sprintf('%s T%d E%02d', $title, (int)($e['season'] ?? 0), (int)($e['episode'] ?? 0));
                        if (!empty($e['name'])) $name .= ' - ' . $e['name'];
                        iptvEntry($out, $name, $label . ' · ' . $title, $poster, $address);
                        $count++;
                    }
                } else {
                    $address = iptvAddress($item['url'] ?? '', false);
                    if ($address === null) continue;
                    iptvEntry($out, $year !== '' ? "$title ($year)" : $title, $label, $poster, $address);
                    $count++;
                }
            }
        }
    }
    return $count;
}

/**
 * A user's list (?lista=…), made in Administración → Usuarios: calamarIptvLists/<password>, with its
 * expiry date (none: it always works). Returns null when it does not exist or has expired.
 */
function iptvUserList($token) {
    if (!preg_match('/^[A-Za-z0-9]{32}$/D', $token)) return 'missing';
    $body = iptvGet('https://firestore.googleapis.com/v1/projects/' . IPTV_PROJECT . '/databases/(default)/documents/calamarIptvLists/'
        . $token . '?key=' . IPTV_API_KEY);
    if ($body === null) return 'missing';
    $doc = json_decode($body, true);
    $expires = $doc['fields']['expires']['timestampValue'] ?? null;
    if (is_string($expires) && strtotime($expires) !== false && strtotime($expires) <= time()) return 'expired';
    return is_array($doc) && isset($doc['fields']['uid']) ? 'ok' : 'missing';
}

if (isset($_GET['lista']) && is_string($_GET['lista'])) {
    try { $state = iptvUserList($_GET['lista']); }
    catch (Throwable $error) { iptvFail(502, 'No se pudo comprobar la lista. Vuelve a intentarlo en unos minutos.'); }
    if ($state === 'expired') iptvFail(403, 'Esta lista de Calamar TV ha caducado. Contacta con el administrador.');
    if ($state !== 'ok') { usleep(500000); iptvFail(403, 'Lista no válida.'); }
} else {
    // The administrator's own list, with the key of calamar-iptv-key.php.
    $key = iptvKey();
    if (strlen($key) < 16 || $key === 'CAMBIA_ESTA_CLAVE_POR_UNA_LARGA') iptvFail(503, 'Falta la clave de la lista: edita calamar-iptv-key.php (mira README-IPTV.txt).');
    $given = isset($_GET['clave']) && is_string($_GET['clave']) ? $_GET['clave'] : '';
    if (!hash_equals($key, $given)) { usleep(500000); iptvFail(403, 'Clave no válida.'); }
}

try {
    $custom = iptvDocument('calamarCatalog/custom');
    if (!$custom) $custom = json_decode((string)iptvGet('https://djyuanyo.github.io/Calamar-TV/data/custom.json'), true) ?: array();
    $tdt = json_decode((string)iptvGet(IPTV_TDT), true) ?: array();
    $out = array();
    $channels = iptvChannels($out, $custom, $tdt);
    $videos = (empty($_GET['solo']) || $_GET['solo'] !== 'canales') ? iptvLibrary($out) : 0;
} catch (Throwable $error) {
    iptvFail(502, 'No se pudo leer el catálogo de Calamar TV. Vuelve a intentarlo en unos minutos.');
}

header('Content-Type: audio/x-mpegurl; charset=utf-8');
header('Content-Disposition: inline; filename="calamar-tv.m3u"');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
echo "#EXTM3U\n";
echo '# Calamar TV · ', $channels, ' canales y ', $videos, ' vídeos · ',
    (new DateTime('now', new DateTimeZone('Europe/Madrid')))->format('d/m/Y H:i'), "\n";
echo implode("\n", $out), "\n";
