<?php
// HTTPS transport for public HTTP IPTV streams, with one connection to the provider per channel.
// IPTV accounts allow very few connections at once: when every web viewer opened their own, the
// provider kept closing the oldest and everybody saw a few seconds at a time. Now the first viewer of a
// channel opens the only connection and writes the video into pieces in the hosting's temporary folder;
// every viewer (the first one too) reads those pieces. The connection closes 15 s after the last viewer
// leaves, and whoever is still watching takes it over if the process holding it ends.
function failure($message, $code = 502) {
    http_response_code($code); header('Content-Type: text/plain; charset=utf-8'); echo $message; exit;
}
require_once __DIR__ . '/calamar-http-source.php';

// Raised with each change, so the version running on the hosting can be checked (?version=1).
const RELAY_VERSION = 4;
const RELAY_PIECE = 1048576;     // A new piece every ~1 MiB, always starting at a keyframe.
const RELAY_PIECES = 24;         // Pieces kept per channel (~24 MiB).
const RELAY_IDLE = 15;           // Seconds without viewers before the provider connection closes.

function relayMain() {
    ini_set('display_errors', '0');
    @set_time_limit(125);
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    header('X-Calamar-Relay: ' . RELAY_VERSION);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array('https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com');
    if ($origin !== '' && !in_array($origin, $allowed, true)) failure('Origen no permitido.', 403);
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: X-Calamar-Source, Range');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') failure('Método no permitido.', 405);
    if (isset($_GET['version'])) {
        header('Content-Type: application/json');
        echo json_encode(array('relay' => RELAY_VERSION, 'php' => PHP_VERSION)); exit;
    }
    if (!isset($_GET['stream'])) failure('Abre este puente desde Calamar TV.', 400);
    if (!function_exists('curl_multi_init')) failure('cURL no disponible.');
    $source = base64_decode($_SERVER['HTTP_X_CALAMAR_SOURCE'] ?? '', true);
    if (!is_string($source) || strlen($source) > 2048) failure('Falta el enlace de la prueba.', 400);
    if (!httpTsSourceAllowed($source) && !relayTestUpstream()) failure('Enlace IPTV HTTP no válido para el puente.', 400);
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) { if (!@ob_end_clean()) break; }
    relayServe($source);
}

/** Only PHP's own test server may read a local test stream (tools/test_tv_relay.py), never the hosting. */
function relayTestUpstream() {
    return PHP_SAPI === 'cli-server' && getenv('CALAMAR_RELAY_TEST_LOCAL') === '1';
}

/** The channel's folder: its pieces, state.json, writer.lock and one file per viewer. */
function relayDir($source) {
    $dir = sys_get_temp_dir() . '/calamar-relay-' . substr(hash('sha256', __DIR__), 0, 12) . '/' . substr(hash('sha256', $source), 0, 24);
    if (!is_dir($dir . '/viewers')) @mkdir($dir . '/viewers', 0700, true);
    return $dir;
}

function relayState($dir) {
    $state = @json_decode((string)@file_get_contents($dir . '/state.json'), true);
    return is_array($state) ? $state : null;
}

function relaySaveState($dir, $state) {
    $temporary = $dir . '/state.' . getmypid() . '.tmp';
    if (@file_put_contents($temporary, json_encode($state)) !== false) @rename($temporary, $dir . '/state.json');
}

/** Viewers that showed signs of life in the last RELAY_IDLE seconds. */
function relayViewers($dir) {
    $count = 0; $limit = time() - RELAY_IDLE;
    foreach ((array)@scandir($dir . '/viewers') as $name) {
        if ($name === '.' || $name === '..') continue;
        $path = $dir . '/viewers/' . $name; $time = @filemtime($path);
        if ($time !== false && $time >= $limit) $count++;
        elseif ($time !== false && $time < $limit - 60) @unlink($path);
    }
    return $count;
}

