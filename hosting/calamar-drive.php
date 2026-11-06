<?php
// Drive folders and videos in Calamar's own player. Google keys stay encrypted in video links.
require_once __DIR__ . '/calamar-http-source.php';

function driveAnswer($data, $status = 200) {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES); exit;
}
function driveId($id) { return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,200}$/D', $id); }
function driveOnVps() { return getenv('CALAMAR_DRIVE_VPS') === '1'; }
function driveStateDir() { return driveOnVps() ? '/var/lib/calamar-drive' : dirname(__DIR__); }

function driveSecret() {
    $configured = getenv('CALAMAR_DRIVE_SECRET');
    if (is_string($configured) && preg_match('/^[a-f0-9]{64}$/D', $configured)) return hex2bin($configured);
    $path = driveStateDir() . '/calamar-drive-secret.php';
    $lock = @fopen($path . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('No se pudo guardar la clave privada de Drive.');
    @chmod($path . '.lock', 0600);
    try {
        clearstatcache(true, $path); $saved = is_file($path) ? @include $path : null;
        if (is_string($saved) && preg_match('/^[a-f0-9]{64}$/D', $saved)) return hex2bin($saved);
        if (driveOnVps() || is_file($path))
            throw new RuntimeException('Falta la clave privada original de Drive o no es válida.');
        $secret = bin2hex(random_bytes(32));
        $file = @fopen($path, 'x');
        if (!$file) throw new RuntimeException('No se pudo guardar la clave privada de los vídeos de Drive.');
        @chmod($path, 0600); $written = fwrite($file, '<?php return ' . var_export($secret, true) . ";\n"); fclose($file);
        if ($written === false) throw new RuntimeException('No se pudo guardar la clave privada de Drive.');
        return hex2bin($secret);
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
function driveToken($file, $key, $secret) {
    $nonce = random_bytes(12); $tag = '';
    $data = json_encode(array('id' => $file['id'], 'key' => $key, 'resourceKey' => $file['resourceKey'] ?? '', 'mime' => $file['mimeType']));
    $cipher = openssl_encrypt($data, 'aes-256-gcm', $secret, OPENSSL_RAW_DATA, $nonce, $tag, 'calamar-drive-v1');
    if ($cipher === false) throw new RuntimeException('No se pudo preparar el vídeo.');
    return rtrim(strtr(base64_encode($nonce . $tag . $cipher), '+/', '-_'), '=');
}
function driveOpen($token, $secret) {
    if (!is_string($token) || strlen($token) > 2048 || !preg_match('/^[A-Za-z0-9_-]+$/D', $token)) return null;
    $bytes = base64_decode(strtr($token, '-_', '+/'), true);
    if ($bytes === false || strlen($bytes) < 30) return null;
    $plain = openssl_decrypt(substr($bytes, 28), 'aes-256-gcm', $secret, OPENSSL_RAW_DATA, substr($bytes, 0, 12), substr($bytes, 12, 16), 'calamar-drive-v1');
    $data = $plain === false ? null : json_decode($plain, true);
    return is_array($data) && driveId($data['id'] ?? null) && is_string($data['key'] ?? null)
        && strpos($data['mime'] ?? '', 'video/') === 0 ? $data : null;
}
function driveAllowedUrl($url) {
    $u = parse_url($url); $host = strtolower($u['host'] ?? '');
    return ($u['scheme'] ?? '') === 'https' && !isset($u['user']) && !isset($u['pass']) && !isset($u['port'])
        && ($host === 'www.googleapis.com' || $host === 'content.googleapis.com' || $host === 'drive.usercontent.google.com'
            || substr($host, -strlen('.googleusercontent.com')) === '.googleusercontent.com');
}
function driveCurl($url, $key, $id, $resourceKey, $range = '', $bearer = '') {
    if (!driveAllowedUrl($url) || !($target = publicTarget($url))) return null;
    $headers = array('Accept: */*');
    if (parse_url($url, PHP_URL_HOST) === 'www.googleapis.com') {
        if ($bearer !== '') $headers[] = 'Authorization: Bearer ' . $bearer;
        elseif ($key !== '') $headers[] = 'X-Goog-Api-Key: ' . $key;
        if ($resourceKey !== '') $headers[] = 'X-Goog-Drive-Resource-Keys: ' . $id . '/' . $resourceKey;
    }
    if ($range !== '') $headers[] = 'Range: ' . $range;
    $ch = curl_init($url);
    curl_setopt_array($ch, array(CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 40, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RESOLVE => array($target['host'] . ':' . $target['port'] . ':' . $target['ip'])));
    return $ch;
}
function driveJson($path, $params, $key, $id, $resourceKey, $bearer = '') {
    $ch = driveCurl('https://www.googleapis.com/drive/v3/' . $path . '?' . http_build_query($params), $key, $id, $resourceKey, '', $bearer);
    if (!$ch) throw new RuntimeException('No se pudo conectar con Google Drive.');
    $body = ''; curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) use (&$body) {
        if (strlen($body) + strlen($data) > 4194304) return 0;
        $body .= $data; return strlen($data);
    });
    $ok = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($ok === false || $status !== 200) throw new RuntimeException('Drive no permite leer esta carpeta. Comprueba el enlace compartido y una clave con Google Drive API habilitada (HTTP ' . $status . ').');
    $result = json_decode($body, true);
    if (!is_array($result)) throw new RuntimeException('Drive no devolvió una lista válida.');
    return $result;
}
function driveMenu($data, $name, $key, $secret) {
    $folders = array(); $files = array();
    foreach (($data['files'] ?? array()) as $f) {
        if (!driveId($f['id'] ?? null)) continue;
        if (($f['mimeType'] ?? '') === 'application/vnd.google-apps.folder') {
            $folders[] = array('id' => $f['id'], 'name' => (string)($f['name'] ?? ''), 'resourceKey' => $f['resourceKey'] ?? '');
        } elseif (strpos($f['mimeType'] ?? '', 'video/') === 0 && !empty($f['capabilities']['canDownload'])) {
            $files[] = array('title' => (string)($f['name'] ?? ''), 'uploaded' => substr($f['createdTime'] ?? '', 0, 10),
                'link' => 'https://calamarmenciano.com/calamar-drive.php?id=' . $f['id'] . '&v=' . driveToken($f, $key, $secret));
        }
    }
    return array('name' => $name, 'folders' => $folders, 'files' => $files, 'nextPageToken' => $data['nextPageToken'] ?? '');
}
function driveRange($range) { return $range === '' || (is_string($range) && preg_match('/^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$/D', $range)); }

function drivePublicDownload($file) {
    $params = array('id' => $file['id'], 'export' => 'download', 'confirm' => 't');
    if (($file['resourceKey'] ?? '') !== '') $params['resourcekey'] = $file['resourceKey'];
    return 'https://drive.usercontent.google.com/download?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

/** Sends the media and exits, or returns the last HTTP status before any bytes were sent. */
function driveTransfer($file, $url, $head, $range, $bearer = '') {
    for ($redirect = 0; $redirect < 5; $redirect++) {
        $ch = driveCurl($url, $file['key'], $file['id'], $file['resourceKey'], $range, $bearer);
        if (!$ch) break;
        $status = 0; $headers = array(); $sent = false; $failure = '';
        curl_setopt_array($ch, array(CURLOPT_TIMEOUT => 0, CURLOPT_LOW_SPEED_LIMIT => 1, CURLOPT_LOW_SPEED_TIME => 45, CURLOPT_NOBODY => $head));
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($ch, $line) use (&$status, &$headers) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) { $status = (int)$m[1]; $headers = array(); }
            elseif (preg_match('/^(location|content-type|content-length|content-range|accept-ranges|etag):\s*(.+?)\s*$/i', $line, $m)) $headers[strtolower($m[1])] = $m[2];
            return strlen($line);
        });
        $send = function() use (&$sent, &$status, &$headers, $file) {
            if (!in_array($status, array(200, 206), true)) return false;
            if (isset($headers['content-type']) && !preg_match('#^(?:video/|application/octet-stream)#i', $headers['content-type'])) return false;
            if (!$sent) {
                $sent = true; http_response_code($status); header('Content-Type: ' . $file['mime']);
                header('Accept-Ranges: bytes'); header('Cache-Control: private, no-store');
                foreach (array('content-length', 'content-range', 'etag') as $name) if (isset($headers[$name])) header($name . ': ' . $headers[$name]);
            }
            return true;
        };
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) use (&$status, &$failure, $send) {
            if ($status >= 300 && $status < 400) return strlen($data);
            if (!$send()) {
                $failure .= substr($data, 0, 16384 - strlen($failure));
                return strlen($failure) < 16384 ? strlen($data) : 0;
            }
            echo $data; flush(); return connection_aborted() ? 0 : strlen($data);
        });
        curl_exec($ch); curl_close($ch);
        if ($head && $send()) exit;
        if ($sent) exit;
        if ($status === 429 || preg_match('/Google Drive.{0,20}Quota exceeded|downloadQuotaExceeded/i', $failure)) return 429;
        if ($status >= 300 && $status < 400 && isset($headers['location']) && driveAllowedUrl($headers['location'])) { $url = $headers['location']; continue; }
        return $status;
    }
    return 0;
}

