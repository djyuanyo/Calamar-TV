<?php
/**
 * Video files of this hosting (MKV, AVI…) for browsers: H.264 video is copied as it is and the audio
 * (often AC3/DTS, which Chrome and Firefox cannot play) becomes AAC stereo, in HLS that grows while
 * FFmpeg converts it. Only files inside this site's public folder are accepted. A converted file is
 * kept for good in calamar-video-cache (closed to direct access) and shared by every viewer; it is only
 * removed when its original is deleted or replaced. FFmpeg comes from the Chromecast installer.
 */
declare(strict_types=1);
ini_set('display_errors', '0');
umask(0077);
// calamar-cast.php only defines its helpers (castBinary, castCapabilities, castReply) with this flag.
if (!defined('CALAMAR_CAST_TEST_ONLY')) define('CALAMAR_CAST_TEST_ONLY', true);
require_once __DIR__ . '/calamar-cast.php';

const VIDEO_PUBLIC_URL = 'https://calamarmenciano.com/calamar-video.php';
const VIDEO_HOSTS = ['calamarmenciano.com', 'www.calamarmenciano.com'];
const VIDEO_EXTENSIONS = ['mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'mp4', 'webm', 'mpg', 'mpeg', 'ts', 'm2ts', 'vob'];
const VIDEO_MAX_CONVERSIONS = 2;

/** The file on disk for an address of this site, or null for anything else. */
function videoFile(string $address, string $publicRoot): ?string {
    $parts = parse_url($address);
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass'])
        || !in_array(strtolower($parts['host'] ?? ''), VIDEO_HOSTS, true) || isset($parts['port'])) return null;
    $path = rawurldecode($parts['path'] ?? '');
    if ($path === '' || str_contains($path, "\0")) return null;
    if (!in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), VIDEO_EXTENSIONS, true)) return null;
    $root = realpath($publicRoot);
    $file = realpath($publicRoot . '/' . ltrim($path, '/'));
    if ($root === false || $file === false || !is_file($file) || !str_starts_with($file, rtrim($root, '/') . '/')) return null;
    return $file;
}

/** Video codec of the file from FFmpeg's description of its streams ("Video: h264 …"). */
function videoCodec(string $binary, string $file): string {
    $output = [];
    @exec(escapeshellarg($binary) . ' -hide_banner -i ' . escapeshellarg($file) . ' 2>&1', $output);
    foreach ($output as $line) {
        if (preg_match('/Stream #\S+.*?: Video: ([a-z0-9_]+)/i', $line, $m)) return strtolower($m[1]);
    }
    return '';
}

function videoArguments(string $binary, string $file, string $folder, string $codec): array {
    // Browsers play H.264; anything else (HEVC, MPEG-4 Part 2…) is converted, which costs CPU.
    $video = $codec === 'h264'
        ? ['-c:v', 'copy']
        : ['-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2',
           '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '23', '-g', '48'];
    return array_merge([$binary, '-hide_banner', '-loglevel', 'quiet', '-nostdin', '-y', '-threads', '2',
        '-i', $file, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'], $video,
        ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000',
         '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file',
         '-hls_segment_filename', $folder . '/seg%d.ts', $folder . '/index.m3u8']);
}

/** A converter that runs to the end under a lock (one per file) and marks the result as complete. */
function videoWorker(string $command, string $folder): string {
    $dir = escapeshellarg($folder);
    return "#!/bin/sh\ncd $dir || exit 1\nexec 9>worker.lock\nflock -n 9 || exit 0\n"
        . "rm -f done failed\n$command </dev/null >/dev/null 2>&1 && touch done || touch failed\nrm -f worker.sh\n";
}

/** Removes conversions whose original was deleted or replaced (never one being converted). */
function videoSweep(string $root): void {
    foreach (glob($root . '/*', GLOB_ONLYDIR) ?: [] as $folder) {
        if (!preg_match('/\/[a-f0-9]{64}$/', $folder)) continue;
        [$file, $modified] = array_pad(explode("\n", (string)@file_get_contents($folder . '/source'), 2), 2, '');
        clearstatcache(true, $file);
        if ($file !== '' && is_file($file) && (string)filemtime($file) === trim($modified)) continue;
        if ($file === '' && time() - (int)@filemtime($folder) < 3600) continue; // Just created, not described yet.
        $lock = @fopen($folder . '/worker.lock', 'c');
        if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); continue; }
        foreach (glob($folder . '/*') ?: [] as $entry) @unlink($entry);
        if ($lock) fclose($lock);
        @rmdir($folder);
    }
}

