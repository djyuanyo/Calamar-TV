<?php
/** Shared, on-demand H.264/AAC HLS for Chromecast. No source URLs in public URLs or logs. */
declare(strict_types=1);
ini_set('display_errors', '0');
umask(0077);

const CAST_PUBLIC_URL = 'https://calamarmenciano.com/calamar-cast.php';
const CAST_INPUT_URL = 'https://calamarmenciano.com/calamar-tv-relay.php?stream=1';

function castSourceAllowed(string $source): bool {
    $u = @parse_url($source);
    return is_array($u) && strlen($source) <= 2048 && !preg_match('/[\r\n]/', $source)
        && ($u['scheme'] ?? '') === 'http' && ($u['host'] ?? '') === '31.43.191.125'
        && ($u['port'] ?? 0) === 8080
        && !isset($u['user']) && !isset($u['pass']) && !isset($u['query']) && !isset($u['fragment'])
        && (bool)preg_match('~^/[^/]+/[^/]+/[0-9]+(?:[.]ts)?$~D', $u['path'] ?? '');
}

function castRoot(): string {
    $root = sys_get_temp_dir() . '/calamar-cast-' . substr(hash('sha256', __DIR__), 0, 16);
    if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) {
        throw new RuntimeException('El hosting no permite crear la carpeta temporal de vídeo.');
    }
    return $root;
}

function castBinary(): ?string {
    foreach ([__DIR__ . '/calamar-cast-bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'] as $path) {
        if (is_file($path)) {
            if (!is_executable($path)) @chmod($path, 0700);
            if (is_executable($path)) return $path;
        }
    }
    return null;
}

function castCapabilities(): array {
    $binary = castBinary();
    $shell = function_exists('shell_exec') && function_exists('exec');
    $version = $shell && $binary ? @shell_exec(escapeshellarg($binary) . ' -version 2>/dev/null') : '';
    $flock = $shell ? trim((string)@shell_exec('command -v flock 2>/dev/null')) : '';
    return ['ready' => $shell && $binary && str_contains((string)$version, 'ffmpeg version') && $flock !== '',
        'ffmpeg' => str_contains((string)$version, 'ffmpeg version'), 'commands' => $shell,
        'worker_lock' => $flock !== '', 'binary' => $binary];
}

function castArguments(string $binary, string $source, string $folder): array {
    $args = [$binary, '-hide_banner', '-loglevel', 'quiet', '-nostdin', '-y',
        '-threads', '2', '-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1', '-reconnect_delay_max', '3', '-tls_verify', '1',
        '-verifyhost', 'calamarmenciano.com',
        '-headers', 'X-Calamar-Source: ' . base64_encode($source) . "\r\n",
        '-i', CAST_INPUT_URL, '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=25',
        '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-profile:v', 'main', '-level:v', '3.1', '-pix_fmt', 'yuv420p', '-b:v', '2200k',
        '-maxrate', '2600k', '-bufsize', '5200k', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
        '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_delete_threshold', '4',
        '-hls_start_number_source', 'epoch', '-hls_flags', 'delete_segments+independent_segments+temp_file+omit_endlist',
        '-hls_segment_filename', $folder . '/seg%d.ts', $folder . '/live.m3u8'];
    foreach (['/etc/pki/tls/cert.pem', '/etc/ssl/certs/ca-certificates.crt'] as $ca) {
        if (is_readable($ca)) {
            array_splice($args, array_search('-headers', $args, true), 0, ['-ca_file', $ca]);
            break;
        }
    }
    return $args;
}

function castWorker(string $command, string $folder): string {
    // The supervisor owns its child PID. No user-provided command/path is interpolated unquoted.
    $dir = escapeshellarg($folder);
    return "#!/bin/sh\ncd $dir || exit 1\nexec 9>worker.lock\nflock -n 9 || exit 0\n"
        . "cleanup() { kill \"\$child\" 2>/dev/null; wait \"\$child\" 2>/dev/null; rm -f worker.sh worker.alive live.m3u8 live.m3u8.tmp seg*.ts seg*.ts.tmp; }\n"
        . "trap cleanup EXIT\ntrap 'exit 0' INT TERM HUP\ntouch worker.alive\n"
        . "$command </dev/null >/dev/null 2>&1 &\nchild=\$!\n"
        . "while kill -0 \"\$child\" 2>/dev/null; do\n"
        . "  touch worker.alive\n  now=\$(date +%s)\n  last=\$(stat -c %Y heartbeat 2>/dev/null || echo 0)\n"
        . "  [ \$((now - last)) -gt 90 ] && break\n  sleep 5\ndone\n";
}

function castReply(array $data, int $code = 200): never {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit;
}

if (defined('CALAMAR_CAST_TEST_ONLY')) return;

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
// Cast receivers use their own origins; media URLs are unguessable bearer tokens.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: X-Calamar-Source, Range');
header('Access-Control-Expose-Headers: Content-Length');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { http_response_code(204); exit; }
if (!in_array($method, ['GET', 'HEAD'], true)) castReply(['error' => 'Método no permitido.'], 405);
$action = $_GET['action'] ?? 'status';

