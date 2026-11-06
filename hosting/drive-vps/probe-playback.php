<?php
if (PHP_SAPI !== 'cli') exit(1);
putenv('CALAMAR_DRIVE_VPS=1');
require '/opt/calamar-drive/calamar-drive.php';

function probe($url, $range = '') {
    $body = '';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 2,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 70,
        CURLOPT_HTTPHEADER => $range === '' ? [] : ['Range: ' . $range],
        CURLOPT_WRITEFUNCTION => static function ($ch, $part) use (&$body) {
            if (strlen($body) + strlen($part) > 4194304) return 0;
            $body .= $part;
            return strlen($part);
        },
    ]);
    curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $effective = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    curl_close($ch);
    return [$status, $body, parse_url($effective, PHP_URL_HOST)];
}

$cfg = driveServiceConfig();
if (!$cfg || empty($cfg['calamar_files'])) {
    fwrite(STDERR, "No se encontró un archivo autorizado para la prueba.\n");
    exit(1);
}
$mode = $argv[1] ?? 'private';
$base = ['private' => 'http://127.0.0.1:8092/calamar-drive.php', 'public' => DRIVE_VPS_ORIGIN,
    'legacy' => DRIVE_COMPAT_ORIGIN][$mode] ?? '';
if ($base === '') exit(1);
for ($i = 0; $i < min(4, count($cfg['calamar_files'])); $i++) {
    $file = ['id' => $cfg['calamar_files'][$i], 'mimeType' => 'video/mp4'];
    $query = '?' . http_build_query(['id' => $file['id'], 'v' => driveToken($file, '', driveSecret())]);
    [$status, $body, $host] = probe($base . $query, 'bytes=1048576-1052671');
    printf("Archivo %d, rango HTTP %d, bytes %d, host %s\n", $i + 1, $status, strlen($body), $host);
    if ($status !== 206 || strlen($body) !== 4096
        || ($mode === 'legacy' && $host !== 'video.calamarmenciano.com')) continue;
    [$status, $body] = probe($base . $query . '&hls=1');
    printf("Lista HLS HTTP %d\n", $status);
    if ($status !== 200 || strpos($body, '#EXTM3U') !== 0
        || strpos($body, DRIVE_VPS_ORIGIN . '?') === false) continue;
    preg_match_all('~^https://video\.calamarmenciano\.com/calamar-drive\.php\?[^\r\n]+~m', $body, $segments);
    if (!$segments[0]) continue;
    $part = $segments[0][min(2, count($segments[0]) - 1)];
    if ($mode === 'private') $part = str_replace(DRIVE_VPS_ORIGIN, $base, $part);
    [$status, $body] = probe($part);
    printf("Fragmento HLS HTTP %d, bytes %d\n", $status, strlen($body));
    if ($status === 200 && strlen($body) > 188 && ord($body[0]) === 0x47) {
        echo "DRIVE_PLAYBACK_OK\n";
        exit(0);
    }
}
exit(1);
