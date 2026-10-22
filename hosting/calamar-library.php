<?php
/**
 * Films, series and documentaries from Google Drive folders (or folders of this hosting), Plex style,
 * with data from TMDB.
 *
 * Public:  GET ?action=library  -> the published library (titles, posters, synopsis, episodes, links).
 *          The same file is also published to GitHub (library/calamar-library.json), so the web and the
 *          app keep showing it, and the videos keep playing from Drive, while this hosting is down.
 * Admin:   POST (Bearer Firebase ID token of the administrator, checked by Google as in calamar-images.php)
 *          configure | scan | match-next | search | match | publish.
 *
 * Google Drive: each section is a folder shared as «Cualquier persona con el enlace». It is read with the
 * Drive API and a Google API key (by default the public key of the Firebase project, which needs the
 * Google Drive API enabled); videos play from https://www.googleapis.com/drive/v3/files/ID?alt=media.
 *
 * Folders: every video in Películas/Documentales is one title (named after its file, or after its own
 * folder when that folder holds only it). Every subfolder of Series is a series and every video inside
 * it (also in "Temporada N" subfolders) is an episode: 1x01, S01E01 or Cap.101/Cap.1001 give the
 * season and episode. The TMDB key and the library live outside public_html.
 */
require_once __DIR__ . '/calamar-images.php'; // imageAdministrator() and imageHttp(); its page only runs when opened.

const LIBRARY_PUBLIC = 'https://calamarmenciano.com/';
const LIBRARY_VIDEO = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'wmv', 'mpg', 'mpeg', 'ts', 'm2ts', 'webm', 'flv', 'vob'];
const LIBRARY_SECTIONS = ['movies' => 'MENCIA MEDIA/PELICULAS', 'series' => 'MENCIA MEDIA/SERIES', 'documentaries' => 'MENCIA MEDIA/DOCUMENTALES'];
const LIBRARY_TMDB = 'https://api.themoviedb.org/3';
const LIBRARY_IMAGE = 'https://image.tmdb.org/t/p/';
const LIBRARY_BATCH = 8;
const LIBRARY_DRIVE = 'https://www.googleapis.com/drive/v3/files';
const LIBRARY_GITHUB_PATH = 'library/calamar-library.json';

function libraryPrivate($name) { return (getenv('CALAMAR_LIBRARY_DIR') ?: dirname(__DIR__)) . '/' . $name; }
function libraryPublicRoot() { return getenv('CALAMAR_LIBRARY_ROOT') ?: ($_SERVER['DOCUMENT_ROOT'] ?? __DIR__); }

function libraryReadJson($name, $empty) {
    $path = libraryPrivate($name);
    $data = is_file($path) ? json_decode((string)file_get_contents($path), true) : null;
    return is_array($data) ? $data : $empty;
}
function libraryWriteJson($name, $data) {
    $path = libraryPrivate($name); $temp = tempnam(dirname($path), '.calamar-library-');
    if ($temp === false) throw new RuntimeException('No se puede guardar la biblioteca en el hosting.');
    try {
        if (!chmod($temp, 0600) || file_put_contents($temp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX) === false
            || !rename($temp, $path)) throw new RuntimeException('No se pudo guardar la biblioteca.');
    } finally { if (is_file($temp)) @unlink($temp); }
}
function libraryConfig() {
    $config = libraryReadJson('calamar-library-config.json', []);
    $folders = [];
    foreach (LIBRARY_SECTIONS as $section => $default) $folders[$section] = is_string($config['folders'][$section] ?? null) ? $config['folders'][$section] : $default;
    $drive = is_string($config['drive_key'] ?? null) && $config['drive_key'] !== '' ? $config['drive_key'] : IMAGE_FIREBASE_KEY;
    return ['tmdb' => is_string($config['tmdb'] ?? null) ? $config['tmdb'] : '', 'folders' => $folders, 'drive_key' => $drive,
        'own_drive_key' => is_string($config['drive_key'] ?? null) && $config['drive_key'] !== ''];
}

// ---- Google Drive ----------------------------------------------------------------------------

