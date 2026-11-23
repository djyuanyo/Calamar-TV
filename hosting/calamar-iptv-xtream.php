<?php
/** Xtream catalog and redirects. This module never requests media URLs. */
function iptvRelayId($url) {
    return is_string($url) && preg_match('~^https://video\.calamarmenciano\.com/iptv-hls/([a-f0-9]{32})/index\.m3u8$~D', $url, $match)
        ? $match[1] : null;
}

function iptvMediaUrl($url) {
    if (!is_string($url) || strlen($url) > 6000 || preg_match('/[\x00-\x20\x7f]/', $url)) return false;
    $p = parse_url($url);
    return $p && !empty($p['host']) && in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true)
        && !isset($p['user']) && !isset($p['pass']);
}

function iptvChannelAddress($source, $originals) {
    if (iptvRelayId($source) !== null) return $source;
    $key = array_search($source, $originals, true);
    if ($key !== false) {
        $url = 'https://video.calamarmenciano.com/iptv-hls/' . $key . '/index.m3u8';
        if (iptvRelayId($url) !== null) return $url;
    }
    return iptvDirectChannel($source, $originals);
}

function iptvDirectChannel($source, $originals = []) {
    $relay = iptvRelayId($source);
    if ($relay !== null) $source = $originals[$relay] ?? null;
    if (!iptvMediaUrl($source)) return null;
    $host = strtolower(parse_url($source, PHP_URL_HOST));
    if ($host === 'calamarmenciano.com' || substr($host, -strlen('.calamarmenciano.com')) === '.calamarmenciano.com') return null;
    $address = iptvAddress($source, false);
    if ($address === $source) return $address;
    $parts = parse_url($source);
    // Some IPTV providers serve MPEG-TS at an HTTPS URL with a numeric id and no extension.
    if ($address === null && (($parts['port'] ?? 0) === 8080 || strpos($parts['path'] ?? '', '/live/') === 0)
        && preg_match('~^/(?:live/)?[^/]+/[^/]+/\d+(?:\.ts)?$~D', $parts['path'] ?? '')) return $source;
    return null;
}

function iptvStateDir() {
    static $dir = false;
    if ($dir !== false) return $dir;
    $root = realpath(($_SERVER['DOCUMENT_ROOT'] ?? '') ?: __DIR__);
    if (!$root) return $dir = null;
    $public = preg_match('~^(.+?/(?:public_html|www))(?:/|$)~', $root, $match) ? $match[1] : $root;
    $path = getenv('CALAMAR_IPTV_STATE') ?: dirname($public) . '/calamar-iptv-private';
    if (is_link($path) || (!is_dir($path) && !@mkdir($path, 0700))) return $dir = null;
    $resolved = realpath($path);
    if (!$resolved || $resolved === $public || strpos($resolved, $public . DIRECTORY_SEPARATOR) === 0
        || !is_writable($resolved)) return $dir = null;
    return $dir = $resolved;
}

function iptvStateRead($name) {
    $dir = iptvStateDir();
    $path = $dir ? "$dir/$name" : '';
    return $path && is_file($path) ? (json_decode((string)@file_get_contents($path), true) ?: []) : [];
}

function iptvStateWrite($name, $data) {
    $dir = iptvStateDir();
    if (!$dir || !($temp = @tempnam($dir, '.iptv-'))) return false;
    try {
        $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        return is_string($json) && @chmod($temp, 0600) && @file_put_contents($temp, $json) !== false
            && @rename($temp, "$dir/$name");
    } finally { if (is_file($temp)) @unlink($temp); }
}

function iptvStateLocked($name, $action) {
    $dir = iptvStateDir();
    if (!$dir || !($lock = @fopen("$dir/$name.lock", 'c'))) return null;
    try {
        if (!flock($lock, LOCK_EX)) return null;
        return $action();
    } finally { fclose($lock); }
}

function iptvCachedCatalog($withVideos, $playback = false) {
    $name = $withVideos ? 'catalog-all.json' : 'catalog-live.json';
    $cached = iptvStateRead($name);
    if (($cached['until'] ?? 0) > time() || ($playback && ($cached['until'] ?? 0) > time() - 600)) return $cached['catalog'];
    $load = function () use ($name, $withVideos) {
        $cached = iptvStateRead($name);
        if (($cached['until'] ?? 0) > time()) return $cached['catalog'];
        $catalog = iptvBuildCatalog($withVideos);
        iptvStateWrite($name, ['until' => time() + 60, 'catalog' => $catalog]);
        return $catalog;
    };
    return iptvStateLocked($name, $load) ?? $load();
}

