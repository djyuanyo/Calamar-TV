"""calamar-player.php: player pages read like the app, lists relayed with signed addresses, catalog channels only."""
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
PHP = str(ROOT / 'hosting/calamar-player.php')
SECRET = 'secreto-de-prueba-0123456789abcdef'


def php(code):
    env = {**os.environ, 'CALAMAR_PLAYER_SECRET': SECRET}
    return subprocess.check_output(['php', '-r', f'require {json.dumps(PHP)}; {code}'], text=True, env=env)


class PlayerRelayTest(unittest.TestCase):
    def test_zt_sources_in_order_without_the_locked_ones(self):
        page = ('<script>var ZT_SOURCES = [{"label":"CDN 4","url":"https://cdn4.zicotv.cc/live/a.m3u8?t=1","premium":false},'
                '{"label":"CDN 1","url":"/live/b.m3u8?t=\\"2\\"","hidden":true},'
                '{"label":"CDN Premium","url":"https://zicotv.cc/premium","locked":true}];'
                '</script><video src="https://other.example/never.m3u8"></video>')
        found = json.loads(php(f'echo json_encode(playerSources({json.dumps(page)}, "https://zicotv.cc/canal/x"));'))
        self.assertEqual(found, ['https://cdn4.zicotv.cc/live/a.m3u8?t=1', 'https://zicotv.cc/live/b.m3u8?t="2"'])

    def test_video_tags_and_packed_players(self):
        tag = '<video><source src="//cdn.example/v/index.m3u8?a=1&amp;b=2" type="application/x-mpegURL"></video>'
        self.assertEqual(json.loads(php(f'echo json_encode(playerSources({json.dumps(tag)}, "https://p.example/x"));')),
                         ['https://cdn.example/v/index.m3u8?a=1&b=2'])
        packed = ("<script>eval(function(p,a,c,k,e,d){}('0.1({2:[{3:\"4://5.6/7/8.9?t=a\"}]});',36,11,"
                  "'jwplayer|setup|sources|file|https|cdn1016|org|hls2|master|m3u8|xyz'.split('|')))</script>")
        self.assertEqual(json.loads(php(f'echo json_encode(playerSources({json.dumps(packed)}, "https://p.example/x"));')),
                         ['https://cdn1016.org/hls2/master.m3u8?t=xyz'])
        self.assertEqual(json.loads(php('echo json_encode(playerSources("<p>Sin vídeo</p>", "https://p.example/x"));')), [])

    def test_every_address_of_a_list_goes_through_the_relay_with_its_page(self):
        media = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg-001.ts?x=1\n#EXTINF:6,\n/abs/seg-002.ts\n'
        out = php(f'echo playerRewrite({json.dumps(media)}, "https://cdn4.zicotv.cc/live/chunks.m3u8?t=9", "https://zicotv.cc/canal/x", playerSecret());')
        decoded = json.loads(php('echo json_encode(array_map(function ($l) { if (!preg_match("/seg=([^&\\"]+)&p=([^&\\"]+)&sig=([0-9a-f]{32})/", $l, $m)) return null;'
                                 ' $u = playerUnB64($m[1]); $p = playerUnB64($m[2]); return [$u, $p, hash_equals(playerSign($u, $p, playerSecret()), $m[3])]; }, '
                                 f'explode("\\n", {json.dumps(out)})));'))
        page = 'https://zicotv.cc/canal/x'
        self.assertEqual(decoded[1], ['https://cdn4.zicotv.cc/live/key.bin', page, True])
        self.assertEqual(decoded[3], ['https://cdn4.zicotv.cc/live/seg-001.ts?x=1', page, True])
        self.assertEqual(decoded[5], ['https://cdn4.zicotv.cc/abs/seg-002.ts', page, True])
        self.assertTrue(out.split('\n')[3].startswith('calamar-player.php?seg='))
        # A signature is only valid for its own page.
        self.assertNotEqual(php('echo playerSign("https://a.example/s.ts", "https://one.example/", "k");'),
                            php('echo playerSign("https://a.example/s.ts", "https://two.example/", "k");'))

    def test_only_channels_of_the_catalog_are_allowed(self):
        catalog = json.dumps({'channels': [{'id': 'c', 'name': 'Primera Federación', 'streams': ['https://zicotv.cc/canal/x']}]})
        with tempfile.TemporaryDirectory() as tmp:
            out = subprocess.check_output(['php', '-d', f'sys_temp_dir={tmp}', '-r',
                                           f'require {json.dumps(PHP)}; echo json_encode(array_keys(playerCatalogStreams(function () {{ return {json.dumps(catalog)}; }})));'],
                                          text=True, env={**os.environ, 'TMPDIR': tmp, 'CALAMAR_PLAYER_SECRET': SECRET})
        self.assertEqual(json.loads(out), ['https://zicotv.cc/canal/x'])

    def test_event_player_is_allowed_only_when_public_event_lists_it(self):
        event = 'https://bp.zicotv.cc/events/98019'
        player = 'https://bp.zicotv.cc/api/player/22'
        catalog = json.dumps({'channels': [], 'events': [{'id': 'match', 'streams': [event]}]})
        with tempfile.TemporaryDirectory() as tmp:
            code = (f'require {json.dumps(PHP)};'
                    f'$streams=playerCatalogStreams(function () {{ return {json.dumps(catalog)}; }});'
                    '$get=function ($url) { return [200, json_encode(["data"=>["sources"=>'
                    '[ ["name"=>"Canal", "player_url"=>"https://bp.zicotv.cc/api/player/22"] ] ]])]; };'
                    'echo json_encode([isset($streams["https://bp.zicotv.cc/events/98019"]),'
                    'playerAllowedPage("https://bp.zicotv.cc/api/player/22",$streams,$get),'
                    'playerAllowedPage("https://bp.zicotv.cc/api/player/23",$streams,$get),'
                    'playerAllowedPage("https://evil.example/api/player/22",$streams,$get)]);')
            out = subprocess.check_output(['php', '-d', f'sys_temp_dir={tmp}', '-r', code],
                text=True, env={**os.environ, 'TMPDIR': tmp, 'CALAMAR_PLAYER_SECRET': SECRET})
        self.assertEqual(json.loads(out), [True, True, False, False])

    def test_unsigned_addresses_other_sites_and_unknown_pages_are_refused(self):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as tmp:
            # A copy of the catalog without that page, so no request leaves the test.
            pathlib.Path(tmp, 'calamar-player-catalog.json').write_text(json.dumps({'channels': []}))
            env = {**os.environ, 'CALAMAR_PLAYER_SECRET': SECRET, 'TMPDIR': tmp}
            server = subprocess.Popen(['php', '-d', f'sys_temp_dir={tmp}', '-S', f'127.0.0.1:{port}', '-t', str(ROOT / 'hosting')], env=env, cwd=home,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(50):
                    try: socket.create_connection(('127.0.0.1', port), timeout=0.2).close(); break
                    except OSError: time.sleep(0.1)
                bad = 'aHR0cHM6Ly9leGFtcGxlLmNvbS9zZWNyZXQ'
                for query, code in ((f'seg={bad}&p=&sig=00000000000000000000000000000000', 403), (f'seg={bad}', 403),
                                    ('page=https%3A%2F%2Fzicotv.cc%2Fcanal%2Fx&hls=1', 403), ('page=http%3A%2F%2Fzicotv.cc%2F&hls=1', 400)):
                    with self.assertRaises(urllib.error.HTTPError) as refused:
                        urllib.request.urlopen(f'http://127.0.0.1:{port}/calamar-player.php?{query}', timeout=5)
                    self.assertEqual(refused.exception.code, code, query)
                with self.assertRaises(urllib.error.HTTPError) as other:
                    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/calamar-player.php?page=x',
                                                                  headers={'Origin': 'https://evil.example'}), timeout=5)
                self.assertEqual(other.exception.code, 403)
                # Chromecast asks for signed addresses from its own origin: allowed, but only with a valid signature.
                with self.assertRaises(urllib.error.HTTPError) as cast:
                    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/calamar-player.php?seg={bad}&p=&sig=00000000000000000000000000000000&l=1',
                                                                  headers={'Origin': 'https://www.gstatic.com'}), timeout=5)
                self.assertEqual(cast.exception.code, 403)
                self.assertEqual(cast.exception.headers['Access-Control-Allow-Origin'], '*')
            finally:
                server.terminate(); server.wait()
            self.assertEqual(list(pathlib.Path(home).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