/** The folder id of a Drive folder link (…/folders/ID…) or of a bare id; null for a hosting path. */
function libraryDriveFolder($value) {
    $value = trim((string)$value);
    if (preg_match('~^https://drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|open\?id=)([A-Za-z0-9_-]{10,})~', $value, $m)) return $m[1];
    if (preg_match('~^[A-Za-z0-9_-]{25,}$~D', $value)) return $value;
    return null;
}
function libraryDriveUrl($id, $key) { return LIBRARY_DRIVE . '/' . rawurlencode($id) . '?alt=media&key=' . rawurlencode($key); }

/** One page of a Drive folder; errors explain what to change in Drive or Google Cloud. */
function libraryDriveList($folder, $key, $request, $page = '') {
    $params = ['q' => "'" . $folder . "' in parents and trashed = false", 'fields' => 'nextPageToken,files(id,name,mimeType)',
        'pageSize' => 1000, 'supportsAllDrives' => 'true', 'includeItemsFromAllDrives' => 'true', 'key' => $key];
    if ($page !== '') $params['pageToken'] = $page;
    [$status, $data] = $request('GET', LIBRARY_DRIVE . '?' . http_build_query($params), null, null);
    if ($status === 403 && str_contains(json_encode($data), 'accessNotConfigured')) throw new InvalidArgumentException('Activa la «Google Drive API» en Google Cloud para el proyecto de la clave (por defecto, menciamedia) y vuelve a escanear.');
    if ($status === 400 || $status === 403) throw new InvalidArgumentException('Google Drive no acepta la clave de la API. Revísala en Pelis y series → Configuración.');
    if ($status === 404) throw new InvalidArgumentException('No se encuentra una carpeta de Drive: compártela como «Cualquier persona con el enlace» y copia su enlace.');
    if ($status !== 200 || !is_array($data)) throw new RuntimeException('Google Drive no responde ahora. Vuelve a intentarlo.');
    return $data;
}

/**
 * Videos under a Drive folder, as the scan reads hosting folders: [path inside the folder, stable key, link].
 * Subfolders are followed (series seasons, «Película (2009)/Película.mkv»), up to 6 levels and 3000 folders.
 */
function libraryDriveVideos($folder, $key, $request = 'imageHttp', $limit = 5000) {
    $out = []; $queue = [[$folder, '', 0]]; $seen = [$folder => true]; $folders = 0;
    while ($queue && count($out) < $limit) {
        [$id, $prefix, $depth] = array_shift($queue);
        if (++$folders > 3000) break;
        $page = '';
        do {
            $data = libraryDriveList($id, $key, $request, $page);
            foreach ($data['files'] ?? [] as $file) {
                $name = str_replace('/', '-', (string)($file['name'] ?? ''));
                if ($name === '' || str_starts_with($name, '.')) continue;
                if (($file['mimeType'] ?? '') === 'application/vnd.google-apps.folder') {
                    if ($depth < 6 && !isset($seen[$file['id']])) { $seen[$file['id']] = true; $queue[] = [$file['id'], $prefix . $name . '/', $depth + 1]; }
                    continue;
                }
                $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                if (!in_array($extension, LIBRARY_VIDEO, true) && !str_starts_with((string)($file['mimeType'] ?? ''), 'video/')) continue;
                $out[] = ['path' => $prefix . $name, 'key' => 'drive:' . $file['id'], 'url' => libraryDriveUrl($file['id'], $key)];
            }
            $page = (string)($data['nextPageToken'] ?? '');
        } while ($page !== '' && count($out) < $limit);
    }
    usort($out, fn($a, $b) => strnatcasecmp($a['path'], $b['path']));
    return $out;
}

// ---- Names -----------------------------------------------------------------------------------

