"""Drive imports expose only video links; their API key is authenticated and encrypted."""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = str(ROOT / 'hosting/calamar-drive.php')
SECRET = 'ab' * 32


def php(code):
    return subprocess.check_output(['php', '-r', f'require {json.dumps(PHP)}; {code}'], text=True,
                                   env={**os.environ, 'CALAMAR_DRIVE_SECRET': SECRET})


class DriveRelayTest(unittest.TestCase):
    def test_public_download_has_the_same_id_and_resource_key_without_api_credentials(self):
        url = php('echo drivePublicDownload(["id"=>"episode123","resourceKey"=>"r_key","key"=>"PRIVATE_GOOGLE_KEY"]);')
        self.assertEqual(url, 'https://drive.usercontent.google.com/download?id=episode123&export=download&confirm=t&resourcekey=r_key')
        self.assertNotIn('PRIVATE_GOOGLE_KEY', url)

    def test_encrypted_link_survives_reload_and_rejects_tampering(self):
        result = json.loads(php('$secret=hex2bin("' + SECRET + '"); $file=["id"=>"movie123","mimeType"=>"video/mp4","resourceKey"=>"r_key"];'
            '$token=driveToken($file,"AIza_TEST_KEY",$secret); $bad=$token; $bad[10]=$bad[10]==="A"?"B":"A";'
            'echo json_encode([$token,driveOpen($token,$secret),driveOpen($bad,$secret),driveOpen($token,random_bytes(32))]);'))
        token, data, bad, other = result
        self.assertNotIn('AIza_TEST_KEY', token)
        self.assertEqual(data, {'id': 'movie123', 'key': 'AIza_TEST_KEY', 'resourceKey': 'r_key', 'mime': 'video/mp4'})
        self.assertIsNone(bad)
        self.assertIsNone(other)

    def test_menu_contains_only_downloadable_videos_and_folders(self):
        data = {'files': [
            {'id': 'folder', 'name': 'Temporada 1', 'mimeType': 'application/vnd.google-apps.folder'},
            {'id': 'video', 'name': '1x01.mp4', 'mimeType': 'video/mp4', 'capabilities': {'canDownload': True}, 'createdTime': '2026-10-29T01:00:00Z'},
            {'id': 'denied', 'name': '1x02.mp4', 'mimeType': 'video/mp4', 'capabilities': {'canDownload': False}},
            {'id': 'text', 'name': 'README.txt', 'mimeType': 'text/plain'},
            {'id': '../invalid', 'name': 'Bad', 'mimeType': 'video/mp4', 'capabilities': {'canDownload': True}},
        ], 'nextPageToken': 'next'}
        menu = json.loads(php(f'$data=json_decode({json.dumps(json.dumps(data))},true); echo json_encode(driveMenu($data,"Serie","PRIVATE_GOOGLE_KEY",hex2bin("{SECRET}")));'))
        self.assertEqual(len(menu['files']), 1)
        self.assertEqual(menu['folders'][0]['id'], 'folder')
        self.assertEqual(menu['nextPageToken'], 'next')
        self.assertEqual(menu['files'][0]['uploaded'], '2026-10-29')
        self.assertTrue(menu['files'][0]['link'].startswith('https://calamarmenciano.com/calamar-drive.php?id=video&v='))
        self.assertNotIn('PRIVATE_GOOGLE_KEY', json.dumps(menu))

    def test_only_google_https_destinations_and_single_byte_ranges(self):
        result = json.loads(php('echo json_encode(['
            'array_map("driveAllowedUrl",["https://www.googleapis.com/drive/v3/files/id?alt=media","https://abc.googleusercontent.com/video",'
            '"https://drive.usercontent.google.com/download","https://googleusercontent.com.evil.org/a","http://www.googleapis.com/a",'
            '"https://www.googleapis.com@127.0.0.1/a","https://www.googleapis.com:444/a","https://127.0.0.1/a"]),'
            'array_map("driveRange",["","bytes=0-","bytes=100-200","bytes=-100","bytes=0-1,4-6","bytes=-","bytes=0-1\\r\\nOther: x"])]);'))
        self.assertEqual(result[0], [True, True, True, False, False, False, False, False])
        self.assertEqual(result[1], [True, True, True, True, False, False, False])

    def test_vps_ffmpeg_input_is_loopback_and_public_playlist_origin_is_https(self):
        legacy, vps, origin = json.loads(php(
            'putenv("CALAMAR_DRIVE_VPS"); $legacy=driveCompatInput(DRIVE_COMPAT_ORIGIN);'
            'putenv("CALAMAR_DRIVE_VPS=1");'
            'echo json_encode([$legacy,driveCompatInput(DRIVE_VPS_INPUT),DRIVE_VPS_ORIGIN]);'))
        self.assertEqual(legacy[-2:], ['-i', 'https://calamarmenciano.com/calamar-drive.php'])
        self.assertIn('-tls_verify', legacy)
        self.assertEqual(vps[:2], ['-protocol_whitelist', 'http,tcp'])
        self.assertNotIn('-tls_verify', vps)
        self.assertEqual(vps[-2:], ['-i', 'http://127.0.0.1:8091/calamar-drive.php'])
        self.assertEqual(origin, 'https://video.calamarmenciano.com/calamar-drive.php')

    def test_service_account_assertion_is_signed_and_read_only(self):
        result = json.loads(php(
            '$key=openssl_pkey_new(["private_key_bits"=>2048]); openssl_pkey_export($key,$pem);'
            '$account=["client_email"=>"calamar@example.iam.gserviceaccount.com","private_key"=>$pem];'
            '$parts=explode(".",driveServiceJwt($account,2000));'
            '$decode=fn($value)=>base64_decode(strtr($value,"-_","+/"));'
            '$valid=openssl_verify($parts[0].".".$parts[1],$decode($parts[2]),'
            'openssl_pkey_get_details($key)["key"],OPENSSL_ALGO_SHA256);'
            'echo json_encode([$valid,json_decode($decode($parts[1]),true)]);'))
        valid, claims = result
        self.assertEqual(valid, 1)
        self.assertEqual(claims, {
            'iss': 'calamar@example.iam.gserviceaccount.com',
            'scope': 'https://www.googleapis.com/auth/drive.readonly',
            'aud': 'https://oauth2.googleapis.com/token',
            'iat': 1970, 'exp': 5300,
        })

    def test_service_account_limits_access_to_selected_files_and_folder_descendants(self):
        result = json.loads(php(
            '$config=["calamar_files"=>["one"],"calamar_folders"=>["series"]];'
            '$entries=["episode"=>["parents"=>["season"]],"season"=>["parents"=>["series"]],'
            '"other"=>["parents"=>["home"]],"deleted"=>["parents"=>["series"],"trashed"=>true],'
            '"loop"=>["parents"=>["loop"]]];'
            '$lookup=fn($id)=>$entries[$id]??null;'
            'echo json_encode(array_map(fn($id)=>driveServiceAllows($id,$config,$lookup),'
            '["one","episode","other","deleted","loop","unknown","series"]));'))
        self.assertEqual(result, [True, True, False, False, False, False, False])

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'requires FFmpeg')
    def test_converts_a_seeked_mkv_segment_to_h264_aac_with_spanish_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            original = str(pathlib.Path(directory) / 'original.mkv')
            target = str(pathlib.Path(directory) / 'part.ts')
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
                            '-f', 'lavfi', '-i', 'sine=frequency=450', '-f', 'lavfi', '-i', 'sine=frequency=1000',
                            '-map', '0:v', '-map', '1:a', '-map', '2:a', '-metadata:s:a:1', 'language=spa',
                            '-t', '11', '-c:v', 'mpeg4', '-c:a', 'ac3', original], check=True)
            result = json.loads(php(
                f'$input=["-i",{json.dumps(original)}]; $output=[]; driveCompatExec($input,$output);'
                '$info=driveCompatMetadata(implode("\\n",$output)); $logs=[];'
                f'$args=driveCompatSegmentArguments($input,8,2,$info["audio"],{json.dumps(target)});'
                '$ok=driveCompatExec($args,$logs); echo json_encode([$info,$ok,$logs]);'))
            self.assertEqual(result[0]['audio'], '0:2')
            self.assertGreater(result[0]['duration'], 10)
            self.assertTrue(result[1], result[2])
            video = json.loads(subprocess.check_output(
                ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', target], text=True))
            self.assertEqual([s['codec_name'] for s in video['streams']], ['h264', 'aac'])
            self.assertAlmostEqual(float(video['format']['duration']), 2, delta=.15)

    def test_http_rejects_unsigned_video_and_allows_cast_preflight(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        process = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', str(ROOT / 'hosting')],
            env={**os.environ, 'CALAMAR_DRIVE_SECRET': SECRET}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1): break
                except OSError: time.sleep(.05)
            url = f'http://127.0.0.1:{port}/calamar-drive.php?id=video&v=invalid'
            for source in (url, url + '&hls=1', url + '&hls=1&seg=0'):
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(source)
                self.assertEqual(raised.exception.code, 403)
            req = urllib.request.Request(url, method='OPTIONS', headers={'Origin': 'https://receiver.example', 'Access-Control-Request-Headers': 'range'})
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
            req = urllib.request.Request(url, data=b'id=x&key=invalid', headers={'Origin': 'https://evil.example'})
            with self.assertRaises(urllib.error.HTTPError) as raised:
                urllib.request.urlopen(req)
            self.assertEqual(raised.exception.code, 403)
        finally:
            process.terminate(); process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
