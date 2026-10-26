<?php
// HTTPS transport for public HTTP IPTV streams, open while the viewer watches.
function failure($message, $code = 502) {
    http_response_code($code); header('Content-Type: text/plain; charset=utf-8'); echo $message; exit;
}
require_once __DIR__ . '/calamar-http-source.php';

// Raised with each change of the splicing, so the version running on the hosting can be checked.
const RELAY_VERSION = 3;

function relayMain() {
    ini_set('display_errors', '0');
    @set_time_limit(125);
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com');
    if ($origin !== '' && !in_array($origin, $allowed, true)) failure('Origen no permitido.', 403);
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: X-Calamar-Source, Range');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') failure('Método no permitido.', 405);
    header('X-Calamar-Relay: ' . RELAY_VERSION);
    if (isset($_GET['version'])) {
        header('Content-Type: application/json');
        echo json_encode(array('relay' => RELAY_VERSION, 'php' => PHP_VERSION)); exit;
    }
    if (!isset($_GET['stream'])) failure('Abre este puente desde Calamar TV.', 400);
    if (!function_exists('curl_init')) failure('cURL no disponible.');
    $source = base64_decode($_SERVER['HTTP_X_CALAMAR_SOURCE'] ?? '', true);
    if (!is_string($source) || strlen($source) > 2048) failure('Falta el enlace de la prueba.', 400);
    if (!httpTsSourceAllowed($source)) failure('Enlace IPTV HTTP no válido para el puente.', 400);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { if (!@ob_end_clean()) break; }
    // The connection lasts while the viewer stays on the channel. These IPTV servers close each
    // connection after a while (VLC and the app open the next one by themselves), and every new one
    // starts again with the last ~40 s they keep. The relay opens the next one too and passes on only
    // what comes after the last moment already sent (tsSplice), so the browser gets one continuous video.
    @set_time_limit(0);
    $headers = false; $lastHttp = 0; $splice = null;
    $lastVideo = microtime(true);
    while (!connection_aborted()) {
        $splice = tsSpliceNext($splice);
        $got = relayConnection($source, $headers, $lastHttp, $splice);
        if (!$headers) failure($got === null ? 'Redirección no pública o no compatible.' : 'No se recibió vídeo. HTTP del proveedor: ' . ($lastHttp ?: 'sin respuesta'));
        if ($got) $lastVideo = microtime(true);
        elseif (microtime(true) - $lastVideo > 30) break; // Nothing new for 30 s: the player reconnects.
        usleep($got ? 100000 : 1000000);
    }
    exit;
}

/** The PCR clock of an MPEG-TS packet in seconds, or null if the packet carries none. */
function tsPcr($packet) {
    if (!(ord($packet[3]) & 0x20) || ord($packet[4]) < 7 || !(ord($packet[5]) & 0x10)) return null;
    $b = array_map('ord', str_split(substr($packet, 6, 5)));
    return (($b[0] << 25) | ($b[1] << 17) | ($b[2] << 9) | ($b[3] << 1) | ($b[4] >> 7)) / 90000;
}

/** The packet's PID. */
function tsPid($packet) {
    return ((ord($packet[1]) & 0x1f) << 8) | ord($packet[2]);
}

/** Whether a packet starts a new PES or table (payload unit start). */
function tsStarts($packet) {
    return (bool)(ord($packet[1]) & 0x40);
}

/** Whether a packet starts a picture a decoder can begin with (random access indicator). */
function tsKeyframe($packet) {
    return (ord($packet[3]) & 0x20) && ord($packet[4]) > 0 && (ord($packet[5]) & 0x40);
}

/** A fresh state for tsSplice, or the one for the next connection of the same viewer. */
function tsSpliceNext($state = null) {
    $state = $state ?: array('pcr' => null, 'video' => null);
    // What was held after the last keyframe is dropped: the next connection resends that picture whole.
    return array('pcr' => $state['pcr'], 'video' => $state['video'], 'skip' => true, 'ahead' => $state['pcr'] === null,
        'carry' => '', 'hold' => '', 'seen' => $state['pcr'], 'wait' => array());
}

