"""The IPTV relay: one provider connection per channel shared by every viewer, joined seamlessly."""
import base64
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = ROOT / 'hosting/calamar-tv-relay.php'


def packet(pcr=None, key=False, tag=0, pid=256, start=None):
    """A 188-byte TS packet; tag marks it so the test can tell packets apart. Keyframes start a unit."""
    start = key if start is None else start
    head = bytes([0x47, (0x40 if start else 0) | (pid >> 8), pid & 0xff, 0x30])
    flags = (0x10 if pcr is not None else 0) | (0x40 if key else 0)
    field = bytes([flags])
    if pcr is not None:
        base = int(pcr * 90000)
        field += bytes([(base >> 25) & 0xff, (base >> 17) & 0xff, (base >> 9) & 0xff, (base >> 1) & 0xff, ((base & 1) << 7) | 0x7e, 0])
    body = bytes([len(field)]) + field
    return head + body + bytes([tag]) * (184 - len(body))


def pcrs(data):
    out = []
    for i in range(0, len(data) - 187, 188):
        p = data[i:i + 188]
        if p[0] == 0x47 and p[3] & 0x20 and p[4] >= 7 and p[5] & 0x10:
            out.append(((p[6] << 25) | (p[7] << 17) | (p[8] << 9) | (p[9] << 1) | (p[10] >> 7)) / 90000)
    return out


@unittest.skipUnless(shutil.which('php'), 'Requires PHP CLI')
class SpliceTest(unittest.TestCase):
    def splice(self, connections, chunk=1000):
        """Tags kept for each connection, cut into chunks that split packets."""
        program = ('define("CALAMAR_RELAY_TEST_ONLY", true); require ' + json.dumps(str(PHP)) + ';'
                   '$s = null; $out = [];'
                   'foreach (json_decode(file_get_contents("php://stdin"), true) as $c) {'
                   '  $s = tsSpliceNext($s); $data = hex2bin($c); $got = "";'
                   '  foreach (str_split($data, ' + str(chunk) + ') as $piece) $got .= tsSplice($s, $piece);'
                   '  $tags = []; foreach (str_split($got, 188) as $p) $tags[] = ord($p[187]); $out[] = $tags; }'
                   'echo json_encode($out);')
        stdin = json.dumps([b''.join(c).hex() for c in connections])
        return json.loads(subprocess.run(['php', '-r', program], input=stdin, capture_output=True, text=True, check=True).stdout)

    def test_cuts_only_at_keyframes_and_resumes_after_the_last_one_kept(self):
        # Kept: 1-4 (up to the keyframe at 12 s, held until the next keyframe). 5-6 are dropped when the
        # connection ends: half a picture. The next one starts again at 10 s and resumes at a keyframe after 11.5 s.
        first = [packet(10, True, 1), packet(None, False, 2), packet(11, False, 3), packet(11.5, False, 4),
                 packet(None, True, 5), packet(12, False, 6)]
        second = [packet(10, True, 7), packet(11, False, 8), packet(None, True, 9), packet(12, False, 10),
                  packet(12.5, False, 11), packet(None, True, 12), packet(13, False, 13), packet(None, True, 14)]
        self.assertEqual(self.splice([first, second]), [[1, 2, 3, 4], [12, 13]])

    def test_it_starts_at_the_first_keyframe_and_other_streams_at_their_unit_start(self):
        audio = 257
        data = [packet(1, False, 1), packet(None, False, 2, pid=audio), packet(None, True, 3),
                packet(None, False, 4, pid=audio), packet(None, False, 5, pid=audio, start=True),
                packet(2, False, 6), packet(None, True, 7)]
        self.assertEqual(self.splice([data]), [[3, 5, 6]])

    def test_a_connection_with_nothing_new_keeps_nothing(self):
        first = [packet(10, True, 1), packet(20, True, 2), packet(None, True, 3)]
        second = [packet(10, True, 4), packet(15, True, 5)]
        third = [packet(18, True, 6), packet(21, True, 7), packet(22, True, 8)]
        self.assertEqual(self.splice([first, second, third]), [[1, 2], [], [7]])

    def test_a_restarted_channel_clock_resumes_at_once(self):
        first = [packet(5000, True, 1), packet(None, True, 2)]
        second = [packet(None, False, 3), packet(3, True, 4), packet(4, False, 5), packet(None, True, 6)]
        self.assertEqual(self.splice([first, second], chunk=188), [[1], [4, 5]])


