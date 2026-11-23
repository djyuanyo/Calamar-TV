<?php
// Calamar TV as an IPTV list (M3U) for WisePlay, TiviMate, IPTV Smarters, VLC…
//   https://calamarmenciano.com/calamar-iptv.php?clave=TU_CLAVE    (yours, key in calamar-iptv-key.php)
//   https://calamarmenciano.com/calamar-iptv.php?lista=…           (a user's, made in Administración → Usuarios)
//   …&formato=wiseplay: WisePlay's own format, with the folders' icons and a folder per series.
// The list is made again each time the app asks for it, from the published catalog: the channels
// (yours and the TDT list), live events, films, series and documentaries. Whatever you change in Administración
// appears on the next refresh of the app, with nothing to upload.
//
// It is private: some channels carry the provider's user and password in their address, and whoever
// has the list watches without an account. The key is in calamar-iptv-key.php (see README-IPTV.txt).
// Players that only work inside a web page (Zico TV, YouTube, Dailymotion, AnonMP4) are left out.

const IPTV_PROJECT = 'menciamedia';
const IPTV_API_KEY = 'AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk'; // Public web key (web/firebase-config.js).
const IPTV_TDT = 'https://djyuanyo.github.io/Calamar-TV/data/tdt.json';
const IPTV_EVENT_COVERS = 'https://djyuanyo.github.io/Calamar-TV/data/event-covers.json';
const IPTV_LIVE_FOLDER = 'Eventos En Directo';
const IPTV_LIBRARY_FOLDERS = array('movies' => 'Películas', 'series' => 'Series', 'documentaries' => 'Documentales');
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
    if (preg_match('/[\x00-\x1f\x7f]/', $url)) return null;
    $u = parse_url($url);
    if (!$u || empty($u['host']) || !in_array(strtolower($u['scheme'] ?? ''), array('http', 'https'), true)) return null;
    $host = strtolower($u['host']);
    $path = $u['path'] ?? '/';
    $plain = preg_replace('/^www\./', '', $host);
    if ($plain === 'zicotv.cc' || substr($host, -10) === '.zicotv.cc' || $host === 'zicotv.gcorecdn.com') return null;
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
            // The video itself (with seeking), not the web's HLS conversion: IPTV apps play MKV, MP4 and
            // any audio, and the conversion (ffmpeg on the hosting, two at a time) is slow for them.
            return IPTV_HOSTING . '/calamar-drive.php?' . http_build_query(array('id' => $q['id'], 'v' => $q['v']));
        }
        return $url;
    }
    if ($host === 'www.googleapis.com' && strpos($path, '/drive/v3/files/') === 0) return $url;
    if (preg_match('/\.(m3u8|mp4|webm|ts|mkv|avi|mov|m4v|mpg|mpeg|flv|wmv|mpd)$/i', $path)) return $url;
    if (strtolower($u['scheme']) === 'http') return $url; // IPTV providers (TS streams) and the like.
    return $pages ? IPTV_HOSTING . '/calamar-player.php?page=' . rawurlencode($url) . '&hls=1' : null;
}

function iptvText($value) { return trim(preg_replace('/[\s",]+/u', ' ', (string)$value)); }
function iptvImage($value) { return is_string($value) && strpos($value, 'https://') === 0 ? $value : ''; }

/**
 * The list as folders: [name => ['stations' => [...], 'groups' => [name => folder]]]. Each station is
 * ['name', 'full' (the name with its series, for M3U), 'image', 'url', 'id'].
 */
function &iptvFolder(&$folders, $name) {
    if (!isset($folders[$name])) $folders[$name] = array('stations' => array(), 'groups' => array(), 'image' => '');
    return $folders[$name];
}