/** "Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1001][AC3 5.1]" -> ['title' => 'Los Hombres De Paco', 'year' => null]. */
function libraryCleanTitle($name) {
    $name = preg_replace('/\.(' . implode('|', LIBRARY_VIDEO) . ')$/i', '', $name);
    $year = null;
    if (preg_match('/[\[(. _-]((?:19|20)\d{2})[\]). _-]/', ' ' . $name . ' ', $m)) $year = (int)$m[1];
    $name = preg_replace('/\[[^\]]*\]|\{[^}]*\}/', ' ', $name);
    $name = preg_replace('/\(([^)]*)\)/', ' ', $name);
    $name = preg_replace('/(?<=[a-z0-9])[._](?=[a-z0-9])/i', ' ', $name);
    $name = preg_replace('/\b(?:S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|cap(?:[ií]tulo)?[ .]?\d{1,4}|episodio \d+|temporada \d+|season \d+|(?:19|20)\d{2}|2160p|1080p|720p|480p|4k|uhd|hdtv|hdrip|bdrip|brrip|bluray|blu-ray|web-?dl|webrip|dvdrip|x26[45]|h ?26[45]|hevc|xvid|divx|aac|ac3|dts|5 1|castellano|espa[nñ]ol|spanish|latino|dual|vose|subs?|proper|repack|extended|www [a-z0-9-]+ [a-z]{2,4})\b.*$/iu', ' ', $name);
    $name = trim(preg_replace('/\s+/', ' ', preg_replace('/\s+[-–—]\s*$|^\s*[-–—]\s+/u', ' ', $name)), " -–—.");
    return ['title' => $name, 'year' => $year];
}

/** Season and episode from a file name (and its folder): 1x01, S01E01, Cap.101 / Cap.1001, or "Temporada 2" + "Capítulo 5". */
function libraryEpisode($file, $folder = '') {
    if (preg_match('/S(\d{1,2})[ ._-]?E(\d{1,3})/i', $file, $m)) return [(int)$m[1], (int)$m[2]];
    if (preg_match('/(?<!\d)(\d{1,2})x(\d{1,3})(?!\d)/i', $file, $m)) return [(int)$m[1], (int)$m[2]];
    if (preg_match('/cap(?:[ií]tulo)?[ ._-]*(\d{3,4})(?!\d)/iu', $file, $m)) return [intdiv((int)$m[1], 100), (int)$m[1] % 100];
    $season = preg_match('/(?:temporada|season|T)[ ._-]*(\d{1,2})(?!\d)/i', $folder . ' ' . $file, $s) ? (int)$s[1] : 1;
    if (preg_match('/(?:cap(?:[ií]tulo)?|episodio|episode|ep|e)[ ._-]*(\d{1,3})(?!\d)/iu', $file, $m)) return [$season, (int)$m[1]];
    return null;
}

function libraryUrl($relative) { return LIBRARY_PUBLIC . implode('/', array_map('rawurlencode', explode('/', $relative))); }
function libraryId($prefix, $relative) { return $prefix . substr(hash('sha256', $relative), 0, 16); }

/** Video files under a folder, relative to the public root, sorted; at most $limit. */
function libraryVideos($root, $relative, $limit = 5000) {
    $base = realpath($root . '/' . $relative);
    $rootReal = realpath($root);
    if ($base === false || $rootReal === false || !is_dir($base) || !str_starts_with($base . '/', rtrim($rootReal, '/') . '/')) return [];
    $out = [];
    $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS | FilesystemIterator::UNIX_PATHS));
    foreach ($items as $file) {
        if (count($out) >= $limit) break;
        if (!$file->isFile() || $file->isLink() || !in_array(strtolower($file->getExtension()), LIBRARY_VIDEO, true)) continue;
        if (str_starts_with($file->getFilename(), '.')) continue;
        $out[] = substr($file->getPathname(), strlen(rtrim($rootReal, '/')) + 1);
    }
    natcasesort($out);
    return array_values($out);
}

/** Hosting videos of a section folder, in the form the scan uses: [path inside the folder, stable key, link]. */
function libraryHostingVideos($root, $relative) {
    return array_map(fn($video) => ['path' => substr($video, strlen($relative) + 1), 'key' => $video, 'url' => libraryUrl($video)],
        libraryVideos($root, $relative));
}

/**
 * Folder contents as titles (films, documentaries) or series with episodes. A section is a Google Drive
 * folder (link or id) or a folder of this hosting; `$drive` reads Drive folders (tests pass a fake one).
 */