const DRIVE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function driveServiceConfig() {
    $path = driveStateDir() . '/calamar-drive-service.json';
    if (!is_file($path) || (fileperms($path) & 0077) !== 0) return null;
    $config = json_decode((string)@file_get_contents($path, false, null, 0, 16384), true);
    if (!is_array($config) || ($config['type'] ?? '') !== 'service_account'
        || !is_string($config['client_email'] ?? null)
        || !preg_match('/^[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/D', $config['client_email'])
        || !is_string($config['private_key'] ?? null)) return null;
    $files = $config['calamar_files'] ?? array();
    $folders = $config['calamar_folders'] ?? array();
    if (!is_array($files) || !is_array($folders) || (!$files && !$folders)
        || array_filter($files, 'driveId') !== $files || array_filter($folders, 'driveId') !== $folders) return null;
    return $config;
}

function driveServiceJwt($config, $now) {
    $encode = static function($value) { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); };
    $message = $encode('{"alg":"RS256","typ":"JWT"}') . '.' . $encode(json_encode(array(
        'iss' => $config['client_email'], 'scope' => DRIVE_OAUTH_SCOPE, 'aud' => DRIVE_OAUTH_TOKEN_URL,
        'iat' => $now - 30, 'exp' => $now + 3300), JSON_UNESCAPED_SLASHES));
    if (!@openssl_sign($message, $signature, $config['private_key'], OPENSSL_ALGO_SHA256))
        throw new RuntimeException('La clave de la cuenta de servicio de Drive no es válida.');
    return $message . '.' . $encode($signature);
}