function videoBusy(string $root): int {
    $busy = 0;
    foreach (glob($root . '/*/worker.lock') ?: [] as $path) {
        $lock = @fopen($path, 'c');
        if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) $busy++;
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    }
    return $busy;
}

/** Permanent folder next to this page; the web server never serves it directly (only this page does). */
function videoRoot(): string {
    $root = __DIR__ . '/calamar-video-cache';
    if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) {
        throw new RuntimeException('El hosting no permite crear la carpeta de vídeos convertidos.');
    }
    if (!is_file($root . '/.htaccess')) {
        file_put_contents($root . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    }
    if (!is_file($root . '/index.html')) file_put_contents($root . '/index.html', '');
    return $root;
}

/** Segment lines become absolute links to this page, so the playlist works from any origin. */
function videoPlaylist(string $playlist, string $token): string {
    return (string)preg_replace_callback('/^seg[0-9]+[.]ts$/m', fn($m) => VIDEO_PUBLIC_URL . '?action=media&session=' . $token . '&file=' . $m[0], $playlist);
}

if (defined('CALAMAR_VIDEO_TEST_ONLY')) return;

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: Range');
header('Access-Control-Expose-Headers: Content-Length');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }
if (!in_array($method, ['GET', 'HEAD'], true)) castReply(['error' => 'Método no permitido.'], 405);
$action = $_GET['action'] ?? 'status';