function libraryScan($root, $folders, $drive = null) {
    $sections = [];
    foreach ($folders as $section => $place) {
        $driveFolder = libraryDriveFolder($place);
        $relative = trim(str_replace('\\', '/', $place), '/');
        $videos = $driveFolder !== null ? $drive($driveFolder) : libraryHostingVideos($root, $relative);
        $base = $driveFolder !== null ? 'drive:' . $driveFolder : $relative;
        $items = [];
        if ($section === 'series') {
            $series = [];
            foreach ($videos as $video) {
                if (!str_contains($video['path'], '/')) continue; // A series is a folder.
                $series[explode('/', $video['path'])[0]][] = $video;
            }
            foreach ($series as $name => $files) {
                $clean = libraryCleanTitle($name);
                $episodes = [];
                foreach ($files as $index => $file) {
                    $parts = explode('/', $file['path']);
                    $number = libraryEpisode(end($parts), $parts[count($parts) - 2] ?? '') ?? [1, $index + 1];
                    $episodes[] = ['id' => libraryId('e', $file['key']), 'season' => $number[0], 'episode' => $number[1],
                        'file' => end($parts), 'url' => $file['url']];
                }
                usort($episodes, fn($a, $b) => [$a['season'], $a['episode'], $a['file']] <=> [$b['season'], $b['episode'], $b['file']]);
                $items[] = ['id' => libraryId('s', $base . '/' . $name), 'kind' => 'tv', 'title' => $clean['title'] ?: $name,
                    'year' => $clean['year'], 'folder' => $name, 'episodes' => $episodes];
            }
        } else {
            $byFolder = [];
            foreach ($videos as $video) $byFolder[dirname($video['path'])] = ($byFolder[dirname($video['path'])] ?? 0) + 1;
            foreach ($videos as $video) {
                $parts = explode('/', $video['path']);
                $file = end($parts);
                // Plex style "Avatar (2009)/Avatar.mkv": a folder holding just this video names it.
                $folder = count($parts) > 1 ? $parts[count($parts) - 2] : null;
                $alone = $folder !== null && $byFolder[dirname($video['path'])] === 1;
                $clean = libraryCleanTitle($alone ? $folder : $file);
                if ($clean['year'] === null) $clean['year'] = libraryCleanTitle($file)['year'];
                $items[] = ['id' => libraryId('m', $video['key']), 'kind' => 'movie', 'title' => $clean['title'] ?: $file,
                    'year' => $clean['year'], 'file' => $file, 'url' => $video['url']];
            }
        }
        usort($items, fn($a, $b) => strcasecmp($a['title'], $b['title']));
        $sections[$section] = $items;
    }
    return $sections;
}

// ---- TMDB -----------------------------------------------------------------------------------

function libraryTmdb($path, $params, $key, $request = 'imageHttp') {
    $bearer = str_contains($key, '.') ? $key : null; // v4 read token (JWT) or v3 key.
    if (!$bearer) $params['api_key'] = $key;
    $params['language'] = 'es-ES';
    [$status, $data] = $request('GET', LIBRARY_TMDB . $path . '?' . http_build_query($params), null, $bearer);
    if ($status === 401) throw new InvalidArgumentException('TMDB no acepta la clave. Revísala en Administración → Pelis y series.');
    if ($status !== 200 || !is_array($data)) throw new RuntimeException('TMDB no responde ahora. Vuelve a intentarlo.');
    return $data;
}

/** Candidates for a title: [{id, kind, title, year, poster, overview}]. */
function librarySearch($title, $year, $kind, $key, $request = 'imageHttp') {
    $out = [];
    foreach ($kind === 'tv' ? ['tv'] : ['movie', 'tv'] as $type) {
        $params = ['query' => $title, 'include_adult' => 'false'];
        if ($year) $params[$type === 'tv' ? 'first_air_date_year' : 'year'] = $year;
        $data = libraryTmdb('/search/' . $type, $params, $key, $request);
        foreach (array_slice($data['results'] ?? [], 0, 8) as $r) {
            $date = $r['release_date'] ?? $r['first_air_date'] ?? '';
            $out[] = ['id' => (int)$r['id'], 'kind' => $type, 'title' => $r['title'] ?? $r['name'] ?? '', 'year' => $date ? (int)substr($date, 0, 4) : null,
                'poster' => !empty($r['poster_path']) ? LIBRARY_IMAGE . 'w185' . $r['poster_path'] : '', 'overview' => mb_substr($r['overview'] ?? '', 0, 220)];
        }
        if ($out && $kind !== 'tv') break; // Films first; series only when no film matches.
    }
    return $out;
}