try {
    if ($action === 'status') {
        $cap = castCapabilities(); unset($cap['binary']);
        if (isset($_GET['json'])) castReply($cap);
        header('Content-Type: text/html; charset=utf-8');
        $result = $cap['ready'] ? 'Preparado para adaptar vídeo a Chromecast.'
            : 'Falta FFmpeg o el hosting bloquea la ejecución de procesos.';
        echo '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Calamar Chromecast</title><style>body{font:16px Arial,sans-serif;max-width:650px;margin:40px auto;padding:20px;background:#0b0d10;color:#f5f5f5}li{margin:14px 0}</style><h1>Calamar Chromecast</h1><p>' . $result . '</p><ul>';
        foreach (['ffmpeg' => 'FFmpeg ejecutable', 'commands' => 'Ejecución de comandos', 'worker_lock' => 'Bloqueo para compartir la conversión'] as $key => $name) {
            echo '<li>' . $name . ': ' . ($cap[$key] ? 'Disponible' : 'No disponible') . '</li>';
        }
        echo '</ul><p>Cuando esté preparado, abre el canal en Calamar TV y pulsa Chromecast. La conversión se detiene tras 90 segundos sin peticiones de la TV. No hay un cupo de espectadores configurado; la capacidad depende del hosting.</p></html>'; exit;
    }

    $root = castRoot();
    if ($action === 'media') {
        $token = $_GET['session'] ?? ''; $file = $_GET['file'] ?? '';
        if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)
            || !is_string($file) || !preg_match('/^(?:live[.]m3u8|seg[0-9]+[.]ts)$/D', $file)) {
            castReply(['error' => 'Vídeo no encontrado.'], 404);
        }
        $folder = $root . '/' . $token; $path = $folder . '/' . $file;
        if (!is_file($path) || is_link($path)) castReply(['error' => 'El vídeo ha terminado. Vuelve a enviarlo desde Calamar TV.'], 404);
        @touch($folder . '/heartbeat');
        if ($file === 'live.m3u8') {
            $playlist = (string)file_get_contents($path);
            // Absolute HTTPS URLs: the receiver never needs app-only headers or the original credentials.
            $playlist = preg_replace_callback('/^seg[0-9]+[.]ts$/m', function ($m) use ($token) {
                return CAST_PUBLIC_URL . '?action=media&session=' . $token . '&file=' . $m[0];
            }, $playlist);
            header('Content-Type: application/vnd.apple.mpegurl');
            if ($method !== 'HEAD') echo $playlist;
        } else {
            $handle = @fopen($path, 'rb');
            if (!$handle) castReply(['error' => 'Segmento caducado.'], 404);
            header('Content-Type: video/mp2t'); header('Content-Length: ' . fstat($handle)['size']);
            if ($method !== 'HEAD') fpassthru($handle); fclose($handle);
        }
        exit;
    }

    if ($action !== 'start' || $method !== 'GET') castReply(['error' => 'Acción no válida.'], 400);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && !in_array($origin, ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'], true)) {
        castReply(['error' => 'Origen no permitido.'], 403);
    }
    $source = base64_decode($_SERVER['HTTP_X_CALAMAR_SOURCE'] ?? '', true);
    if (!is_string($source) || !castSourceAllowed($source)) castReply(['error' => 'Fuente no admitida por este adaptador.'], 400);
    $cap = castCapabilities();
    if (!$cap['ready']) castReply(['error' => 'Instala el paquete Calamar Chromecast en el hosting y abre calamar-cast.php para comprobar FFmpeg.'], 503);

    $secretLock = fopen($root . '/secret.lock', 'c'); flock($secretLock, LOCK_EX);
    if (!is_file($root . '/secret')) file_put_contents($root . '/secret', random_bytes(32));
    $token = hash_hmac('sha256', $source, (string)file_get_contents($root . '/secret'));
    flock($secretLock, LOCK_UN); fclose($secretLock);
    $folder = $root . '/' . $token;
    if (!is_dir($folder)) @mkdir($folder, 0700);
    $lock = fopen($folder . '/start.lock', 'c'); flock($lock, LOCK_EX);
    @touch($folder . '/heartbeat');
    clearstatcache();
    $workerLock = fopen($folder . '/worker.lock', 'c');
    $alive = !flock($workerLock, LOCK_EX | LOCK_NB);
    $recent = is_file($folder . '/launched') && time() - filemtime($folder . '/launched') < 10;
    if (!$alive && !$recent) {
        foreach (glob($folder . '/seg*.ts*') ?: [] as $old) @unlink($old);
        @unlink($folder . '/live.m3u8');
        $command = implode(' ', array_map('escapeshellarg', castArguments($cap['binary'], $source, $folder)));
        $script = $folder . '/worker.sh'; file_put_contents($script, castWorker($command, $folder));
        @touch($folder . '/launched');
        // Discard every subprocess log: FFmpeg errors can otherwise reveal the source headers.
        // Release the probe lock before the supervisor acquires it; start.lock serializes launchers.
        flock($workerLock, LOCK_UN); fclose($workerLock); $workerLock = null;
        exec('nohup /bin/sh ' . escapeshellarg($script) . ' </dev/null >/dev/null 2>&1 &');
    }
    if (is_resource($workerLock)) { flock($workerLock, LOCK_UN); fclose($workerLock); }
    flock($lock, LOCK_UN); fclose($lock);
    $ready = is_file($folder . '/live.m3u8') && time() - filemtime($folder . '/live.m3u8') < 15
        && substr_count((string)file_get_contents($folder . '/live.m3u8'), '#EXTINF:') >= 3;
    castReply(['state' => $ready ? 'ready' : 'preparing',
        'url' => $ready ? CAST_PUBLIC_URL . '?action=media&session=' . $token . '&file=live.m3u8' : null], $ready ? 200 : 202);
} catch (Throwable $error) {
    castReply(['error' => 'El hosting no pudo iniciar la conversión. Comprueba FFmpeg, permisos y procesos permitidos.'], 503);
}