function driveServiceAccessToken($config) {
    $dir = driveStateDir() . '/calamar-drive-auth-cache';
    if (!is_dir($dir)) @mkdir($dir, 0700);
    if (!is_dir($dir) || (fileperms($dir) & 0077) !== 0) return '';
    $cache = @fopen($dir . '/token.json', 'c+');
    if (!$cache) return '';
    try {
        if (!flock($cache, LOCK_EX)) return '';
        $now = time();
        $identity = hash('sha256', $config['client_email'] . "\n" . $config['private_key']);
        $stored = json_decode(stream_get_contents($cache, 16384), true);
        if (($stored['identity'] ?? '') === $identity && ($stored['expires'] ?? 0) > $now + 60
            && driveServiceTokenValid($stored['token'] ?? null)) return $stored['token'];

        $ch = curl_init(DRIVE_OAUTH_TOKEN_URL);
        $response = '';
        curl_setopt_array($ch, array(CURLOPT_POST => true, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_POSTFIELDS => http_build_query(array(
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => driveServiceJwt($config, $now))),
            CURLOPT_WRITEFUNCTION => static function($ch, $bytes) use (&$response) {
                if (strlen($response) + strlen($bytes) > 16384) return 0;
                $response .= $bytes;
                return strlen($bytes);
            }));
        $received = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        $data = json_decode($response, true);
        $token = $data['access_token'] ?? null;
        $lifetime = (int)($data['expires_in'] ?? 0);
        if (!$received || $status !== 200 || !driveServiceTokenValid($token) || $lifetime < 60) return '';
        rewind($cache);
        if (ftruncate($cache, 0)) fwrite($cache, json_encode(array(
            'identity' => $identity, 'token' => $token, 'expires' => $now + min($lifetime, 3600))));
        return $token;
    } finally { fclose($cache); }
}

