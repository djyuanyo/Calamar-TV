"""MadPlay's public event protocol, private renewal cache and redirected HLS fragments."""
import base64
import hashlib
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import unittest
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parents[1]
PLAYER = ROOT / 'hosting/calamar-player.php'
PAGE = 'https://jack09eo.mpaver6fuiwild.my/es/baseball/world-cup-u23-2267587/puerto-rico-u23-vs-chinese-taipei-u23.html?icg=RVM&ilang=es'
MEDIA = 'https://cdn.primary.test/cfall/s2001/v3b/fingerprint/hedy/sx_940790/index.m3u8'
HTML = '<script>window.__NUXT__=(function(a,b,c){return{state:{c$config:{CF_DA_API:a,CF_DA_API_EU:b},cDigit:c}};}(' + ','.join(map(json.dumps, ['https://apis-data10.tcpwe138stya.ru', 'https://apis-data-defra10.tcpwe138stya.ru', 'seth'])) + '));</script>'


def literal(value):
    return "base64_decode('" + base64.b64encode(value.encode()).decode() + "')"


def php(code, cache):
    return subprocess.check_output(['php', '-r', f'require {json.dumps(str(PLAYER))}; {code}'],
                                   env={**os.environ, 'CALAMAR_MADPLAY_CACHE': str(cache)}, text=True)