/** One viewer: sends the channel's pieces as they are written, and writes them while it holds the lock. */
function relayServe($source) {
    @set_time_limit(0);
    ignore_user_abort(true); // A writer whose own viewer left keeps going while others watch.
    $dir = relayDir($source);
    $me = $dir . '/viewers/' . bin2hex(random_bytes(6));
    @touch($me);
    register_shutdown_function(function () use (&$me) { if ($me) @unlink($me); });
    $lock = @fopen($dir . '/writer.lock', 'c');
    if (!$lock) failure('El hosting no deja escribir en su carpeta temporal.');
    $writer = null; $seq = null; $offset = 0; $headers = false; $lockAt = 0;
    $started = microtime(true); $lastData = $started; $beat = 0;
    while (true) {
        $now = microtime(true);
        $watching = !connection_aborted();
        if ($watching && $now - $beat > 2) { @touch($me); $beat = $now; }
        if (!$watching && $me) { @unlink($me); $me = null; }
        if ($writer === null && $now >= $lockAt && flock($lock, LOCK_EX | LOCK_NB)) $writer = relayWriterStart($dir, $source);
        if ($writer !== null) {
            relayPump($writer, 0.2);
            if (relayViewers($dir) === 0 || $writer['failed']) {
                if ($writer['failed']) $lockAt = $now + 10;
                relayWriterStop($writer); flock($lock, LOCK_UN); $writer = null;
            }
        } else usleep(200000);
        if (!$watching) { if ($writer === null) break; continue; }
        $state = relayState($dir);
        if (!$headers && $state && !empty($state['error']) && $now - $started > 3) failure($state['error']);
        if ($state && isset($state['seq'])) {
            // A new viewer starts one piece behind the newest (a keyframe, with a little margin);
            // one that fell behind the pieces kept jumps forward the same way.
            if ($seq === null || $seq < $state['first']) { $seq = max($state['first'], $state['seq'] - 1); $offset = 0; }
            $sent = relaySend($dir, $seq, $offset, $headers);
            if ($sent > 0) $lastData = $now;
            elseif ($seq < $state['seq']) { $seq++; $offset = 0; continue; }
        }
        if (!$headers && $now - $started > 25) failure('No llega vídeo del proveedor IPTV.');
        if ($headers && $now - $lastData > 30) break; // The player reconnects by itself.
    }
    exit;
}

/** Sends what piece $seq has after $offset; how many bytes. */
function relaySend($dir, $seq, &$offset, &$headers) {
    $file = @fopen($dir . '/seg-' . $seq . '.ts', 'rb');
    if (!$file) return 0;
    fseek($file, $offset); $total = 0;
    while (!feof($file) && $total < 4 * RELAY_PIECE) {
        $data = fread($file, 262144);
        if ($data === false || $data === '') break;
        if (!$headers) {
            header('Content-Type: video/mp2t'); header('X-Accel-Buffering: no');
            header('X-Content-Type-Options: nosniff'); $headers = true;
        }
        echo $data; flush();
        $total += strlen($data);
    }
    fclose($file);
    $offset += $total;
    return $total;
}

// ---- The writer: the only connection to the provider -------------------------------------------

function relayWriterStart($dir, $source) {
    $state = relayState($dir) ?: array();
    // A writer taking over continues after the last moment already written (tsSplice), in a new piece.
    $seq = isset($state['seq']) ? $state['seq'] + 1 : 0;
    $first = isset($state['first']) ? $state['first'] : 0;
    if ($state && time() - ($state['time'] ?? 0) > 30) {
        // Pieces from an earlier session are old video: viewers wait for the first new one.
        while ($first < $seq) @unlink($dir . '/seg-' . $first++ . '.ts');
        $state = array('seq' => $seq, 'first' => $seq, 'pcr' => null, 'video' => null, 'time' => time());
    }
    $writer = array('dir' => $dir, 'source' => $source, 'multi' => curl_multi_init(), 'handle' => null,
        'url' => $source, 'hop' => 0, 'status' => 0, 'location' => '', 'got' => false, 'retryAt' => 0.0,
        'seq' => $seq, 'first' => $first, 'size' => 0, 'fresh' => true, 'lastVideo' => microtime(true),
        'failed' => false, 'http' => 0, 'misses' => 0,
        'splice' => tsSpliceNext(array('pcr' => $state['pcr'] ?? null, 'video' => $state['video'] ?? null)));
    unset($state['error']);
    if ($state) relaySaveState($dir, $state);
    return $writer;
}

function relayWriterStop(&$writer) {
    if ($writer['handle']) { curl_multi_remove_handle($writer['multi'], $writer['handle']); curl_close($writer['handle']); }
    curl_multi_close($writer['multi']);
}

/** Moves the provider connection forward for up to $wait seconds, and opens the next one when it ends. */
function relayPump(&$writer, $wait) {
    $now = microtime(true);
    if (!$writer['handle'] && $now >= $writer['retryAt']) relayOpen($writer);
    if (!$writer['handle']) { usleep((int)($wait * 1000000)); return; }
    $running = 0;
    curl_multi_exec($writer['multi'], $running);
    if ($running) { curl_multi_select($writer['multi'], $wait); curl_multi_exec($writer['multi'], $running); }
    while ($info = curl_multi_info_read($writer['multi'])) {
        if ($info['handle'] === $writer['handle']) relayFinished($writer);
    }
    // No new video for 40 s: tell the viewers and give the lock up (the next viewer request tries again).
    if (microtime(true) - $writer['lastVideo'] > 40) {
        $writer['failed'] = true;
        $state = relayState($writer['dir']) ?: array();
        $state['error'] = 'El proveedor IPTV no envía vídeo. HTTP: ' . ($writer['http'] ?: 'sin respuesta');
        relaySaveState($writer['dir'], $state);
    }
}