class Provider(http.server.ThreadingHTTPServer):
    """Like the real IPTV servers: every connection first sends the last ~6 s it keeps at once, then plays
    in real time, and closes after 5 s. It counts connections open at the same time."""
    daemon_threads = True

    def __init__(self, video):
        self.video = video; self.rate = len(video) / 60; self.began = time.time()
        self.open = 0; self.most = 0; self.total = 0; self.lock = threading.Lock()
        super().__init__(('127.0.0.1', 0), Handler)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        server = self.server
        with server.lock:
            server.open += 1; server.total += 1; server.most = max(server.most, server.open)
        try:
            self.send_response(200); self.send_header('Content-Type', 'video/mp2t'); self.end_headers()
            live = lambda: int((time.time() - server.began + 8) * server.rate) // 188 * 188
            at = max(0, live() - int(6 * server.rate) // 188 * 188)
            until = time.time() + 5
            while time.time() < until:
                end = min(live(), len(server.video))
                if end > at:
                    self.wfile.write(server.video[at:end]); self.wfile.flush(); at = end
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with server.lock:
                server.open -= 1


@unittest.skipUnless(shutil.which('php') and shutil.which('ffmpeg'), 'Requires PHP CLI and FFmpeg')
class SharedRelayTest(unittest.TestCase):
    def test_three_viewers_share_one_provider_connection_and_get_continuous_video(self):
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder) / 'channel.ts'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25',
                            '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast',
                            '-g', '25', '-c:a', 'aac', '-f', 'mpegts', str(source)], check=True, timeout=120)
            provider = Provider(source.read_bytes())
            threading.Thread(target=provider.serve_forever, daemon=True).start()
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
            temp = pathlib.Path(folder) / 'tmp'; temp.mkdir()
            env = {**os.environ, 'CALAMAR_RELAY_TEST_LOCAL': '1', 'TMPDIR': str(temp), 'PHP_CLI_SERVER_WORKERS': '6'}
            # The hosting disables these: the relay must work without them.
            disabled = 'curl_multi_init,curl_multi_exec,curl_multi_select,curl_multi_info_read,getmypid'
            server = subprocess.Popen(['php', '-d', 'disable_functions=' + disabled, '-S', f'127.0.0.1:{port}', '-t', str(PHP.parent)], env=env,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                time.sleep(1)
                address = f'http://127.0.0.1:{provider.server_address[1]}/live/user/pass/1.ts'
                results = [None] * 3

                def watch(n):
                    time.sleep(n * 2)
                    request = urllib.request.Request(f'http://127.0.0.1:{port}/calamar-tv-relay.php?stream=1', headers={
                        'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(address.encode()).decode()})
                    data = bytearray(); began = time.time()
                    with urllib.request.urlopen(request, timeout=30) as answer:
                        while time.time() - began < 20:
                            chunk = answer.read(65536)
                            if not chunk: break
                            data += chunk
                    results[n] = bytes(data)

                threads = [threading.Thread(target=watch, args=(n,)) for n in range(3)]
                for t in threads: t.start()
                for t in threads: t.join()
                # Nobody watching: the provider connection closes after RELAY_IDLE (15 s).
                deadline = time.time() + 25
                while provider.open and time.time() < deadline: time.sleep(0.5)
                total = provider.total; time.sleep(6)
                idle_closed = provider.open == 0 and provider.total == total
            finally:
                server.terminate(); server.wait(); provider.shutdown()
            self.assertTrue(idle_closed)
            # One provider connection at a time, although it closes every 5 s and three people watch.
            self.assertEqual(provider.most, 1)
            self.assertGreaterEqual(provider.total, 3)
            for n, data in enumerate(results):
                clock = pcrs(data)
                self.assertGreater(len(data), 100000, n)
                self.assertEqual([(a, b) for a, b in zip(clock, clock[1:]) if b < a], [], n)
                self.assertEqual([(a, b) for a, b in zip(clock, clock[1:]) if b - a > 1.2], [], n)
                self.assertGreater(clock[-1] - clock[0], 12, n)
                # The recording stops halfway through a picture: decode up to its last keyframe.
                keys = [i for i in range(0, len(data) - 187, 188) if data[i + 1] & 0x40 and data[i + 3] & 0x20 and data[i + 4] and data[i + 5] & 0x40]
                path = pathlib.Path(folder) / f'viewer{n}.ts'; path.write_bytes(data[:keys[-1]])
                errors = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'null', '-'],
                                        capture_output=True, text=True).stderr.strip()
                self.assertEqual(errors, '', n)


if __name__ == '__main__':
    unittest.main()
