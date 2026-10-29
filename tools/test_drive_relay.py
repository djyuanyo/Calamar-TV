"""Drive imports expose only video links; their API key is authenticated and encrypted."""
import json
import os
import pathlib
import socket
import subprocess
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
            with self.assertRaises(urllib.error.HTTPError) as raised:
                urllib.request.urlopen(url)
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