function relayOpen(&$writer) {
    if (relayTestUpstream()) $target = null;
    else {
        $target = publicTarget($writer['url']);
        if ($target === null) { relayRetry($writer, 2); return; }
    }
    $writer['status'] = 0; $writer['location'] = '';
    $ch = curl_init($writer['url']);
    $options = array(
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT_MS => 4000, CURLOPT_PROXY => '',
        // It also ends when the provider stops sending video for 20 s; the next connection follows.
        CURLOPT_LOW_SPEED_LIMIT => 1, CURLOPT_LOW_SPEED_TIME => 20,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        // Many IPTV servers only answer known players; VLC's name is the one they accept.
        CURLOPT_USERAGENT => 'VLC/3.0.20 LibVLC/3.0.20',
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$writer) {
            if (preg_match('~^HTTP/[^ ]+ ([0-9]{3})~', $line, $m)) $writer['status'] = (int)$m[1];
            if (stripos($line, 'Location:') === 0) $writer['location'] = trim(substr($line, 9));
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$writer) {
            // Error pages and redirects are read but not kept (at most 64 KiB).
            if (!in_array($writer['status'], array(200, 206), true)) return curl_getinfo($ch, CURLINFO_SIZE_DOWNLOAD) > 65536 ? 0 : strlen($chunk);
            relayWrite($writer, tsSplice($writer['splice'], $chunk));
            return strlen($chunk);
        },
    );
    if ($target !== null) $options[CURLOPT_RESOLVE] = array($target['host'] . ':' . $target['port'] . ':' . $target['ip']);
    curl_setopt_array($ch, $options);
    $writer['handle'] = $ch;
    curl_multi_add_handle($writer['multi'], $ch);
}

/** A provider connection ended: follow its redirect, or open the next connection from the start. */
function relayFinished(&$writer) {
    $ch = $writer['handle'];
    $writer['http'] = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_multi_remove_handle($writer['multi'], $ch); curl_close($ch); $writer['handle'] = null;
    $redirect = in_array($writer['http'], array(301, 302, 303, 307, 308), true) && $writer['location'] && $writer['hop'] < 4;
    $next = $redirect ? redirectTarget($writer['url'], $writer['location']) : null;
    if ($next !== null) { $writer['url'] = $next; $writer['hop']++; $writer['retryAt'] = 0.0; return; }
    $got = $writer['got'];
    // A provider that answers with no video at all (wrong link, account full): viewers see why.
    if (!$got && $writer['fresh'] && ++$writer['misses'] >= 2) {
        $state = relayState($writer['dir']) ?: array();
        $state['error'] = 'El proveedor IPTV no envía vídeo. HTTP: ' . ($writer['http'] ?: 'sin respuesta');
        relaySaveState($writer['dir'], $state);
    }
    relayRetry($writer, $got ? 0.1 : 1.5);
}

function relayRetry(&$writer, $seconds) {
    $writer['url'] = $writer['source']; $writer['hop'] = 0; $writer['got'] = false;
    $writer['splice'] = tsSpliceNext($writer['splice']);
    $writer['retryAt'] = microtime(true) + $seconds;
}

/** Keeps new video: whole stretches from a keyframe (tsSplice), in pieces that each start at one. */
function relayWrite(&$writer, $video) {
    if ($video === '') return;
    $writer['got'] = true; $writer['lastVideo'] = microtime(true);
    $dir = $writer['dir'];
    if ($writer['fresh'] || $writer['size'] >= RELAY_PIECE) {
        if (!$writer['fresh']) $writer['seq']++;
        $writer['fresh'] = false;
        // Each piece opens with the channel's tables, so a viewer starting there can decode at once.
        $video = $writer['splice']['pat'] . $writer['splice']['pmt'] . $video;
        @file_put_contents($dir . '/seg-' . $writer['seq'] . '.ts', $video);
        $writer['size'] = strlen($video);
        while ($writer['first'] <= $writer['seq'] - RELAY_PIECES) @unlink($dir . '/seg-' . $writer['first']++ . '.ts');
    } else {
        @file_put_contents($dir . '/seg-' . $writer['seq'] . '.ts', $video, FILE_APPEND);
        $writer['size'] += strlen($video);
    }
    relaySaveState($dir, array('seq' => $writer['seq'], 'first' => $writer['first'],
        'pcr' => $writer['splice']['pcr'], 'video' => $writer['splice']['video'], 'time' => time()));
}