function iptvHistoryFile($uid) { return 'history-' . hash('sha256', $uid) . '.json'; }

function iptvRecordOpen($uid, $target, $title, $now) {
    if (!is_string($target) || !preg_match('~^[cel]:[^|/\x00-\x1f]{1,200}$~uD', $target)) return;
    $name = iptvHistoryFile($uid);
    iptvStateLocked($name, function () use ($uid, $target, $title, $name, $now) {
        $log = iptvStateRead($name);
        $entries = $log['entries'] ?? [];
        $title = substr($title, 0, 500);
        foreach ($entries as $entry) {
            if ($entry['time'] < $now - 30) break;
            if ($entry['target'] === $target && $entry['title'] === $title) return;
        }
        array_unshift($entries, ['id' => bin2hex(random_bytes(8)), 'target' => $target, 'title' => $title, 'time' => $now]);
        iptvStateWrite($name, ['uid' => $uid, 'entries' => array_slice($entries, 0, 2000)]);
    });
}

function iptvRedirect($uid, $station) {
    if (empty($station['url']) || !iptvMediaUrl($station['url'])) iptvFail(404, 'Señal no disponible.');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        try { iptvRecordOpen($uid, $station['target'] ?? '', $station['full'] ?? 'IPTV', time()); }
        catch (Throwable $error) { error_log('Calamar IPTV: no se pudo registrar una apertura.'); }
    }
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    header('Location: ' . $station['url'], true, 302);
    exit;
}

function iptvSigningKey() {
    static $key = null;
    if ($key !== null) return $key;
    return $key = (iptvStateLocked('signature', function () {
        $saved = iptvStateRead('signature.json')['key'] ?? '';
        if (preg_match('/^[a-f0-9]{64}$/D', $saved)) return $saved;
        $new = bin2hex(random_bytes(32));
        return iptvStateWrite('signature.json', ['key' => $new]) ? $new : '';
    }) ?? '');
}

function iptvTrackedFolders(&$folders, $token) {
    $key = iptvSigningKey();
    if ($key === '') return;
    foreach ($folders as &$folder) {
        foreach ($folder['stations'] as &$item) {
            if (!iptvMediaUrl($item['url'])) continue;
            $json = json_encode([$item['url'], $item['target'] ?? '', $item['full']], JSON_INVALID_UTF8_SUBSTITUTE);
            if (!is_string($json)) continue;
            $payload = rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
            $signed = hash_hmac('sha256', $token . '.' . $payload, $key);
            $item['url'] = IPTV_HOSTING . '/calamar-iptv.php?lista=' . $token . '&play=' . $payload . '.' . $signed;
        }
        unset($item);
        iptvTrackedFolders($folder['groups'], $token);
    }
    unset($folder);
}

function iptvSignedPlayback($token, $uid, $play) {
    $key = iptvSigningKey();
    if ($key === '' || !is_string($play) || !preg_match('/^([A-Za-z0-9_-]{1,12000})\.([a-f0-9]{64})$/D', $play, $m)
        || !hash_equals(hash_hmac('sha256', $token . '.' . $m[1], $key), $m[2])) iptvFail(403, 'Enlace de reproducción no válido.');
    $data = json_decode((string)base64_decode(strtr($m[1], '-_', '+/'), true), true);
    if (!is_array($data) || count($data) !== 3) iptvFail(403, 'Enlace de reproducción no válido.');
    iptvRedirect($uid, ['url' => $data[0], 'target' => $data[1], 'full' => $data[2]]);
}

function iptvXcId($key, $used) {
    $try = 0;
    do {
        // Several TV clients decode these fields as signed 32-bit integers.
        $id = 1 + (hexdec(substr(hash('sha256', $key . ':' . $try++), 0, 8)) % 2147483646);
    } while (isset($used[$id]));
    return $id;
}