try {
    if ($action === 'status') {
        $cap = castCapabilities();
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Calamar vídeo</title>'
            . '<style>body{font:16px Arial,sans-serif;max-width:650px;margin:40px auto;padding:20px;background:#0b0d10;color:#f5f5f5}</style>'
            . '<h1>Calamar vídeo</h1><p>' . ($cap['ready'] ? 'Preparado: los vídeos del hosting se adaptan para el navegador.'
            : 'Falta FFmpeg o el hosting bloquea la ejecución de procesos. Instala Calamar Chromecast (calamar-cast-install.php).') . '</p></html>';
        exit;
    }

    $root = videoRoot();
    if ($action === 'media') {
        $token = $_GET['session'] ?? ''; $file = $_GET['file'] ?? '';
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)
            || !is_string($file) || !preg_match('/^(?:index[.]m3u8|seg[0-9]+[.]ts)$/D', $file)) castReply(['error' => 'Vídeo no encontrado.'], 404);
        $folder = $root . '/' . $token; $path = $folder . '/' . $file;
        if (!is_file($path) || is_link($path)) castReply(['error' => 'El vídeo ya no está preparado. Vuelve a abrirlo.'], 404);
        if ($file === 'index.m3u8') {
            header('Content-Type: application/vnd.apple.mpegurl');
            if ($method !== 'HEAD') echo videoPlaylist((string)file_get_contents($path), $token);
        } else {
            $handle = @fopen($path, 'rb');
            if (!$handle) castReply(['error' => 'Fragmento no disponible.'], 404);
            // Finished segments never change, so browsers may keep them while the viewer seeks.
            header('Cache-Control: private, max-age=3600');
            header('Content-Type: video/mp2t'); header('Content-Length: ' . fstat($handle)['size']);
            if ($method !== 'HEAD') fpassthru($handle);
            fclose($handle);
        }
        exit;
    }

    if ($action !== 'start' || $method !== 'GET') castReply(['error' => 'Acción no válida.'], 400);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && !in_array($origin, ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'], true)) {
        castReply(['error' => 'Origen no permitido.'], 403);
    }
    $file = videoFile((string)($_GET['src'] ?? ''), (string)($_SERVER['DOCUMENT_ROOT'] ?? __DIR__));
    if ($file === null) castReply(['error' => 'Solo se adaptan vídeos guardados en este hosting.'], 400);
    $cap = castCapabilities();
    if (!$cap['ready']) castReply(['error' => 'Falta FFmpeg en el hosting: instala Calamar Chromecast (calamar-cast-install.php).'], 503);

    videoSweep($root);
    $secretLock = fopen($root . '/secret.lock', 'c'); flock($secretLock, LOCK_EX);
    if (!is_file($root . '/secret')) file_put_contents($root . '/secret', random_bytes(32));
    // A replaced file (new modification time) gets a new conversion.
    $token = hash_hmac('sha256', $file . "\0" . filemtime($file), (string)file_get_contents($root . '/secret'));
    flock($secretLock, LOCK_UN); fclose($secretLock);
    $folder = $root . '/' . $token;
    if (!is_dir($folder)) @mkdir($folder, 0700);
    // Which original this conversion belongs to, so it can be removed if that file goes away or changes.
    if (!is_file($folder . '/source')) file_put_contents($folder . '/source', $file . "\n" . filemtime($file));
    $lock = fopen($folder . '/start.lock', 'c'); flock($lock, LOCK_EX);
    clearstatcache();
    $workerLock = fopen($folder . '/worker.lock', 'c');
    $running = !flock($workerLock, LOCK_EX | LOCK_NB);
    if ($workerLock && !$running) { flock($workerLock, LOCK_UN); }
    if ($workerLock) fclose($workerLock);
    $recent = is_file($folder . '/launched') && time() - filemtime($folder . '/launched') < 10;
    if (!$running && !$recent && !is_file($folder . '/done')) {
        if (videoBusy($root) >= VIDEO_MAX_CONVERSIONS) {
            flock($lock, LOCK_UN); fclose($lock);
            castReply(['error' => 'El hosting ya está preparando otros vídeos. Prueba de nuevo en unos minutos.'], 503);
        }
        foreach (glob($folder . '/seg*.ts*') ?: [] as $old) @unlink($old);
        @unlink($folder . '/index.m3u8'); @unlink($folder . '/failed');
        $command = implode(' ', array_map('escapeshellarg', videoArguments($cap['binary'], $file, $folder, videoCodec($cap['binary'], $file))));
        file_put_contents($folder . '/worker.sh', videoWorker($command, $folder));
        @touch($folder . '/launched');
        exec('nohup /bin/sh ' . escapeshellarg($folder . '/worker.sh') . ' </dev/null >/dev/null 2>&1 &');
    }
    flock($lock, LOCK_UN); fclose($lock);
    if (is_file($folder . '/failed') && !is_file($folder . '/index.m3u8')) castReply(['error' => 'FFmpeg no pudo leer este vídeo.'], 422);
    $playlist = is_file($folder . '/index.m3u8') ? (string)file_get_contents($folder . '/index.m3u8') : '';
    $complete = is_file($folder . '/done') || str_contains($playlist, '#EXT-X-ENDLIST');
    $ready = $complete || substr_count($playlist, '#EXTINF:') >= 2;
    castReply(['state' => $complete ? 'complete' : ($ready ? 'converting' : 'preparing'),
        'url' => $ready ? VIDEO_PUBLIC_URL . '?action=media&session=' . $token . '&file=index.m3u8' : null], $ready ? 200 : 202);
} catch (Throwable $error) {
    castReply(['error' => 'El hosting no pudo preparar el vídeo. Comprueba FFmpeg, permisos y procesos permitidos.'], 503);
}
