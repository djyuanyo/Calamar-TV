"""calamar-lulu.php: HLS lists rewritten through the relay, signed addresses only, nothing stored."""
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = str(ROOT / 'hosting/calamar-lulu.php')


def php(code):
    env = {**os.environ, 'CALAMAR_LULU_SECRET': 'secreto-de-prueba-0123456789abcdef'}
    return subprocess.check_output(['php', '-r', f'require {json.dumps(PHP)}; {code}'], text=True, env=env)


class LuluRelayTest(unittest.TestCase):
    def test_every_address_of_a_list_goes_through_the_relay(self):
        master = '\n'.join(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720', 'index-v1-a1.m3u8?t=abc',
                            '#EXT-X-MEDIA:TYPE=SUBTITLES,URI="/subs/es.m3u8"', '#EXT-X-KEY:METHOD=AES-128,URI="https://k.example/key"',
                            '//other.example/seg1.ts', ''])
        out = php(f'echo luluRewrite({json.dumps(master)}, "https://cdn1016.cdn-tnmr.org/hls2/02/04521/x_h/master.m3u8?t=1", luluSecret());')
        lines = out.split('\n')
        self.assertEqual(lines[0], '#EXTM3U')
        self.assertEqual(lines[1], '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720')
        decoded = json.loads(php('echo json_encode(array_map(function ($l) { preg_match("/seg=([^&\\"]+)&sig=([0-9a-f]{32})/", $l, $m);'
                                 ' if (!$m) return null; $u = base64_decode(strtr($m[1], "-_", "+/")); return [$u, hash_equals(luluSign($u, luluSecret()), $m[2])]; }, '
                                 f'explode("\\n", {json.dumps(out)})));'))
        self.assertEqual(decoded[2], ['https://cdn1016.cdn-tnmr.org/hls2/02/04521/x_h/index-v1-a1.m3u8?t=abc', True])
        self.assertEqual(decoded[3], ['https://cdn1016.cdn-tnmr.org/subs/es.m3u8', True])
        self.assertEqual(decoded[4], ['https://k.example/key', True])
        self.assertEqual(decoded[5], ['https://other.example/seg1.ts', True])
        self.assertTrue(lines[2].startswith('calamar-lulu.php?seg='))

    def test_the_video_address_is_read_from_the_packed_player(self):
        packed = ("<script>eval(function(p,a,c,k,e,d){}('0.1({2:[{3:\"4://5.6/7/8.9?t=a\"}]});',36,11,"
                  "'jwplayer|setup|sources|file|https|cdn1016|org|hls2|master|m3u8|xyz'.split('|')))</script>")
        self.assertEqual(php(f'echo luluVideo(luluScripts({json.dumps(packed)}));'), 'https://cdn1016.org/hls2/master.m3u8?t=xyz')

    def test_a_video_still_being_converted_is_recognised(self):
        page = '<div>Video is processing now.<br>Conversion stage: Pending in queue #3</div>'
        self.assertEqual(php(f'echo luluProcessing({json.dumps(page)}) ? "si" : "no";'), 'si')
        self.assertEqual(php(f'echo luluVideo(luluScripts({json.dumps(page)})) === null ? "null" : "video";'), 'null')
        self.assertEqual(php('echo luluProcessing("<script>p.setup({sources:[]})</script>") ? "si" : "no";'), 'no')

    def test_only_signed_addresses_are_relayed(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        with tempfile.TemporaryDirectory() as home:
            env = {**os.environ, 'CALAMAR_LULU_SECRET': 'secreto-de-prueba-0123456789abcdef'}
            server = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', str(ROOT / 'hosting')], env=env, cwd=home,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(50):
                    try: socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
                    except OSError: time.sleep(0.1)
                bad = 'aHR0cHM6Ly9leGFtcGxlLmNvbS9zZWNyZXQ'  # https://example.com/secret, unsigned
                for query in (f'seg={bad}&sig=00000000000000000000000000000000', f'seg={bad}'):
                    with self.assertRaises(urllib.error.HTTPError) as refused:
                        urllib.request.urlopen(f'http://127.0.0.1:{port}/calamar-lulu.php?{query}', timeout=5)
                    self.assertEqual(refused.exception.code, 403)
                # Chromecast reads the film from its own origin: the video answers any origin (here 502,
                # as the test reaches no LuluStream), with an open CORS header and nothing else.
                with self.assertRaises(urllib.error.HTTPError) as cast:
                    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/calamar-lulu.php?code=abc12345&hls=1',
                                                                  headers={'Origin': 'https://www.gstatic.com'}), timeout=5)
                self.assertNotEqual(cast.exception.code, 403)
                self.assertEqual(cast.exception.headers['Access-Control-Allow-Origin'], '*')
                # Everything else stays only for the web.
                with self.assertRaises(urllib.error.HTTPError) as other:
                    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/calamar-lulu.php?introdb=1&tmdb_id=1&season=1&episode=1',
                                                                  headers={'Origin': 'https://evil.example'}), timeout=5)
                self.assertEqual(other.exception.code, 403)
            finally:
                server.terminate(); server.wait()
            self.assertEqual(list(pathlib.Path(home).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