// ---- MPEG-TS -------------------------------------------------------------------------------------

/** The PCR clock of an MPEG-TS packet in seconds, or null if the packet carries none. */
function tsPcr($packet) {
    if (!(ord($packet[3]) & 0x20) || ord($packet[4]) < 7 || !(ord($packet[5]) & 0x10)) return null;
    return ((ord($packet[6]) << 25) | (ord($packet[7]) << 17) | (ord($packet[8]) << 9) | (ord($packet[9]) << 1) | (ord($packet[10]) >> 7)) / 90000;
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

/** The table a packet starts (its table_id and section), or null. */
function tsTable($packet) {
    if (!tsStarts($packet)) return null;
    $at = 4;
    if (ord($packet[3]) & 0x20) $at += 1 + ord($packet[4]);
    if ($at >= 188) return null;
    $at += 1 + ord($packet[$at]);
    if ($at + 3 > 188) return null;
    $length = ((ord($packet[$at + 1]) & 0x0f) << 8) | ord($packet[$at + 2]);
    return array('id' => ord($packet[$at]), 'section' => substr($packet, $at, 3 + $length));
}

/** The video PID a PMT section names, or null. */
function tsVideoPid($section) {
    if (strlen($section) < 16) return null;
    $at = 12 + (((ord($section[10]) & 0x0f) << 8) | ord($section[11]));
    $end = strlen($section) - 4;
    while ($at + 5 <= $end) {
        $type = ord($section[$at]); $pid = ((ord($section[$at + 1]) & 0x1f) << 8) | ord($section[$at + 2]);
        if (in_array($type, array(0x01, 0x02, 0x10, 0x1b, 0x24, 0x42, 0xd1, 0xea), true)) return $pid;
        $at += 5 + (((ord($section[$at + 3]) & 0x0f) << 8) | ord($section[$at + 4]));
    }
    return null;
}

/** A fresh state for tsSplice, or the one for the next connection to the provider. */
function tsSpliceNext($state = null) {
    $state = $state ?: array();
    // What was held after the last keyframe is dropped: the next connection resends that picture whole.
    $pcr = $state['pcr'] ?? null;
    return array('pcr' => $pcr, 'video' => $state['video'] ?? null, 'skip' => true, 'ahead' => $pcr === null,
        'carry' => '', 'hold' => '', 'seen' => $pcr, 'wait' => array(), 'pat' => $state['pat'] ?? '',
        'pmt' => $state['pmt'] ?? '', 'pmtPid' => $state['pmtPid'] ?? null, 'pcrPid' => $state['pcrPid'] ?? null);
}

/**
 * The part of a chunk to keep, cut only at keyframes of the video, so a viewer never gets half a picture:
 * what came after the last keyframe is held until the next one, and dropped if the connection ends
 * first. A new connection to these providers starts again with the last ~40 s: it resumes at the first
 * keyframe after the last clock kept ('pcr'), and every other stream at its next unit start. A clock far
 * away (the channel restarted) resumes at once. It also keeps the latest PAT and PMT packets.
 */
function tsSplice(&$state, $chunk) {
    $data = $state['carry'] . $chunk; $out = ''; $i = 0; $length = strlen($data);
    while ($i + 188 <= $length) {
        if ($data[$i] !== "\x47") { $i++; continue; }
        $packet = substr($data, $i, 188); $i += 188;
        $pid = tsPid($packet); $pcr = tsPcr($packet);
        if ($pid === 0 || $pid === $state['pmtPid']) {
            $table = tsTable($packet);
            if ($table && $table['id'] === 0x00 && strlen($table['section']) >= 16) {
                $state['pat'] = $packet;
                $state['pmtPid'] = ((ord($table['section'][10]) & 0x1f) << 8) | ord($table['section'][11]);
            } elseif ($table && $table['id'] === 0x02) {
                $state['pmt'] = $packet;
                $video = tsVideoPid($table['section']);
                if ($video !== null) $state['video'] = $video;
            }
        }
        // Without a PMT naming it, the video is the stream carrying the clock.
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
        // A video with no keyframes marked is kept anyway, a few megabytes at a time.
        if (strlen($state['hold']) > 8 << 20) { $out .= $state['hold']; $state['hold'] = ''; $state['pcr'] = $state['seen']; }
    }
    $state['carry'] = substr($data, $i);
    return $out;
}

if (!defined('CALAMAR_RELAY_TEST_ONLY')) relayMain();