def vint(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(number, value):
    if isinstance(value, int):
        return vint(number << 3) + vint(value)
    if isinstance(value, str):
        value = value.encode()
    return vint(number << 3 | 2) + vint(len(value)) + value


def wrapped(data):
    return field(2, 0) + field(10, data)


def rot47(value):
    return ''.join(chr(33 + (ord(c) - 33 + 47) % 94) if 33 <= ord(c) <= 126 else c for c in value)


class MadplayPlayerTest(unittest.TestCase):
    def test_only_known_event_pages_are_accepted(self):
        rejected = [PAGE.replace('https:', 'http:'), PAGE.replace('mpaver6fuiwild.my', 'mpaver6fuiwild.my.evil.test'),
                    PAGE.replace('jack09eo.', 'user:secret@jack09eo.'), PAGE.replace('.my/', '.my:8443/'),
                    PAGE.replace('/es/baseball/', '/es/unknown/'), PAGE + '#x', 'https://mpaver6fuiwild.my/admin']
        with tempfile.TemporaryDirectory() as cache:
            out = php(f'echo json_encode([playerMadplayPage({literal(PAGE)}),array_map("playerMadplayPage",json_decode({literal(json.dumps(rejected))},true))]);', cache)
        event, invalid = json.loads(out)
        self.assertEqual(event, {'match': 2267587, 'sport': 4, 'origin': 'https://jack09eo.mpaver6fuiwild.my'})
        self.assertEqual(invalid, [None] * len(rejected))

    def test_nuxt_configuration_is_parsed_without_executing_page_code(self):
        malicious = HTML.replace('return{', 'window.location="https://evil.test";return{')
        with tempfile.TemporaryDirectory() as cache:
            result = json.loads(php(f'echo json_encode(playerMadplayConfig({literal(malicious)}));', cache))
        self.assertEqual(result['cDigit'], 'seth')
        self.assertEqual(result['CF_DA_API_EU'], 'https://apis-data-defra10.tcpwe138stya.ru')

    def test_broken_proto_and_provider_verification_are_rejected(self):
        cases = [b'\x12\x09x', b'\x00', b'\x0f', b'\x08' + b'\xff' * 11, b'\x08\x01' * 8193]
        code = '$answer=[];'
        for case in cases:
            encoded = base64.b64encode(case).decode()
            code += f'try{{playerMadplayPb(base64_decode("{encoded}"));$answer[]=false;}}catch(RuntimeException $e){{$answer[]=true;}}'
        code += 'try{playerMadplayPayload("<html>Just a moment challenge-platform</html>");$answer[]=false;}catch(RuntimeException $e){$answer[]=true;}echo json_encode($answer);'
        with tempfile.TemporaryDirectory() as cache:
            self.assertEqual(json.loads(php(code, cache)), [True] * 6)

    def test_region_grant_metadata_and_source_session_are_cached_privately(self):
        descriptor = field(1, 940790) + field(3, 'DZ PT') + field(5, 1) + field(9, 2001)
        detail = descriptor + field(4, rot47('12345678' + MEDIA)) + field(12, rot47('12345678https://cdn.backup.test'))
        common = rot47(json.dumps({'common:web:client': json.dumps({'seth': {'iframePlayerDomains': ['player.provider.test']}})}))
        grant = 'a' * 32
        fixtures = {'html': HTML, 'params': common,
                    'bs': base64.b64encode(wrapped(field(1, field(1, 102) + field(2, grant)))).decode(),
                    'match': base64.b64encode(wrapped(field(2, descriptor))).decode(),
                    'stream': base64.b64encode(wrapped(field(2, detail))).decode()}
        params = {'matchId': 2267587, 'sportType': 4, 'language': 4, 'stream': True}
        prefix = '/sfver' + hashlib.md5(json.dumps(params, separators=(',', ':')).encode()).hexdigest()[:6] + grant
        code = f'''
        $fixtures=json_decode({literal(json.dumps(fixtures))},true); $calls=[];
        $request=function($url,$page,$limit=1048576)use(&$calls,$fixtures){{
            $path=parse_url($url,PHP_URL_PATH); parse_str(parse_url($url,PHP_URL_QUERY)??'',$query);
            $calls[]=[$path,$query,$page];
            if(strpos($path,'.html')!==false)return[200,$fixtures['html'],$url,[]];
            if($path==='/api-cf/user/info')return[204,'',$url,['ruserinfo'=>'EU|ES|192.0.2.1']];
            if($path==='/api/common/params')return[200,$fixtures['params'],$url,[]];
            if($path==='/api/common/bs')return[200,base64_decode($fixtures['bs']),$url,[]];
            if(str_ends_with($path,'/api/match/detail'))return[200,base64_decode($fixtures['match']),$url,[]];
            if($path==='/api/stream/detail')return[200,base64_decode($fixtures['stream']),$url,['rb-session'=>'issued-session-'.count($calls)]];
            throw new RuntimeException('Unexpected test request');
        }};
        $first=playerMadplayCurrent({literal(PAGE)},false,$request);
        $second=playerMadplayCurrent({literal(PAGE)},false,$request); $initial=count($calls);
        $fresh=playerMadplayCurrent({literal(PAGE)},true,$request);
        $file=playerMadplayCacheFile({literal(PAGE)});
        echo json_encode([$calls,$initial,$first===$second,$first,$fresh,substr(sprintf('%o',fileperms($file)),-3),playerMadplayReferrer({literal(PAGE)}),playerSourceId($first['sources'][0]['url'])===playerSourceId($fresh['sources'][0]['url'])]);
        '''
        with tempfile.TemporaryDirectory() as cache:
            calls, count, reused, first, fresh, permissions, referrer, stable = json.loads(php(code, cache))
        self.assertEqual(count, 6)
        self.assertEqual(len(calls), 12)
        self.assertTrue(reused)
        self.assertEqual(calls[3][1]['code'], '102')
        self.assertEqual(calls[4][0], prefix + '/api/match/detail')
        self.assertEqual(calls[5][1]['country'], 'ES')
        self.assertEqual(calls[5][1]['continent'], 'EU')
        self.assertEqual(calls[5][2], 'https://player.provider.test/')
        self.assertEqual(len(first['sources']), 2)
        self.assertNotEqual(first['sources'][0]['url'], fresh['sources'][0]['url'])
        self.assertTrue(stable)
        self.assertEqual(permissions, '600')
        self.assertEqual(referrer, 'https://player.provider.test/')
        self.assertNotIn('192.0.2.1', json.dumps(first))
        self.assertNotIn('issued-session', json.dumps(first))

    def test_renewal_preserves_source_and_refuses_removed_catalog_pages(self):
        code = f'''
        $page={literal(PAGE)}; $raw={literal(MEDIA)};
        $old=playerMadplaySigned($raw,'old');$new=playerMadplaySigned($raw,'fresh');
        $segment=preg_replace('#index\\.m3u8$#','12345.json',$old);$calls=[];
        $lookup=function($page,$force)use($new,&$calls){{$calls[]=$force;return['sources'=>[['url'=>$new]]];}};
        $refused=playerMadplayFreshMedia($segment,$page,true,$lookup,function(){{return false;}});
        $before=count($calls);
        $mapped=playerMadplayFreshMedia($segment,$page,true,$lookup,function(){{return true;}});
        echo json_encode([$refused===$segment,$before,$calls,$mapped===preg_replace('#index\\.m3u8$#','12345.json',$new)]);
        '''
        with tempfile.TemporaryDirectory() as cache:
            self.assertEqual(json.loads(php(code, cache)), [True, 0, [False], True])

    def test_redirected_fragment_is_streamed_and_error_html_is_rejected(self):
        video = bytes([0x47]) + bytes(187)
        video *= 4
        requests = []

        class Origin(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get('Range')))
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', 'https://segments.provider.test/fragment.json')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                body = b'<html>Site Unavailable</html>' if self.path == '/html' else video
                self.send_response(200)
                self.send_header('Content-Type', 'text/html' if self.path == '/html' else 'application/octet-stream')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            factory = f'''function($url,$page,$timeout,$headers){{
                $path=str_contains($url,'segments.provider.test')?'/fragment.json':'/redirect';
                $ch=curl_init({json.dumps(base)}.$path);curl_setopt_array($ch,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_TIMEOUT=>3,CURLOPT_HTTPHEADER=>$headers]);return $ch;
            }}'''
            with tempfile.TemporaryDirectory() as cache:
                code = f'''$_SERVER['HTTP_RANGE']='bytes=0-187';playerMadplayStream({literal(MEDIA)},{literal(PAGE)},{factory});'''
                received = subprocess.check_output(['php', '-r', f'require {json.dumps(str(PLAYER))};{code}'], env={**os.environ, 'CALAMAR_MADPLAY_CACHE': cache})
                error_factory = f'''function(){{$ch=curl_init({json.dumps(base + '/html')});return $ch;}}'''
                error = json.loads(php(f'playerMadplayStream({literal(MEDIA)},{literal(PAGE)},{error_factory});', cache))
            self.assertEqual(received, video)
            self.assertEqual(requests[:2], [('/redirect', 'bytes=0-187'), ('/fragment.json', 'bytes=0-187')])
            self.assertIn('página de error', error['error'])
            self.assertNotIn('Site Unavailable', error['error'])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