/** Channels as the web lists them (web/catalog.js merge): yours first, then the TDT ones not hidden. */
function iptvChannels(&$folders, $custom, $tdt) {
    $hidden = array_flip(array_map('strval', (array)($custom['hidden'] ?? array())));
    $tdtIds = array();
    foreach ((array)($tdt['channels'] ?? array()) as $o) if (is_array($o)) $tdtIds[(string)($o['id'] ?? '')] = true;
    $names = array();
    foreach ((array)($custom['categories'] ?? array()) as $c) if (is_array($c) && isset($c['id'])) $names[(string)$c['id']] = (string)($c['name'] ?? $c['id']);
    $stations = array();
    $add = function ($o, $own) use (&$folders, &$stations, $names) {
        $id = (string)($o['id'] ?? '');
        if ($id === '' || isset($stations[$id])) return;
        foreach ((array)($o['streams'] ?? array()) as $stream) {
            $address = iptvAddress($stream, true);
            if ($address === null) continue;
            $group = trim((string)($o['group'] ?? '')) ?: ($own ? 'Calamar TV' : 'Otros');
            $name = (string)($o['name'] ?? 'Canal');
            $label = $names[$group] ?? $group;
            if ($label === IPTV_LIVE_FOLDER || in_array($label, IPTV_LIBRARY_FOLDERS, true)) $label .= ' (canales)';
            $folder = &iptvFolder($folders, $label);
            $station = array('name' => $name, 'full' => $name, 'image' => iptvImage($o['logo'] ?? ''), 'url' => $address, 'id' => $id);
            $stations[$id] = $station;
            $folder['stations'][] = $station;
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
    return $stations;
}

function iptvEventStreams($event) {
    $streams = (array)($event['streams'] ?? array());
    if (empty($event['zicoEventId']) && !preg_match('/^zico-event-[0-9]+$/D', $event['id'])) return $streams;
    // The player pages, including older Zico aliases, are already excluded by iptvAddress().
    $automatic = (array)($event['zicoStreams'] ?? array());
    $manual = (array)($event['zicoManualStreams'] ?? array());
    return array_filter($streams, function ($link) use ($automatic, $manual) {
        return in_array($link, $manual, true) || !in_array($link, $automatic, true);
    });
}

/** Same Madrid-day window as Eventos En Directo, with the first source the IPTV client supports. */
function iptvLiveEvents($catalog, $channels, $now) {
    $teams = array_column((array)($catalog['teams'] ?? array()), null, 'id');
    $leagues = array_column((array)($catalog['leagues'] ?? array()), null, 'id');
    $events = (array)($catalog['events'] ?? array());
    foreach ((array)($catalog['fixtures'] ?? array()) as $fixture) {
        if (is_array($fixture)) $events[] = array_merge($fixture, array('imported' => true));
    }
    $stations = array();
    $zone = new DateTimeZone('Europe/Madrid');
    $day = (new DateTimeImmutable('@' . $now))->setTimezone($zone)->format('Y-m-d');
    foreach ($events as $event) {
        if (!is_array($event) || empty($event['id']) || in_array($event['status'] ?? '', array('finished', 'cancelled'), true)) continue;
        $start = empty($event['startAt']) ? false : strtotime($event['startAt']);
        if ($start === false || (!empty($event['imported']) && $now - $start >= 14400)) continue;
        $sameDay = (new DateTimeImmutable('@' . $start))->setTimezone($zone)->format('Y-m-d') === $day;
        if (!$sameDay && !($start < $now && $now - $start < 14400)) continue;

        $id = (string)$event['id'];
        $channel = $channels[$event['channelId'] ?? ''] ?? array();
        $address = $channel['url'] ?? null;
        if ($address === null) {
            foreach (iptvEventStreams($event) as $link) {
                $address = iptvAddress($link, true);
                if ($address !== null) break;
            }
        }
        if ($address === null) continue;
        $home = $teams[$event['homeTeamId'] ?? ''] ?? array();
        $away = $teams[$event['awayTeamId'] ?? ''] ?? array();
        $league = $leagues[$event['leagueId'] ?? ''] ?? array();
        $name = trim((string)($event['name'] ?? ''));
        if ($name === '') $name = ($home['name'] ?? 'Local') . ' vs ' . ($away['name'] ?? 'Visitante');
        $cover = iptvImage($event['cover'] ?? '');
        $fallback = $cover ?: (iptvImage($league['background'] ?? '') ?: ($channel['image'] ?? ''));
        $stations[$id] = array('id' => $id, 'name' => $name, 'full' => $name, 'url' => $address,
            'image' => $fallback, 'start' => $start, 'needsPreview' => $cover === '' || !empty($home['logo']) || !empty($away['logo']));
    }
    uasort($stations, function ($a, $b) {
        return ($a['start'] <=> $b['start']) ?: strnatcasecmp($a['name'], $b['name']);
    });
    return $stations;
}

function iptvAddLiveFolder(&$folders, $stations, $covers) {
    $folder = &iptvFolder($folders, IPTV_LIVE_FOLDER);
    foreach ($stations as $id => $station) {
        if ($station['needsPreview']) {
            $preview = iptvImage($covers[$id] ?? '');
            if ($preview !== '') $station['image'] = $preview;
        }
        $folder['stations'][] = $station;
    }
}

/** «Películas», «Series» and «Documentales»: inside, each series (or documentary series) is a folder. */
function iptvLibrary(&$folders, $readDocument = 'iptvDocument') {
    $index = $readDocument('calamarLibrary/index');
    if (!$index) return 0;
    $today = (new DateTime('now', new DateTimeZone('Europe/Madrid')))->format('Y-m-d');
    $count = 0; $library = array();
    foreach (IPTV_LIBRARY_FOLDERS as $section => $label) {
        $parts = (int)($index['sections'][$section] ?? 0);
        for ($n = 0; $n < $parts; $n++) {
            $part = $readDocument('calamarLibrary/' . $section . '-' . $n);
            foreach ((array)($part['items'] ?? array()) as $item) {
                if (!is_array($item)) continue;
                $title = (string)($item['tmdb']['title'] ?? $item['title'] ?? '');
                if ($title === '') continue;
                $year = (string)($item['tmdb']['year'] ?? $item['year'] ?? '');
                $poster = iptvImage($item['tmdb']['poster'] ?? '');
                if (!empty($item['episodes']) && is_array($item['episodes'])) {
                    $episodes = array_values(array_filter($item['episodes'], 'is_array'));
                    usort($episodes, function ($a, $b) {
                        return array((int)($a['season'] ?? 0), (int)($a['episode'] ?? 0)) <=> array((int)($b['season'] ?? 0), (int)($b['episode'] ?? 0));
                    });
                    $seriesKey = (string)($item['id'] ?? '');
                    if ($seriesKey === '') $seriesKey = "$title ($year)";
                    $seriesId = (string)hexdec(substr(hash('sha256', $section . "\n" . $seriesKey), 0, 13));
                    $seasons = array();
                    foreach ($episodes as $e) {
                        if (!empty($e['aired']) && (string)$e['aired'] > $today) continue;
                        $address = iptvAddress($e['url'] ?? '', false);
                        if ($address === null) continue;
                        $season = (int)($e['season'] ?? 0); $number = (int)($e['episode'] ?? 0);
                        $full = sprintf('%s T%d E%02d', $title, $season, $number);
                        if (!empty($e['name'])) $full .= ' - ' . $e['name'];
                        $seasons[$season][] = array(
                            'name' => 'Capítulo ' . $number, 'full' => $full, 'image' => $poster, 'url' => $address, 'id' => '',
                            'type' => 'series', 'seriesId' => $seriesId, 'seriesTitle' => $title,
                            'season' => $season, 'episode' => $number, 'episodeTitle' => (string)($e['name'] ?? ''),
                        );
                    }
                    if (!$seasons) continue;
                    // The series is a folder with its poster; with several seasons, one folder per season inside.
                    $folder = &iptvFolder($library, $label);
                    $series = &iptvFolder($folder['groups'], $year !== '' ? "$title ($year)" : $title);
                    $series['image'] = $poster;
                    foreach ($seasons as $season => $stations) {
                        if (count($seasons) === 1) { array_push($series['stations'], ...$stations); continue; }
                        $inner = &iptvFolder($series['groups'], 'Temporada ' . $season);
                        $inner['image'] = $poster;
                        array_push($inner['stations'], ...$stations);
                        unset($inner);
                    }
                    unset($folder, $series);
                    foreach ($seasons as $stations) $count += count($stations);
                } else {
                    $address = iptvAddress($item['url'] ?? '', false);
                    if ($address === null) continue;
                    $name = $year !== '' ? "$title ($year)" : $title;
                    $folder = &iptvFolder($library, $label);
                    $folder['stations'][] = array(
                        'name' => $name, 'full' => $name, 'image' => $poster, 'url' => $address, 'id' => '', 'type' => 'movie',
                    );
                    unset($folder);
                    $count++;
                }
            }
        }
    }
    foreach (IPTV_LIBRARY_FOLDERS as $label) if (isset($library[$label])) {
        ksort($library[$label]['groups'], SORT_NATURAL | SORT_FLAG_CASE);
        usort($library[$label]['stations'], function ($a, $b) { return strnatcasecmp($a['name'], $b['name']); });
    }
    foreach ($library as $label => $folder) $folders[$label] = $folder;
    return $count;
}

/** Icons of the folders, chosen in Administración → Lista IPTV (calamarIptv/settings). */
function iptvIcons(&$folders) {
    $settings = iptvDocument('calamarIptv/settings');
    $icons = (array)($settings['icons'] ?? array());
    foreach ($icons as $name => $url) {
        if (isset($folders[$name]) && iptvImage($url) !== '') $folders[$name]['image'] = $url;
    }
    return iptvImage($icons['Canales'] ?? '');
}

/**
 * WisePlay: channel categories inside «Canales», with live events and the library at the root.
 */
function iptvChannelsFolder($folders, $icon) {
    $otherFolders = array_merge(array(IPTV_LIVE_FOLDER), array_values(IPTV_LIBRARY_FOLDERS));
    $channels = array('stations' => array(), 'groups' => array(), 'image' => $icon);
    $out = array();
    foreach ($folders as $name => $folder) {
        if (in_array($name, $otherFolders, true)) continue;
        $channels['groups'][preg_replace('/ \(canales\)$/u', '', (string)$name)] = $folder;
    }
    if ($channels['groups']) $out['Canales'] = $channels;
    foreach ($otherFolders as $name) if (isset($folders[$name])) $out[$name] = $folders[$name];
    return $out;
}

/** M3U: one level of folders, so every episode of «Series» is in «Series» with its series in the name. */
function iptvM3u($folders) {
    $out = array();
    $line = function ($station, $group, $icon) use (&$out) {
        $type = $station['type'] ?? 'live';
        $title = $station['full'];
        $attrs = $station['id'] !== '' ? ' tvg-id="' . iptvText($station['id']) . '"' : '';
        if ($type === 'series') {
            $title = sprintf('%s S%02dE%02d', $station['seriesTitle'], $station['season'], $station['episode']);
            if ($station['episodeTitle'] !== '') $title .= ' - ' . $station['episodeTitle'];
            $attrs .= ' tvg-type="serie" type="series" tvg-serie="' . $station['seriesId'] . '"';
            $attrs .= ' serie-title="' . iptvText($station['seriesTitle']) . '"';
            $attrs .= ' tvg-season="' . $station['season'] . '" tvg-episode="' . $station['episode'] . '"';
        } elseif ($type === 'movie') {
            $attrs .= ' tvg-type="movie" type="movie"';
        } else {
            $attrs .= ' tvg-type="live"';
        }
        $attrs .= ' tvg-name="' . iptvText($title) . '"';
        if ($station['image'] !== '') $attrs .= ' tvg-logo="' . iptvText($station['image']) . '"';
        $attrs .= ' group-title="' . iptvText($group) . '"';
        if ($icon !== '') $attrs .= ' group-logo="' . iptvText($icon) . '"';
        $out[] = '#EXTINF:' . ($type === 'live' ? '-1' : '0') . $attrs . ',' . iptvText($title);
        $out[] = $station['url'];
    };
    foreach ($folders as $name => $folder) {
        // Some M3U players detect series by their category name even on a linear channel.
        if ($name === 'Series (canales)') $name = 'Cine y ficción TV';
        foreach ($folder['stations'] as $station) $line($station, $name, $folder['image']);
        $walk = function ($inner) use (&$walk, $line, $name, $folder) {
            foreach ($inner['stations'] as $station) $line($station, $name, $folder['image']);
            foreach ($inner['groups'] as $deeper) $walk($deeper);
        };
        foreach ($folder['groups'] as $inner) $walk($inner);
    }
    return $out;
}

/** WisePlay's own format (w3u): folders with their icon, and a folder per series inside «Series». */
function iptvWisePlay($folders, $info) {
    $node = function ($name, $folder) use (&$node) {
        $out = array('name' => (string)$name);
        if ($folder['image'] !== '') $out['image'] = $folder['image'];
        if ($folder['groups']) {
            $out['groups'] = array();
            foreach ($folder['groups'] as $inner => $child) $out['groups'][] = $node($inner, $child);
            // A folder holds folders or stations, not both: the loose ones go in folders of their own,
            // first (channels of a category with the same name, single documentaries…).
            $loose = array();
            foreach ($folder['stations'] as $s) $loose[$name === 'Documentales' ? 'Películas documentales' : ($name === 'Series' ? 'Series sin capítulos' : 'Títulos')][] = $s;
            foreach (array_reverse($loose, true) as $title => $stations)
                array_unshift($out['groups'], $node($title, array('stations' => $stations, 'groups' => array(), 'image' => '')));
        } else {
            $out['stations'] = array();
            foreach ($folder['stations'] as $s) {
                $station = array('name' => $s['name'], 'url' => $s['url'], 'isHost' => false);
                if ($s['image'] !== '') $station['image'] = $s['image'];
                $out['stations'][] = $station;
            }
        }
        return $out;
    };
    $list = array('name' => 'Calamar TV', 'author' => 'Calamar TV', 'info' => $info, 'groups' => array());
    foreach ($folders as $name => $folder) $list['groups'][] = $node($name, $folder);
    return $list;
}

/**
 * A user's list (?lista=…), made in Administración → Usuarios: calamarIptvLists/<password>, with its
 * expiry date (none: it always works). Returns null when it does not exist or has expired.
 */
function iptvUserList($token) {
    if (!preg_match('/^[A-Za-z0-9]{10,32}$/D', $token)) return 'missing';
    $body = iptvGet('https://firestore.googleapis.com/v1/projects/' . IPTV_PROJECT . '/databases/(default)/documents/calamarIptvLists/'
        . $token . '?key=' . IPTV_API_KEY);
    if ($body === null) return 'missing';
    $doc = json_decode($body, true);
    $expires = $doc['fields']['expires']['timestampValue'] ?? null;
    if (is_string($expires) && strtotime($expires) !== false && strtotime($expires) <= time()) return 'expired';
    return is_array($doc) && isset($doc['fields']['uid']) ? 'ok' : 'missing';
}

if (defined('CALAMAR_IPTV_LIBRARY')) return;

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
    $folders = array();
    $channels = iptvChannels($folders, $custom, $tdt);
    $events = iptvLiveEvents($custom, $channels, time());
    $covers = array();
    if (array_filter($events, function ($event) { return $event['needsPreview']; })) {
        try { $covers = json_decode((string)iptvGet(IPTV_EVENT_COVERS), true) ?: array(); }
        catch (Throwable $noCovers) { /* Use the catalog art while the web preview is unavailable. */ }
    }
    iptvAddLiveFolder($folders, $events, $covers);
    $videos = (empty($_GET['solo']) || $_GET['solo'] !== 'canales') ? iptvLibrary($folders) : 0;
    $channelsIcon = '';
    try { $channelsIcon = iptvIcons($folders); } catch (Throwable $noIcons) { /* The list works without its icons. */ }
} catch (Throwable $error) {
    iptvFail(502, 'No se pudo leer el catálogo de Calamar TV. Vuelve a intentarlo en unos minutos.');
}

$info = count($channels) . ' canales, ' . count($events) . ' eventos y ' . $videos . ' vídeos · ' . (new DateTime('now', new DateTimeZone('Europe/Madrid')))->format('d/m/Y H:i');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
if (($_GET['formato'] ?? '') === 'wiseplay') {
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: inline; filename="calamar-tv.w3u"');
    echo json_encode(iptvWisePlay(iptvChannelsFolder($folders, $channelsIcon), $info), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
header('Content-Type: audio/x-mpegurl; charset=utf-8');
header('Content-Disposition: inline; filename="calamar-tv.m3u"');
echo "#EXTM3U\n# Calamar TV · ", $info, "\n";
echo implode("\n", iptvM3u($folders)), "\n";
