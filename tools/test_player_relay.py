"""calamar-player.php: player pages read like the app, lists relayed with signed addresses, catalog channels only."""
import json
import http.server
import threading
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


def php(code, disabled=()):
    env = {**os.environ, 'CALAMAR_PLAYER_SECRET': SECRET}
    args = ['php'] + (['-d', 'disable_functions=' + ','.join(disabled)] if disabled else [])
    return subprocess.check_output(args + ['-r', f'require {json.dumps(PHP)}; {code}'], text=True, env=env)


class PlayerRelayTest(unittest.TestCase):
    def test_cacheable_zico_player_uses_its_signed_renewal_post_without_executing_scripts(self):
        page = 'https://bp.zicotv.cc/api/player/4'
        renew = '/api/player/4/renew?expires=1794427569&signature=' + 'a' * 64
        html = '<script>var ZT_SOURCES = [{"url":null}]; var ZT_SRC_GATE = null; var ZT_RENEW = ' + json.dumps({'url': renew, 'ttl': 1200, 'view': True}) + '; alert("must never run");</script>'
        code = f'''
        $calls = [];
        $post = function($url,$page,$body) use (&$calls) {{
            $calls[] = [$url,$page,$body];
            return [200,json_encode(['ttl'=>1200,'sources'=>[
                ['url'=>'https://cdn6.zicotv.cc/live/index.m3u8?token=fresh','label'=>'CDN 6'],
                ['url'=>'https://cdn.zicotv.cc/live/index.m3u8?token=locked','locked'=>true],
                ['url'=>'https://hidden.example/live.m3u8','hidden'=>true],
                ['url'=>'http://private.example/live.m3u8'],
                ['url'=>'https://user:secret@cdn.example/live.m3u8'],
                ['url'=>null]
            ]])];
        }};
        $result=playerZicoRenewSources({json.dumps(html)},{json.dumps(page)},$post);
        echo json_encode([$calls,$result,playerJsonConfig('var ZT_RENEW = fetch("evil");','ZT_RENEW')]);
        '''
        calls, result, unsafe = json.loads(php(code))
        self.assertEqual(calls, [[page + '/renew?expires=1794427569&signature=' + 'a' * 64, page, {'native': False}]])
        self.assertEqual(result['ttl'], 1200)
        self.assertEqual(result['sources'], [{'url': 'https://cdn6.zicotv.cc/live/index.m3u8?token=fresh', 'label': 'CDN 6'}])
        self.assertIsNone(unsafe)

    def test_renewal_stays_on_the_same_channel_and_respects_verification_and_session_gates(self):
        good = '/api/player/4/renew?expires=1794427569&signature=' + 'a' * 64
        variants = [
            ({'url': 'https://evil.example' + good}, ''),
            ({'url': good.replace('/4/', '/5/')}, ''),
            ({'url': good + '&redirect=https://evil.example'}, ''),
            ({'url': good, 'conn': True}, ''),
            ({'url': good}, 'var ZT_SRC_GATE = {"url":"/captcha","sitekey":"test"};'),
            ({'url': good}, 'var ZT_PREMIUM_GATE = true;'),
            ({'url': good}, 'var ZT_CONN_LIMIT = true;'),
            ({'url': good}, 'var ZT_APP_GATE = true;'),
        ]
        for config, gate in variants:
            with self.subTest(config=config, gate=gate):
                html = 'var ZT_RENEW = ' + json.dumps(config) + ';' + gate
                result = json.loads(php(f'''
                    $called=false; $rejected=false;
                    try {{playerZicoRenewSources({json.dumps(html)},'https://bp.zicotv.cc/api/player/4',function()use(&$called){{$called=true;return [200,'{{"sources":[]}}'];}});}}
                    catch(RuntimeException $e){{$rejected=true;}}
                    echo json_encode([$called,$rejected]);
                '''))
                self.assertEqual(result, [False, True])
        rejected = json.loads(php(f'''
            $html={json.dumps('var ZT_RENEW = ' + json.dumps({'url':good}) + ';')};
            try {{playerZicoRenewSources($html,'https://bp.zicotv.cc/api/player/4',function(){{return [403,'private upstream body'];}});}}
            catch(RuntimeException $e){{echo json_encode($e->getMessage());}}
        '''))
        self.assertIn('403', rejected)
        self.assertNotIn('private upstream body', rejected)

    def test_expired_root_and_variant_are_refreshed_on_the_same_cdn_without_switching_channels(self):
        code = '''
        $calls=0;
        $lookup=function($page,$token,$force)use(&$calls){$calls++;return ['sources'=>[
            ['url'=>'https://cdn7.zicotv.cc/liga/index.m3u8?token=new-2999999999-'],
            ['url'=>'https://cdn6.zicotv.cc/liga/index.m3u8?token=new-2999999999-']
        ]];};
        $page='https://bp.zicotv.cc/api/player/4'; $allow=function(){return true;};
        $root=playerZicoFreshPlaylist('https://cdn6.zicotv.cc/liga/index.m3u8?token=old-1000000000-',$page,false,$lookup,$allow);
        $variant=playerZicoFreshPlaylist('https://cdn6.zicotv.cc/liga/tracks-v1a1/mono.m3u8?token=old-1000000000-&quality=hd',$page,false,$lookup,$allow);
        $other=playerZicoFreshPlaylist('https://cdn6.zicotv.cc/other/mono.m3u8?token=old-1000000000-',$page,false,$lookup,$allow);
        $alive=playerZicoFreshPlaylist('https://cdn6.zicotv.cc/liga/index.m3u8?token=live-2999999999-',$page,false,$lookup,$allow);
        $foreign=playerZicoFreshPlaylist('https://unrelated.example/video.m3u8','https://other.example/player',true,$lookup,$allow);
        echo json_encode([$root,$variant,$other,$alive,$foreign,$calls,
            playerSourceId($root)===playerSourceId('https://cdn6.zicotv.cc/liga/index.m3u8?token=another')]);
        '''
        root, variant, other, alive, foreign, calls, stable = json.loads(php(code))
        self.assertEqual(root, 'https://cdn6.zicotv.cc/liga/index.m3u8?token=new-2999999999-')
        self.assertIn('token=new-2999999999-', variant)
        self.assertIn('quality=hd', variant)
        self.assertIn('/liga/tracks-v1a1/mono.m3u8', variant)
        self.assertIn('/other/mono.m3u8?token=old-', other)
        self.assertIn('token=live-', alive)
        self.assertEqual(foreign, 'https://unrelated.example/video.m3u8')
        self.assertEqual(calls, 3)
        self.assertTrue(stable)

    def test_private_source_cache_reuses_unlimited_tokens_and_forces_a_new_renewal_when_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            code = f'''
            putenv('CALAMAR_ZICO_CACHE=' . {json.dumps(directory)});
            $getCalls=0;$postCalls=0;
            $get=function($url,$page,$limit=0,$hops=0)use(&$getCalls){{$getCalls++;return [200,
                'var ZT_SOURCES=[]; var ZT_RENEW={{"url":"/api/player/4/renew?expires=1794427569&signature={'a'*64}","ttl":1200}};',
                'https://bp.zicotv.cc/api/player/4'];}};
            $post=function()use(&$postCalls){{$postCalls++;return [200,json_encode(['ttl'=>1200,'sources'=>[
                ['url'=>'https://cdn6.zicotv.cc/liga/index.m3u8?token=fresh-'.$postCalls,'label'=>'CDN 6']]])];}};
            $a=playerZicoCurrent('https://bp.zicotv.cc/api/player/4','private-test-token',false,$get,$post);
            playerZicoRememberSource('https://bp.zicotv.cc/api/player/4','private-test-token',$a['sources'][0]['url']);
            $b=playerZicoCurrent('https://zicotv.cc/api/player/4','private-test-token',false,$get,$post);
            $c=playerZicoCurrent('https://bp.zicotv.cc/api/player/4','private-test-token',true,$get,$post);
            echo json_encode([$getCalls,$postCalls,$a['sources']===$b['sources'],$a['sources']!==$c['sources'],
                strpos(file_get_contents(glob({json.dumps(directory)}.'/*.json')[0]),'private-test-token')===false,
                $b['preferred']===playerSourceId($a['sources'][0]['url']),$c['preferred']===$b['preferred']]);
            '''
            self.assertEqual(json.loads(php(code)), [2, 2, True, True, True, True, True])

    def test_signed_event_proofs_and_catalog_aliases_authorize_renewal_but_removed_channels_do_not(self):
        result = json.loads(php('''
            $event='https://bp.zicotv.cc/events/123';$page='https://bp.zicotv.cc/api/player/4';
            $proof=$page.'?ct_event=123&ct_sig='.playerZicoProof($page,$event,playerSecret());
            $calls=0;$url='https://cdn6.zicotv.cc/liga/index.m3u8?token=old-1000000000-';
            $unchanged=playerZicoFreshPlaylist($url,$page,true,function()use(&$calls){$calls++;return [];},function(){return false;});
            echo json_encode([
                playerZicoCatalogPage($page,['https://zicotv.cc/channels/4'=>true]),
                playerZicoCatalogPage($proof,[$event=>true]),
                playerZicoCatalogPage($proof,[]),
                playerZicoCatalogPage($page,['https://bp.zicotv.cc/channels/5'=>true]),
                $unchanged===$url,$calls
            ]);
        '''))
        self.assertEqual(result, [True, True, False, False, True, 0])

    def test_channel_page_uses_its_player_and_server_token_without_redirecting_to_premium(self):
        code = '''
        $page = "https://bp.zicotv.cc/channels/1?from=calendar";
        $requests = [];
        $get = function($url,$referer,$limit=0,$hops=0) use (&$requests) {
            $requests[] = [$url,$referer]; return [200,"video",$url];
        };
        $premium = playerOpenPage($page,"private-test-token",$get);
        $public = playerOpenPage($page,"",$get);
        $catalog = [$page => true];
        echo json_encode([$requests,$premium,$public,
            playerAllowedPage("https://bp.zicotv.cc/api/player/1",$catalog),
            playerAllowedPage("https://bp.zicotv.cc/channels/1",["https://bp.zicotv.cc/api/player/1"=>true]),
            playerAllowedPage("https://bp.zicotv.cc/api/player/2",$catalog,function(){return [404,""];}),
            playerZicoPage("https://evil.test/channels/1"),
            playerZicoPage("https://u:p@bp.zicotv.cc/channels/1")]);
        '''
        requests, premium, public, allowed, reverse, wrong_id, bad_host, credentials = json.loads(php(code))
        self.assertEqual(requests, [["https://bp.zicotv.cc/api/player/1?token=private-test-token", "https://calamarmenciano.com/"],
                                    ["https://bp.zicotv.cc/api/player/1", ""]])
        self.assertEqual(premium[2], "https://bp.zicotv.cc/api/player/1")
        self.assertNotIn("private-test-token", json.dumps(premium))
        self.assertEqual([allowed, reverse, wrong_id, bad_host, credentials], [True, True, False, '', ''])

    def test_shared_host_without_curl_multi_exec_uses_bounded_safe_fallback(self):
        requests = []
        class Origin(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                requests.append(self.path)
                if self.path.startswith('/silent'): time.sleep(4)
                if self.path.startswith('/redirect'):
                    self.send_response(302); self.send_header('Location', 'https://fast.example/fast.m3u8'); self.end_headers(); return
                body = b'<html>Error</html>' if self.path.startswith('/html') else b'#EXTM3U\n' if self.path.startswith('/empty') else b'#EXTM3U\n#EXTINF:6,\nvideo.ts\n'
                self.send_response(200); self.end_headers()
                try: self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError): pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            factory = '$factory=function($url,$page){return curl_init("http://127.0.0.1:%d".parse_url($url,PHP_URL_PATH));};' % server.server_address[1]
            for disabled in [('curl_multi_exec',), ('curl_multi_init', 'curl_multi_exec')]:
                with self.subTest(disabled=disabled):
                    before = time.monotonic()
                    out = php(factory + 'echo json_encode(playerFirstList(["https://slow.example/silent.m3u8","https://bad.example/html.m3u8","https://empty.example/empty.m3u8","https://redirect.example/redirect.m3u8"], "https://zicotv.cc/api/player/4", $factory));', disabled)
                    status, body, url = json.loads(out)
                    self.assertEqual(status, 200); self.assertIn('#EXTINF:6', body)
                    self.assertEqual(url, 'https://fast.example/fast.m3u8')
                    self.assertLess(time.monotonic() - before, 3.5, 'a silent source must be abandoned after two seconds')
                    self.assertEqual(json.loads(php('echo json_encode(playerFirstList(["https://127.0.0.1/private.m3u8"], "https://zicotv.cc/api/player/4"));', disabled)), [0, None, ''])
            self.assertIn('/fast.m3u8', requests)
        finally:
            server.shutdown(); server.server_close()

    def test_first_valid_hls_wins_without_waiting_for_a_silent_first_source(self):
        requests = []
        class Origin(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                requests.append(self.path)
                if self.path.startswith('/slow'): time.sleep(2)
                if self.path.startswith('/fast'): time.sleep(0.15)
                body = b'<html>Error</html>' if self.path.startswith('/html') else b'#EXTM3U\n' if self.path.startswith('/empty') else b'#EXTM3U\r\n#EXTINF:6,\r\nvideo.ts\r\n'
                self.send_response(200); self.end_headers()
                try: self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError): pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            port = server.server_address[1]
            # Injection is local to this test function; production always validates DNS and pins public IPs.
            factory = '$factory=function($url,$page){$ch=curl_init("http://127.0.0.1:%d".parse_url($url,PHP_URL_PATH));curl_setopt($ch,CURLOPT_TIMEOUT,4);return $ch;};' % port
            before = time.monotonic()
            out = php(factory + 'echo json_encode(playerFirstList(["https://slow.example/slow.m3u8","https://bad.example/html.m3u8","https://empty.example/empty.m3u8","https://fast.example/fast.m3u8"], "https://zicotv.cc/api/player/4", $factory));')
            elapsed = time.monotonic() - before
            status, body, url = json.loads(out)
            self.assertEqual(status, 200); self.assertIn('#EXTINF:6', body)
            self.assertEqual(url, 'https://fast.example/fast.m3u8')
            self.assertLess(elapsed, 1.5, 'must cancel the losing two-second source')
            self.assertEqual(set(requests), {'/slow.m3u8', '/html.m3u8', '/empty.m3u8', '/fast.m3u8'})
            self.assertEqual(json.loads(php('echo json_encode(playerFirstList(["https://127.0.0.1/private.m3u8"], "https://zicotv.cc/api/player/4"));')), [0, None, ''])
        finally:
            server.shutdown(); server.server_close()

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

    def test_premium_is_authorized_for_the_catalog_event_and_credential_stays_on_the_player_host(self):
        data = {'data': {'sources': [
            {'source': 'own', 'name': 'Canal Premium', 'url': 'https://bp.zicotv.cc/api/player/22', 'is_premium': True},
            {'source': 'manual', 'url': 'https://outside.example/api/player/22', 'locked': True},
        ]}}
        code = f'''
        $data = json_decode({json.dumps(json.dumps(data))}, true);
        $event = "https://bp.zicotv.cc/events/98019";
        $catalog = [$event => true];
        $token = "test-token-with+private/chars";
        $sources = playerZicoEventSources($data, $event, $catalog, playerSecret(), $token);
        $page = $sources[0]["player_url"];
        $proof = playerZicoSignedSource($page, $catalog, playerSecret());
        $tampered = playerZicoSignedSource(str_replace("player/22", "player/23", $page), $catalog, playerSecret());
        $other = playerZicoSignedSource($page, [], playerSecret());
        $request = [];
        $result = playerOpenPage($page, $token, function($url,$referer,$limit,$hops) use (&$request) {{
            $request = [$url,$referer,$hops];
            return [200,"body",$url];
        }});
        echo json_encode([$sources,$proof,$tampered,$other,$request,$result,
            playerZicoEventSources($data,$event,$catalog,playerSecret(),"")]);
        '''
        sources, proof, tampered, other, request, result, public = json.loads(php(code))
        self.assertEqual(len(sources), 1)
        self.assertNotIn('token=', sources[0]['player_url'])
        self.assertEqual([proof, tampered, other], [True, False, False])
        self.assertEqual(request, ['https://bp.zicotv.cc/api/player/22?token=test-token-with%2Bprivate%2Fchars',
                                   'https://calamarmenciano.com/', 1])
        self.assertEqual(result, [200, 'body', 'https://bp.zicotv.cc/api/player/22'])
        self.assertEqual(public, [])

    def test_zico_credentials_can_only_be_saved_outside_document_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            public = pathlib.Path(tmp, 'public')
            public.mkdir()
            private_file = pathlib.Path(tmp, 'private.php')
            public_file = public / 'config.php'
            code = f'''
            $_SERVER["DOCUMENT_ROOT"] = {json.dumps(str(public))};
            putenv("CALAMAR_ZICO_CONFIG=" . {json.dumps(str(public_file))});
            $unsafe = playerSaveZicoToken("only-used-in-this-test");
            putenv("CALAMAR_ZICO_CONFIG=" . {json.dumps(str(private_file))});
            $saved = playerSaveZicoToken("only-used-in-this-test");
            echo json_encode([$unsafe,$saved,playerZicoToken(),playerContainsZicoToken("a%6fnly-used-in-this-test","only-used-in-this-test")]);
            '''
            unsafe, saved, token, exposed = json.loads(php(code))
            self.assertEqual([unsafe, saved, token, exposed], [False, True, 'only-used-in-this-test', True])
            self.assertFalse(public_file.exists())
            self.assertEqual(private_file.stat().st_mode & 0o777, 0o600)

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