function driveServiceTokenValid($value) {
    return is_string($value) && preg_match('#^[A-Za-z0-9._~+/-]{1,4096}={0,2}$#D', $value);
}

/** Drive files have at most one parent. Follow it only up to the administrator's permitted roots. */
function driveServiceAllows($id, $config, $metadata) {
    if (in_array($id, $config['calamar_files'] ?? array(), true)) return true;
    $roots = $config['calamar_folders'] ?? array();
    if (!$roots) return false;
    $seen = array($id => true);
    for ($depth = 0; $depth < 10; $depth++) {
        $entry = $metadata($id);
        if (!is_array($entry) || !empty($entry['trashed'])) return false;
        $parent = $entry['parents'][0] ?? null;
        if (!driveId($parent) || isset($seen[$parent])) return false;
        if (in_array($parent, $roots, true)) return true;
        $seen[$parent] = true;
        $id = $parent;
    }
    return false;
}

function driveServiceMedia($file, $url, $head, $range) {
    $config = driveServiceConfig();
    if (!$config) return null;
    if (empty($config['calamar_folders']) && !in_array($file['id'], $config['calamar_files'] ?? array(), true)) return null;
    try {
        $token = driveServiceAccessToken($config);
        if ($token === '') return null;
        $allowed = driveServiceAllows($file['id'], $config, static function($id) use ($file, $token) {
            $key = $id === $file['id'] ? $file['resourceKey'] : '';
            return driveJson('files/' . $id, array('fields' => 'parents,trashed', 'supportsAllDrives' => 'true'),
                '', $id, $key, $token);
        });
        if ($allowed) return driveTransfer($file, $url, $head, $range, $token);
    } catch (RuntimeException $e) {
        // Keep public playback available when credentials expire or a file is no longer shared.
    }
    return null;
}

function driveStream($file, $head = false) {
    $range = $_SERVER['HTTP_RANGE'] ?? '';
    if (!driveRange($range)) driveAnswer(array('error' => 'Rango de vídeo no válido.'), 416);
    @set_time_limit(0); @ini_set('zlib.output_compression', '0');
    while (ob_get_level()) { if (!@ob_end_clean()) break; }
    $api = 'https://www.googleapis.com/drive/v3/files/' . $file['id'] . '?alt=media&supportsAllDrives=true';
    $authorizedStatus = driveServiceMedia($file, $api, $head, $range);
    $status = $authorizedStatus === 416 ? 416 : driveTransfer($file, $api, $head, $range);
    // Google can allow an anonymous shared download even when its API cannot deliver that file.
    if ($status !== 416) {
        $publicStatus = driveTransfer($file, drivePublicDownload($file), $head, $range);
        $status = $status === 429 ? 429 : $publicStatus;
    }
    if ($status === 429 || $authorizedStatus === 429) driveAnswer(array('error' => 'Google Drive ha alcanzado la cuota de descarga de este vídeo.'), 429);
    driveAnswer(array('error' => 'Google Drive no ha entregado el vídeo. Comprueba que siga compartido y tenga cuota disponible.',
        'upstream_http' => $status), $status === 416 ? 416 : 502);
}
const DRIVE_SEGMENT_SECONDS = 8;
const DRIVE_COMPAT_ORIGIN = 'https://calamarmenciano.com/calamar-drive.php';
const DRIVE_VPS_ORIGIN = 'https://video.calamarmenciano.com/calamar-drive.php';
const DRIVE_VPS_INPUT = 'http://127.0.0.1:8091/calamar-drive.php';