/** Details in Spanish: synopsis, genres, cast, rating, images (and episode names of the given seasons). */
function libraryDetails($id, $kind, $key, $seasons = [], $request = 'imageHttp') {
    $append = ['credits'];
    foreach (array_slice(array_values(array_unique($seasons)), 0, 18) as $season) $append[] = 'season/' . (int)$season;
    $d = libraryTmdb('/' . $kind . '/' . (int)$id, ['append_to_response' => implode(',', $append)], $key, $request);
    $date = $d['release_date'] ?? $d['first_air_date'] ?? '';
    $info = ['id' => (int)$id, 'kind' => $kind, 'title' => $d['title'] ?? $d['name'] ?? '', 'year' => $date ? (int)substr($date, 0, 4) : null,
        'overview' => $d['overview'] ?? '', 'genres' => array_values(array_map(fn($g) => $g['name'], $d['genres'] ?? [])),
        'cast' => array_values(array_map(fn($c) => ['name' => $c['name'], 'character' => $c['character'] ?? ''], array_slice($d['credits']['cast'] ?? [], 0, 10))),
        'rating' => isset($d['vote_average']) ? round((float)$d['vote_average'], 1) : null, 'votes' => (int)($d['vote_count'] ?? 0),
        'runtime' => (int)($d['runtime'] ?? ($d['episode_run_time'][0] ?? 0)) ?: null,
        'poster' => !empty($d['poster_path']) ? LIBRARY_IMAGE . 'w342' . $d['poster_path'] : '',
        'backdrop' => !empty($d['backdrop_path']) ? LIBRARY_IMAGE . 'w1280' . $d['backdrop_path'] : ''];
    if ($kind === 'tv') {
        $info['episodes'] = [];
        foreach ($seasons as $season) foreach ($d['season/' . (int)$season]['episodes'] ?? [] as $e) {
            $info['episodes'][(int)$season . 'x' . (int)$e['episode_number']] = ['name' => $e['name'] ?? '', 'overview' => mb_substr($e['overview'] ?? '', 0, 400),
                'still' => !empty($e['still_path']) ? LIBRARY_IMAGE . 'w300' . $e['still_path'] : ''];
        }
    }
    return $info;
}