function iptvXcCatalog($folders) {
    $catalog = ['live' => [], 'movie' => [], 'series' => [], 'episodes' => []];
    $category = 0;
    foreach ($folders as $group => $folder) {
        $label = $group === 'Series (canales)' ? 'Cine y ficción TV' : $group;
        $entries = [$folder['stations']];
        $pending = array_values($folder['groups']);
        while ($pending) {
            $next = array_pop($pending);
            $entries[] = $next['stations'];
            array_push($pending, ...array_values($next['groups']));
        }
        $category++;
        $series = [];
        foreach ($entries as $stations) foreach ($stations as $station) {
            $type = $station['type'] ?? 'live';
            $station['category'] = (string)$category;
            $station['group'] = $label;
            $key = $station['target'] ?? $group . ':' . $station['full'];
            if ($type !== 'series') {
                $id = iptvXcId($key, $catalog[$type]);
                $catalog[$type][$id] = $station;
                continue;
            }
            $seriesKey = $station['seriesId'];
            if (!isset($series[$seriesKey])) {
                $series[$seriesKey] = iptvXcId($group . ':' . $seriesKey, $catalog['series']);
                $catalog['series'][$series[$seriesKey]] = ['category' => (string)$category, 'group' => $label,
                    'name' => $station['seriesTitle'], 'image' => $station['image'], 'episodes' => []];
            }
            $season = $station['season'];
            $id = iptvXcId($group . ':' . $seriesKey . ':' . $season . ':' . $station['episode'], $catalog['episodes']);
            $catalog['episodes'][$id] = $station;
            $catalog['series'][$series[$seriesKey]]['episodes'][$season][] = $id;
        }
    }
    return $catalog;
}

function iptvXcExtension($url) {
    parse_str(parse_url($url, PHP_URL_QUERY) ?: '', $query);
    if (($query['hls'] ?? '') === '1') return 'm3u8';
    $ext = strtolower(pathinfo(parse_url($url, PHP_URL_PATH) ?: '', PATHINFO_EXTENSION));
    return in_array($ext, ['m3u8', 'ts', 'mp4', 'mkv', 'm4v', 'webm', 'avi', 'mov', 'mpd'], true) ? $ext : 'mp4';
}

function iptvXcRows($catalog, $type, $category = '') {
    $rows = [];
    foreach ($catalog[$type] as $id => $item) {
        if ($category !== '' && $item['category'] !== $category) continue;
        $row = ['num' => count($rows) + 1, 'name' => $item['name'], 'category_id' => $item['category'],
            'added' => '0', 'direct_source' => ''];
        if ($type === 'series') {
            $row += ['series_id' => $id, 'cover' => $item['image'], 'last_modified' => '0',
                'plot' => '', 'cast' => '', 'genre' => '', 'rating' => '0', 'backdrop_path' => []];
        } else {
            $row += ['stream_id' => $id, 'stream_icon' => $item['image'], 'stream_type' => $type,
                'epg_channel_id' => $type === 'live' ? $item['id'] : '', 'tv_archive' => 0,
                'container_extension' => $type === 'live' ? 'm3u8' : iptvXcExtension($item['url'])];
        }
        $rows[] = $row;
    }
    return $rows;
}

function iptvXcCategories($items) {
    $out = [];
    foreach ($items as $item) {
        $out[$item['category']] = ['category_id' => $item['category'], 'category_name' => $item['group'], 'parent_id' => 0];
    }
    return array_values($out);
}

function iptvXcSeriesInfo($catalog, $id) {
    $item = $catalog['series'][$id] ?? null;
    if (!$item) return (object)[];
    $episodes = [];
    $seasons = [];
    ksort($item['episodes'], SORT_NUMERIC);
    foreach ($item['episodes'] as $season => $items) {
        usort($items, function ($a, $b) use ($catalog) {
            return $catalog['episodes'][$a]['episode'] <=> $catalog['episodes'][$b]['episode'];
        });
        $seasons[] = ['season_number' => $season, 'name' => 'Temporada ' . $season, 'episode_count' => count($items), 'cover' => $item['image']];
        foreach ($items as $episodeId) {
            $episode = $catalog['episodes'][$episodeId];
            $episodes[$season][] = ['id' => (string)$episodeId, 'episode_num' => $episode['episode'],
                'title' => $episode['episodeTitle'] ?: 'Capítulo ' . $episode['episode'],
                'container_extension' => iptvXcExtension($episode['url']), 'season' => $season,
                'info' => ['movie_image' => $episode['image']], 'direct_source' => ''];
        }
    }
    return ['info' => ['name' => $item['name'], 'cover' => $item['image'], 'category_id' => $item['category'],
        'plot' => '', 'cast' => '', 'genre' => ''], 'seasons' => $seasons, 'episodes' => (object)$episodes];
}