function driveCompatBinary() {
    $bundled = __DIR__ . '/calamar-cast-bin/ffmpeg';
    return is_executable($bundled) ? $bundled : (is_executable('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : '');
}

function driveCompatReady() {
    return function_exists('exec') && is_executable('/usr/bin/timeout') && driveCompatBinary() !== '';
}

function driveCompatBusy() {
    header('Retry-After: 2');
    driveAnswer(array('error' => 'El hosting está adaptando otros vídeos. Vuelve a intentarlo en un momento.'), 503);
}

function driveCompatCache() {
    $dir = driveStateDir() . '/calamar-drive-hls';
    if (!is_dir($dir)) @mkdir($dir, 0700);
    if (!is_dir($dir) || !is_writable($dir)) throw new RuntimeException('El hosting no puede guardar los segmentos de vídeo.');
    return $dir;
}

function driveCompatWorker($dir) {
    for ($i = 0; $i < 2; $i++) {
        $lock = @fopen($dir . '/worker-' . $i, 'c');
        if (!$lock) continue;
        if (flock($lock, LOCK_EX | LOCK_NB)) return $lock;
        fclose($lock);
    }
    driveCompatBusy();
}

function driveCompatInput($url) {
    $local = driveOnVps();
    $args = array('-protocol_whitelist', $local ? 'http,tcp' : 'https,tls,tcp', '-format_whitelist',
        'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,flv,ogg,asf,rm,wtv,mxf,dv,nut,ivf,yuv4mpegpipe',
        '-rw_timeout', '16000000', '-seekable', '1', '-threads', '2');
    if (!$local) {
        array_push($args, '-tls_verify', '1', '-verifyhost', 'calamarmenciano.com');
        foreach (array('/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/certs/ca-certificates.crt') as $ca) {
            if (is_readable($ca)) { array_push($args, '-ca_file', $ca); break; }
        }
    }
    return array_merge($args, array('-i', $url));
}

function driveCompatExec($args, &$output) {
    $command = array_merge(array('/usr/bin/timeout', '-k', '2s', '22s', driveCompatBinary(),
        '-nostdin', '-hide_banner', '-max_alloc', '134217728', '-filter_threads', '1'), $args);
    exec(implode(' ', array_map('escapeshellarg', $command)) . ' 2>&1', $output, $code);
    return $code === 0;
}

function driveCompatInspect($url) {
    $output = array();
    // Listing streams alone avoids decoding or downloading the whole file.
    driveCompatExec(driveCompatInput($url), $output);
    $description = implode("\n", $output);
    try {
        return driveCompatMetadata($description);
    } catch (RuntimeException $error) {
        $reason = 'formato';
        if (preg_match('/(?:HTTP error|Server returned) 429/i', $description))
            throw new RuntimeException('Google Drive ha alcanzado la cuota de descarga de este vídeo.', 429);
        if (preg_match('/(?:timed out|timeout|Operation canceled)/i', $description)) $reason = 'tiempo de espera';
        elseif (preg_match('/(?:certificate|verifyhost|TLS)/i', $description)) $reason = 'conexión TLS';
        elseif (preg_match('/(?:HTTP error|Server returned) (\d{3})/i', $description, $match)) $reason = 'HTTP ' . $match[1];
        elseif (preg_match('/(?:failed to resolve|connection refused|network is unreachable)/i', $description)) $reason = 'conexión';
        elseif (preg_match('/(?:Option not found|Unrecognized option|not on whitelist)/i', $description)) $reason = 'configuración del conversor';
        throw new RuntimeException($error->getMessage() . ' Motivo: ' . $reason . '.');
    }
}

function driveCompatMetadata($description) {
    if (!preg_match('/^\s+Duration: (\d+):(\d{2}):(\d{2}\.\d+)/m', $description, $time)
        || !preg_match('/Stream #0:\d+.*: Video: (?!.*\(attached pic\))/i', $description))
        throw new RuntimeException('El hosting no ha podido leer un vídeo con duración válida en este archivo de Drive.');
    $duration = (int)$time[1] * 3600 + (int)$time[2] * 60 + (float)$time[3];
    if ($duration <= 0 || $duration > 43200) throw new RuntimeException('La duración del vídeo no es válida para el modo compatible.');
    $audio = preg_match('/Stream #0:(\d+)(?:\[[^\]]+\])?\((?:spa|es|esp)\): Audio:/i', $description, $track) ? '0:' . $track[1] : '0:a:0?';
    return array('duration' => $duration, 'audio' => $audio);
}

// At most one file per bucket. A reader opens the file while holding the same lock as writers.
function driveCompatCacheFile($dir, $key, $suffix, $generate) {
    $bucket = $dir . '/' . $suffix . '-' . (hexdec(substr($key, 0, 4)) % 64);
    $lock = @fopen($bucket . '.lock', 'c');
    if (!$lock) throw new RuntimeException('No se pudo abrir la caché de vídeo.');
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) driveCompatBusy();
        $path = $bucket . '-' . $key;
        if (is_file($path) && time() - filemtime($path) < 900 && ($stream = fopen($path, 'rb'))) return $stream;
        $worker = driveCompatWorker($dir);
        $tmp = $bucket . '.tmp';
        try {
            $generate($tmp);
            if (!rename($tmp, $path)) throw new RuntimeException('No se pudo guardar el vídeo adaptado.');
            foreach (glob($bucket . '-*') ?: array() as $old) if ($old !== $path) @unlink($old);
            $stream = fopen($path, 'rb');
            if (!$stream) throw new RuntimeException('No se pudo leer el vídeo adaptado.');
            return $stream;
        } finally {
            if (is_file($tmp)) @unlink($tmp);
            fclose($worker);
        }
    } finally { fclose($lock); }
}