/**
 * The part of a chunk to pass on, cut only at keyframes of the video (the PID carrying the clock), so the
 * browser never gets half a picture: what came after the last keyframe is held until the next one, and
 * dropped if the connection ends first. A new connection repeats the last ~40 s: it resumes at the first
 * keyframe after the last clock sent ('pcr'), and every other stream at its next unit start. A clock far
 * away (the channel restarted) resumes at once.
 */
function tsSplice(&$state, $chunk) {
    $data = $state['carry'] . $chunk; $out = ''; $i = 0; $length = strlen($data);
    while ($i + 188 <= $length) {
        if ($data[$i] !== "\x47") { $i++; continue; }
        $packet = substr($data, $i, 188); $i += 188;
        $pid = tsPid($packet); $pcr = tsPcr($packet);
        if ($pcr !== null && $state['video'] === null) $state['video'] = $pid;
        $key = $pid === $state['video'] && tsKeyframe($packet) && tsStarts($packet);
        if ($state['skip']) {
            if ($pcr !== null && ($state['pcr'] === null || $pcr > $state['pcr'] || abs($pcr - $state['pcr']) > 120)) $state['ahead'] = true;
            if (!$state['ahead'] || !$key) { if ($pcr !== null && $state['ahead']) $state['seen'] = $pcr; continue; }
            $state['skip'] = false; $state['wait'] = array($pid => false);
        }
        if (!isset($state['wait'][$pid])) {
            if (!tsStarts($packet)) continue; // Another stream joins at its next unit, never halfway.
            $state['wait'][$pid] = false;
        }
        if ($key) {
            $out .= $state['hold']; $state['hold'] = ''; $state['pcr'] = $state['seen'];
        }
        if ($pcr !== null) $state['seen'] = $pcr;
        $state['hold'] .= $packet;
        // A video with no keyframes marked is passed on anyway, a few megabytes at a time.
        if (strlen($state['hold']) > 8 << 20) { $out .= $state['hold']; $state['hold'] = ''; $state['pcr'] = $state['seen']; }
    }
    $state['carry'] = substr($data, $i);
    return $out;
}

/** One connection to the provider, following its redirects: true if it sent new video, false if not, null if
 * a redirect left the public internet. The first video sends the answer's headers ($headers). */
function relayConnection($source, &$headers, &$lastHttp, &$splice) {
    $got = false;
    for ($hop = 0; $hop < 4; $hop++) {
        $target = publicTarget($source);
        if ($target === null) return $got ?: null;
        $location = ''; $status = 0;
        $ch = curl_init($source);
        curl_setopt_array($ch, array(
            // It also ends when the provider stops sending video for 20 s; the next connection follows.
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT_MS => 4000,
            CURLOPT_LOW_SPEED_LIMIT => 1, CURLOPT_LOW_SPEED_TIME => 20, CURLOPT_PROXY => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_RESOLVE => array($target['host'] . ':' . $target['port'] . ':' . $target['ip']),
            // Many IPTV servers only answer known players; VLC's name is the one they accept.
            CURLOPT_USERAGENT => 'VLC/3.0.20 LibVLC/3.0.20',
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$location, &$status) {
                if (preg_match('~^HTTP/[^ ]+ ([0-9]{3})~', $line, $m)) $status = (int)$m[1];
                if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$status, &$headers, &$got, &$splice) {
                if (connection_aborted()) return 0;
                // Error pages and redirects are read but not passed on (at most 64 KiB).
                if (!in_array($status, array(200, 206), true)) return curl_getinfo($ch, CURLINFO_SIZE_DOWNLOAD) > 65536 ? 0 : strlen($chunk);
                $piece = tsSplice($splice, $chunk);
                if ($piece === '') return strlen($chunk);
                if (!$headers) {
                    header('Content-Type: video/mp2t'); header('X-Accel-Buffering: no');
                    header('X-Content-Type-Options: nosniff'); $headers = true;
                }
                $got = true;
                echo $piece; flush();
                return strlen($chunk);
            },
        ));
        curl_exec($ch); $lastHttp = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($got || $status === 200 || $status === 206) return $got;
        if (!in_array($lastHttp, array(301, 302, 303, 307, 308), true) || !$location) return false;
        $next = redirectTarget($source, $location); if ($next === null) return null; $source = $next;
    }
    return $got;
}

if (!defined('CALAMAR_RELAY_TEST_ONLY')) relayMain();