/** A first result is accepted automatically only when its title is close to the folder or file name. */
function libraryConfident($wanted, $found) {
    $norm = fn($s) => preg_replace('/[^a-z0-9]+/', '', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', (string)$s) ?: $s));
    $a = $norm($wanted); $b = $norm($found);
    if ($a === '' || $b === '') return false;
    similar_text($a, $b, $percent);
    return $a === $b || str_contains($b, $a) || str_contains($a, $b) || $percent >= 80;
}

// ---- Library ----------------------------------------------------------------------------------

/** Scan merged with the matches chosen so far; this is what viewers download. */
function libraryPublish($scan, $matches, $details) {
    $out = [];
    foreach ($scan as $section => $items) {
        $out[$section] = [];
        foreach ($items as $item) {
            $match = $matches[$item['id']] ?? null;
            $info = $match && !empty($match['id']) ? ($details[$match['kind'] . ':' . $match['id']] ?? null) : null;
            if ($info) {
                $item['tmdb'] = array_diff_key($info, ['episodes' => 1]);
                if ($item['kind'] === 'tv') foreach ($item['episodes'] as &$e) {
                    $extra = $info['episodes'][$e['season'] . 'x' . $e['episode']] ?? null;
                    if ($extra) $e += $extra;
                }
                unset($e);
            }
            $item['status'] = $match === null ? 'pending' : (empty($match['id']) ? 'none' : 'matched');
            $out[$section][] = $item;
        }
    }
    return ['updatedAt' => gmdate('c'), 'sections' => $out, 'attribution' => 'Datos e imágenes de TMDB. Este producto usa la API de TMDB, pero TMDB no lo respalda ni certifica.'];
}

function librarySeasons($item) { return array_values(array_unique(array_map(fn($e) => $e['season'], $item['episodes'] ?? []))); }

/** Looks up a few unmatched titles; the admin page repeats it until nothing is pending. */
function libraryMatchNext($state, $key, $request = 'imageHttp') {
    $done = 0;
    foreach ($state['scan'] as $section => $items) foreach ($items as $item) {
        if ($done >= LIBRARY_BATCH) break 2;
        if (array_key_exists($item['id'], $state['matches'])) continue;
        $done++;
        $found = librarySearch($item['title'], $item['year'], $section === 'series' ? 'tv' : 'movie', $key, $request);
        $best = $found[0] ?? null;
        if (!$best || !libraryConfident($item['title'], $best['title'])) { $state['matches'][$item['id']] = ['id' => null]; continue; }
        $state['matches'][$item['id']] = ['id' => $best['id'], 'kind' => $best['kind'], 'auto' => true];
        $state['details'][$best['kind'] . ':' . $best['id']] = libraryDetails($best['id'], $best['kind'], $key, librarySeasons($item), $request);
    }
    $pending = 0;
    foreach ($state['scan'] as $items) foreach ($items as $item) if (!array_key_exists($item['id'], $state['matches'])) $pending++;
    return [$state, $pending];
}

/**
 * Copies the published library to GitHub (library/calamar-library.json) with the GitHub credential of
 * calamar-images.php, so it can be read while this hosting is down. Returns false without a credential.
 */
function libraryPublishGithub($request = 'imageHttp') {
    $token = imageToken();
    if ($token === '') return false;
    $content = (string)file_get_contents(libraryPrivate('calamar-library.json'));
    $api = 'https://api.github.com/repos/' . IMAGE_REPO . '/contents/' . LIBRARY_GITHUB_PATH;
    [$status, $existing] = $request('GET', $api . '?ref=main', null, $token);
    if ($status === 200 && base64_decode(preg_replace('/\s/', '', $existing['content'] ?? ''), true) === $content) return true;
    $body = ['message' => 'Actualizar la biblioteca de películas y series', 'content' => base64_encode($content), 'branch' => 'main'];
    if ($status === 200 && !empty($existing['sha'])) $body['sha'] = $existing['sha'];
    elseif ($status !== 404 && $status !== 200) throw new RuntimeException('GitHub rechazó la conexión. Revisa la credencial de imágenes (Contents: lectura y escritura).');
    [$status] = $request('PUT', $api, $body, $token);
    if (!in_array($status, [200, 201], true)) throw new RuntimeException('GitHub no permitió guardar la biblioteca. Revisa la credencial de imágenes.');
    return true;
}

function libraryState() { return libraryReadJson('calamar-library-state.json', ['scan' => [], 'matches' => [], 'details' => []]); }
function librarySave($state) {
    libraryWriteJson('calamar-library-state.json', $state);
    libraryWriteJson('calamar-library.json', libraryPublish($state['scan'], $state['matches'], $state['details']));
}

function libraryMain() {
    header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'GET' && ($_GET['action'] ?? '') === 'library') {
        // Public, like the channel catalog: anyone may download it; nothing private is inside.
        header('Access-Control-Allow-Origin: *'); header('Cache-Control: public, max-age=120');
        $path = libraryPrivate('calamar-library.json');
        header('Content-Type: application/json; charset=utf-8');
        if (!is_file($path)) { echo json_encode(['sections' => new stdClass()]); return; }
        $etag = '"' . md5_file($path) . '"'; header('ETag: ' . $etag);
        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); return; }
        if (!ob_start('ob_gzhandler')) ob_start();
        readfile($path); return;
    }
    header('Cache-Control: no-store');
    if ($origin !== '' && !in_array($origin, ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'], true)) { imageReply(403, ['error' => 'Origen no permitido.']); return; }
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS'); header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if ($method === 'OPTIONS') { http_response_code(204); return; }
    if ($method !== 'POST') { imageReply(405, ['error' => 'Método no permitido.']); return; }
    try {
        $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer ([A-Za-z0-9_.-]+)$/D', $authorization, $auth) || !imageAdministrator($auth[1])) { imageReply(401, ['error' => 'Entra con la cuenta de administrador de Google y vuelve a intentarlo.']); return; }
        set_time_limit(120);
        $data = json_decode((string)file_get_contents('php://input', false, null, 0, 20001), true, 8, JSON_THROW_ON_ERROR);
        $config = libraryConfig();
        $action = $data['action'] ?? '';
        $summary = fn($config) => ['configured' => $config['tmdb'] !== '', 'folders' => $config['folders'], 'ownDriveKey' => $config['own_drive_key'], 'github' => imageToken() !== ''];
        if ($action === 'status') { imageReply(200, $summary($config)); return; }
        if ($action === 'configure') {
            $key = trim((string)($data['tmdb'] ?? ''));
            if ($key !== '' && !preg_match('/^(?:[a-f0-9]{32}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/D', $key)) throw new InvalidArgumentException('La clave de TMDB no tiene un formato válido.');
            if ($key !== '') { libraryTmdb('/configuration', [], $key); $config['tmdb'] = $key; }
            foreach (LIBRARY_SECTIONS as $section => $default) {
                $value = trim((string)($data['folders'][$section] ?? $config['folders'][$section]));
                $driveFolder = libraryDriveFolder($value);
                $folder = $driveFolder !== null ? $value : trim(str_replace('\\', '/', $value), '/');
                if ($folder === '' || str_contains($folder, '..') || strlen($folder) > 300) throw new InvalidArgumentException('Carpeta no válida: pega el enlace de la carpeta de Google Drive.');
                $config['folders'][$section] = $folder;
            }
            if (array_key_exists('driveKey', $data)) {
                $driveKey = trim((string)$data['driveKey']);
                if ($driveKey !== '' && !preg_match('/^AIza[A-Za-z0-9_-]{35}$/D', $driveKey)) throw new InvalidArgumentException('La clave de Google no tiene un formato válido (empieza por AIza).');
                $config['drive_key'] = $driveKey;
            }
            $saved = $config; unset($saved['own_drive_key']);
            if ($saved['drive_key'] === IMAGE_FIREBASE_KEY) $saved['drive_key'] = '';
            libraryWriteJson('calamar-library-config.json', $saved);
            imageReply(200, $summary(libraryConfig())); return;
        }
        if ($config['tmdb'] === '' && in_array($action, ['match-next', 'search', 'match'], true)) throw new InvalidArgumentException('Añade la clave de TMDB antes de buscar títulos.');
        $state = libraryState();
        if ($action === 'scan') {
            $state['scan'] = libraryScan(libraryPublicRoot(), $config['folders'], fn($folder) => libraryDriveVideos($folder, $config['drive_key']));
            $ids = []; foreach ($state['scan'] as $items) foreach ($items as $item) $ids[$item['id']] = true;
            $state['matches'] = array_intersect_key($state['matches'], $ids);
            librarySave($state);
            imageReply(200, ['counts' => array_map('count', $state['scan'])]); return;
        }
        if ($action === 'match-next') {
            [$state, $pending] = libraryMatchNext($state, $config['tmdb']);
            librarySave($state);
            imageReply(200, ['pending' => $pending]); return;
        }
        if ($action === 'search') {
            $title = trim((string)($data['query'] ?? ''));
            if ($title === '' || mb_strlen($title) > 200) throw new InvalidArgumentException('Escribe el título que quieres buscar.');
            imageReply(200, ['results' => librarySearch($title, null, ($data['kind'] ?? '') === 'tv' ? 'tv' : 'movie', $config['tmdb'])]); return;
        }
        if ($action === 'match') {
            $itemId = (string)($data['item'] ?? ''); $item = null;
            foreach ($state['scan'] as $items) foreach ($items as $candidate) if ($candidate['id'] === $itemId) $item = $candidate;
            if (!$item) throw new InvalidArgumentException('Ese título ya no está en las carpetas. Vuelve a escanear.');
            if (empty($data['id'])) $state['matches'][$itemId] = ['id' => null];
            else {
                $kind = ($data['kind'] ?? '') === 'tv' ? 'tv' : 'movie';
                $state['details'][$kind . ':' . (int)$data['id']] = libraryDetails((int)$data['id'], $kind, $config['tmdb'], librarySeasons($item));
                $state['matches'][$itemId] = ['id' => (int)$data['id'], 'kind' => $kind];
            }
            librarySave($state);
            imageReply(200, ['ok' => true]); return;
        }
        if ($action === 'publish') { imageReply(200, ['github' => libraryPublishGithub()]); return; }
        throw new InvalidArgumentException('Acción no válida.');
    } catch (InvalidArgumentException | JsonException $e) { imageReply(400, ['error' => $e->getMessage()]); }
      catch (Throwable $e) { imageReply(502, ['error' => $e instanceof RuntimeException ? $e->getMessage() : 'No se pudo completar la operación.']); }
}
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { ini_set('display_errors', '0'); libraryMain(); }