function driveCompatSegmentArguments($input, $start, $length, $audio, $tmp) {
    return array_merge(array('-loglevel', 'error', '-y', '-ss', (string)$start), $input, array(
        '-t', sprintf('%.3F', $length), '-map', '0:V:0', '-map', $audio,
        '-vf', "yadif=deint=interlaced,scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60',
        '-crf', '23', '-maxrate', '2500k', '-bufsize', '2500k', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '128k',
        '-f', 'mpegts', $tmp));
}

function driveCompat($file, $token, $head) {
    if (!driveCompatReady()) driveAnswer(array('error' => 'El hosting no tiene disponible el conversor de vídeo.'), 503);
    $dir = driveCompatCache();
    $query = '?' . http_build_query(array('id' => $file['id'], 'v' => $token));
    $url = (driveOnVps() ? DRIVE_VPS_ORIGIN : DRIVE_COMPAT_ORIGIN) . $query;
    $inputUrl = driveOnVps() ? DRIVE_VPS_INPUT . $query : $url;
    $key = hash('sha256', 'drive-hls-v1:' . $token);
    $meta = driveCompatCacheFile($dir, $key, 'info', function($tmp) use ($inputUrl) {
        if (file_put_contents($tmp, json_encode(driveCompatInspect($inputUrl))) === false)
            throw new RuntimeException('No se pudo guardar la información del vídeo.');
    });
    $info = json_decode(stream_get_contents($meta), true);
    fclose($meta);
    $count = (int)ceil($info['duration'] / DRIVE_SEGMENT_SECONDS);
    $part = $_GET['seg'] ?? null;
    if ($part === null) {
        $lines = array('#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-TARGETDURATION:' . DRIVE_SEGMENT_SECONDS, '#EXT-X-MEDIA-SEQUENCE:0',
            '#EXT-X-INDEPENDENT-SEGMENTS');
        for ($i = 0; $i < $count; $i++) {
            $length = min(DRIVE_SEGMENT_SECONDS, $info['duration'] - $i * DRIVE_SEGMENT_SECONDS);
            if ($i > 0) $lines[] = '#EXT-X-DISCONTINUITY';
            $lines[] = sprintf('#EXTINF:%.3F,', $length);
            $lines[] = $url . '&hls=1&seg=' . $i;
        }
        $lines[] = '#EXT-X-ENDLIST';
        header('Content-Type: application/vnd.apple.mpegurl');
        if (!$head) echo implode("\n", $lines) . "\n";
        exit;
    }
    if (!is_string($part) || !preg_match('/^(?:0|[1-9]\d{0,4})$/D', $part) || (int)$part >= $count)
        driveAnswer(array('error' => 'Segmento fuera de rango.'), 404);
    $start = (int)$part * DRIVE_SEGMENT_SECONDS;
    $length = min(DRIVE_SEGMENT_SECONDS, $info['duration'] - $start);
    $segment = driveCompatCacheFile($dir, hash('sha256', $key . ':' . $part), 'segment', function($tmp) use ($inputUrl, $start, $length, $info) {
        $args = driveCompatSegmentArguments(driveCompatInput($inputUrl), $start, $length, $info['audio'], $tmp);
        $output = array();
        if (!driveCompatExec($args, $output) || !is_file($tmp) || filesize($tmp) < 188)
            throw new RuntimeException('El hosting no ha podido convertir este tramo del vídeo.');
    });
    header('Content-Type: video/mp2t');
    header('Content-Length: ' . fstat($segment)['size']);
    if (!$head) fpassthru($segment);
    fclose($segment);
    exit;
}