function iptvXcReply($status, $data) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function iptvXcMain($route = '', $readSubscription = 'iptvSubscription') {
    $username = $_GET['username'] ?? '';
    $token = $_GET['password'] ?? '';
    $id = 0;
    if ($route !== '') {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
        if (!preg_match('~^/(live|movie|series)/(calamar)/([a-zA-Z0-9]{10,32})/([1-9]\d{0,9})(?:\.[a-zA-Z0-9]{1,8})?$~D', $path, $m)
            || $m[1] !== $route) iptvFail(404, 'Enlace de reproducción no válido.');
        $username = $m[2]; $token = $m[3]; $id = (int)$m[4];
    }
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) iptvFail(405, 'Método no permitido.');
    try {
        $list = $username === 'calamar' ? $readSubscription($token) : null;
        $valid = $list && ($list['expires'] ?? PHP_INT_MAX) > time();
        if (!$valid) {
            if ($route !== '') iptvFail(403, 'Lista no válida o caducada.');
            iptvXcReply(200, ['user_info' => ['auth' => 0, 'status' => $list ? 'Expired' : 'Disabled']]);
        }
        $action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';
        if ($route === '' && $action === '') {
            iptvXcReply(200, ['user_info' => ['username' => $username, 'auth' => 1, 'status' => 'Active',
                'exp_date' => $list['expires'] ? (string)$list['expires'] : null, 'is_trial' => '0',
                'allowed_output_formats' => ['m3u8', 'ts']],
                'server_info' => ['url' => parse_url(IPTV_HOSTING, PHP_URL_HOST), 'port' => '80', 'https_port' => '443',
                    'server_protocol' => 'https', 'timezone' => 'Europe/Madrid', 'timestamp_now' => time(),
                    'time_now' => (new DateTimeImmutable('now', new DateTimeZone('Europe/Madrid')))->format('Y-m-d H:i:s')]]);
        }
        $actions = ['get_live_categories' => ['live', true], 'get_live_streams' => ['live', false],
            'get_vod_categories' => ['movie', true], 'get_vod_streams' => ['movie', false],
            'get_series_categories' => ['series', true], 'get_series' => ['series', false],
            'get_series_info' => ['series', false], 'get_vod_info' => ['movie', false]];
        if ($route === '' && !isset($actions[$action])) iptvXcReply(200, []);
        $type = $route ?: $actions[$action][0];
        [$folders] = iptvCachedCatalog($type !== 'live', $route !== '');
        $catalog = iptvXcCatalog($folders);
        if ($route !== '') iptvRedirect($list['uid'], $catalog[$route === 'series' ? 'episodes' : $route][$id] ?? []);
        if ($action === 'get_series_info') iptvXcReply(200, iptvXcSeriesInfo($catalog, (int)($_GET['series_id'] ?? 0)));
        if ($action === 'get_vod_info') {
            $movieId = (int)($_GET['vod_id'] ?? 0);
            $item = $catalog['movie'][$movieId] ?? null;
            iptvXcReply(200, $item ? ['info' => ['name' => $item['name'], 'movie_image' => $item['image']],
                'movie_data' => ['stream_id' => $movieId, 'name' => $item['name'], 'container_extension' => iptvXcExtension($item['url']),
                    'category_id' => $item['category'], 'direct_source' => '']] : (object)[]);
        }
        $category = is_string($_GET['category_id'] ?? null) ? $_GET['category_id'] : '';
        iptvXcReply(200, $actions[$action][1] ? iptvXcCategories($catalog[$type]) : iptvXcRows($catalog, $type, $category));
    } catch (Throwable $error) { iptvFail(502, 'No se pudo consultar Calamar IPTV.'); }
}

function iptvHistoryEntry($entry) {
    return ['target' => $entry['target'], 'title' => $entry['title'], 'device' => 'iptv',
        'profile' => '', 'startedAt' => (new DateTimeImmutable('@' . $entry['time']))->format(DATE_ATOM)];
}