function driveMain() {
    ini_set('display_errors', '0'); header('Cache-Control: no-store'); header('X-Robots-Tag: noindex, nofollow'); header('Referrer-Policy: no-referrer');
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    $video = in_array($method, array('GET', 'HEAD'), true) || ($method === 'OPTIONS' && isset($_GET['v']));
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (!$video && $origin !== '' && !in_array($origin, array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'), true)) driveAnswer(array('error' => 'Origen no permitido.'), 403);
    header('Access-Control-Allow-Origin: ' . ($video ? '*' : ($origin ?: 'https://djyuanyo.github.io')));
    header('Vary: Origin'); header('Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS'); header('Access-Control-Allow-Headers: Range, Content-Type');
    header('Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges');
    if ($method === 'OPTIONS') { http_response_code(204); exit; }
    if ($method === 'GET' && ($_GET['status'] ?? '') === '1')
        driveAnswer(array('bridge' => 'drive-hls-v1', 'ready' => driveCompatReady(), 'drive_authorized' => driveServiceConfig() !== null));
    if (!function_exists('curl_init') || !function_exists('openssl_encrypt')) driveAnswer(array('error' => 'Falta cURL u OpenSSL en el hosting.'), 503);
    try {
        $secret = driveSecret();
        if ($video) {
            $file = driveOpen($_GET['v'] ?? '', $secret);
            if (!$file || $file['id'] !== ($_GET['id'] ?? '')) driveAnswer(array('error' => 'Enlace de vídeo no válido.'), 403);
            if (!driveOnVps() && is_file(driveStateDir() . '/calamar-drive-use-vps')) {
                $query = array_intersect_key($_GET, array_flip(array('id', 'v', 'hls', 'seg')));
                header('Location: ' . DRIVE_VPS_ORIGIN . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986), true, 307);
                exit;
            }
            if (($_GET['hls'] ?? '') === '1') driveCompat($file, $_GET['v'], $method === 'HEAD');
            driveStream($file, $method === 'HEAD');
        }
        if ($method !== 'POST') driveAnswer(array('error' => 'Método no permitido.'), 405);
        $id = $_POST['id'] ?? ''; $key = $_POST['key'] ?? ''; $resourceKey = $_POST['resourceKey'] ?? ''; $pageToken = $_POST['pageToken'] ?? '';
        if (!driveId($id) || !is_string($key) || !preg_match('/^AIza[A-Za-z0-9_-]{35}$/D', $key)
            || ($resourceKey !== '' && !driveId($resourceKey)) || !is_string($pageToken) || strlen($pageToken) > 2048) driveAnswer(array('error' => 'Revisa el enlace de carpeta y la clave de Google Drive.'), 400);
        $folder = driveJson('files/' . $id, array('fields' => 'name,mimeType', 'supportsAllDrives' => 'true'), $key, $id, $resourceKey);
        if (($folder['mimeType'] ?? '') !== 'application/vnd.google-apps.folder') driveAnswer(array('error' => 'Ese enlace no corresponde a una carpeta.'), 400);
        $data = driveJson('files', array('q' => "'" . $id . "' in parents and trashed = false", 'pageSize' => 1000,
            'fields' => 'nextPageToken,incompleteSearch,files(id,name,mimeType,createdTime,resourceKey,capabilities(canDownload))',
            'supportsAllDrives' => 'true', 'includeItemsFromAllDrives' => 'true', 'pageToken' => $pageToken), $key, $id, $resourceKey);
        if (!empty($data['incompleteSearch'])) throw new RuntimeException('Drive ha devuelto una búsqueda incompleta. Vuelve a intentarlo.');
        driveAnswer(driveMenu($data, $folder['name'], $key, $secret));
    } catch (Exception $e) { driveAnswer(array('error' => $e->getMessage()), $e->getCode() === 429 ? 429 : 502); }
}
if (PHP_SAPI !== 'cli') driveMain();