function iptvManage() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && !in_array($origin, ['https://djyuanyo.github.io', IPTV_HOSTING, 'https://www.calamarmenciano.com'], true)) {
        iptvXcReply(403, ['error' => 'Origen no permitido.']);
    }
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') iptvXcReply(405, ['error' => 'Método no permitido.']);
    try {
        require_once __DIR__ . '/calamar-images.php';
        $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer ([A-Za-z0-9_.-]{1,8192})$/D', $authorization, $m) || !imageAdministrator($m[1])) {
            iptvXcReply(401, ['error' => 'Se requiere la cuenta administradora.']);
        }
        $body = file_get_contents('php://input', false, null, 0, 250001);
        $data = is_string($body) && strlen($body) <= 250000 ? json_decode($body, true) : null;
        if (!is_array($data)) iptvXcReply(400, ['error' => 'Solicitud IPTV no válida.']);
        $action = $data['action'] ?? '';
        if ($action === 'originals') {
            $originals = $data['originals'] ?? null;
            if (!is_array($originals) || !$originals || count($originals) > 200) iptvXcReply(400, ['error' => 'Enlaces originales no válidos.']);
            foreach ($originals as $key => $url) {
                if (!preg_match('/^[a-f0-9]{32}$/D', (string)$key) || iptvDirectChannel($url) === null) {
                    iptvXcReply(400, ['error' => 'Un enlace original IPTV no es válido.']);
                }
            }
            $updated = iptvStateLocked('originals', function () use ($originals) {
                return iptvStateWrite('originals.json', array_replace(iptvStateRead('originals.json'), $originals));
            });
            if (!$updated) iptvXcReply(503, ['error' => 'El hosting no permite guardar las fuentes en una carpeta privada.']);
            $dir = iptvStateDir();
            foreach (['catalog-all.json', 'catalog-live.json'] as $name) {
                iptvStateLocked($name, function () use ($dir, $name) { if (is_file("$dir/$name")) @unlink("$dir/$name"); });
            }
            iptvXcReply(200, ['saved' => count($originals)]);
        }
        if ($action === 'history') {
            $uid = $data['uid'] ?? '';
            if (!is_string($uid) || !preg_match('/^[A-Za-z0-9_-]{1,128}$/D', $uid)) iptvXcReply(400, ['error' => 'Usuario no válido.']);
            $entries = iptvStateRead(iptvHistoryFile($uid))['entries'] ?? [];
            $cursor = $data['cursor'] ?? null;
            $offset = $cursor === null ? -1 : array_search($cursor, array_column($entries, 'id'), true);
            $page = $offset === false ? [] : array_slice($entries, $offset + 1, 31);
            iptvXcReply(200, ['entries' => array_map('iptvHistoryEntry', array_slice($page, 0, 30)),
                'next' => count($page) > 30 ? $page[29]['id'] : null]);
        }
        if ($action === 'report' || $action === 'activity') {
            $targets = $data['targets'] ?? [];
            $from = $data['from'] ?? '';
            $to = $data['to'] ?? '';
            if (!is_array($targets) || count($targets) > 1000 || !is_string($from) || !is_string($to)
                || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $to)) {
                iptvXcReply(400, ['error' => 'Periodo o contenido no válido.']);
            }
            $zone = new DateTimeZone('Europe/Madrid');
            $start = (new DateTimeImmutable($from, $zone))->getTimestamp();
            $wanted = array_fill_keys(array_filter($targets, 'is_string'), true);
            $out = []; $days = [];
            $dir = iptvStateDir();
            foreach ($dir ? (glob("$dir/history-*.json") ?: []) : [] as $file) {
                $log = iptvStateRead(basename($file));
                $summary = null;
                foreach ($log['entries'] ?? [] as $entry) {
                    if ($entry['time'] < $start) break;
                    $day = (new DateTimeImmutable('@' . $entry['time']))->setTimezone($zone)->format('Y-m-d');
                    if ($day > $to) continue;
                    if ($action === 'activity') {
                        $target = $entry['target'];
                        $days[$day][$target] = ($days[$day][$target] ?? 0) + 1;
                        continue;
                    }
                    if (!isset($wanted[$entry['target']])) continue;
                    if (!$summary) $summary = ['count' => 0, 'latest' => iptvHistoryEntry($entry), 'at' => $entry['time'] * 1000];
                    $summary['count']++;
                }
                if ($summary) $out[$log['uid']] = $summary;
            }
            iptvXcReply(200, $action === 'activity' ? ['days' => (object)$days] : ['people' => (object)$out]);
        }
        iptvXcReply(400, ['error' => 'Acción IPTV no válida.']);
    } catch (Throwable $error) { iptvXcReply(502, ['error' => 'No se pudieron consultar los datos de IPTV.']); }
}
