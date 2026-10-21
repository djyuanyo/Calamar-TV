"""Real conversion of a hosted MKV (H.264 + AC3 5.1) into HLS with AAC stereo, and source limits."""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('php') and shutil.which('ffmpeg') and shutil.which('ffprobe') and shutil.which('flock'), 'Requires PHP CLI, FFmpeg and flock')
class VideoBridgeTest(unittest.TestCase):
    def setUp(self):
        self.site = pathlib.Path(tempfile.mkdtemp())
        for name in ('calamar-video.php', 'calamar-cast.php', 'calamar-http-source.php'):
            shutil.copy(ROOT / 'hosting' / name, self.site / name)
        folder = self.site / 'MENCIA MEDIA' / 'SERIES' / 'Prueba (Temporada 1)'
        folder.mkdir(parents=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi',
                        '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264',
                        '-preset', 'ultrafast', '-g', '50', '-c:a', 'ac3', '-ac', '6', str(folder / 'Capitulo [AC3 5.1].mkv')], check=True)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        self.server = subprocess.Popen(['php', '-S', f'127.0.0.1:{self.port}', '-t', str(self.site)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.8)

    def tearDown(self):
        self.server.terminate()
        self.server.wait()
        shutil.rmtree(self.site, ignore_errors=True)

    def get(self, query):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{self.port}/calamar-video.php?{query}', timeout=20) as answer:
                return answer.status, answer.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def start(self, source):
        return self.get('action=start&src=' + urllib.parse.quote(source, safe=''))

    def test_converts_audio_to_aac_and_keeps_h264(self):
        source = 'https://calamarmenciano.com/MENCIA%20MEDIA/SERIES/Prueba%20(Temporada%201)/Capitulo%20%5BAC3%205.1%5D.mkv'
        for _ in range(30):
            status, body = self.start(source)
            data = json.loads(body)
            if data.get('state') == 'complete':
                break
            time.sleep(1)
        self.assertEqual(data['state'], 'complete')
        session = urllib.parse.parse_qs(urllib.parse.urlparse(data['url']).query)['session'][0]
        status, playlist = self.get(f'action=media&session={session}&file=index.m3u8')
        self.assertEqual(status, 200)
        self.assertIn(b'#EXT-X-ENDLIST', playlist)
        self.assertIn(f'https://calamarmenciano.com/calamar-video.php?action=media&session={session}&file=seg0.ts'.encode(), playlist)
        status, segment = self.get(f'action=media&session={session}&file=seg0.ts')
        self.assertEqual(status, 200)
        streams = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,channels', '-of', 'json', '-'], input=segment)
        codecs = {s['codec_name']: s.get('channels') for s in json.loads(streams)['streams']}
        self.assertEqual(codecs, {'h264': None, 'aac': 2})
        # Kept for good next to the page, closed to direct access, until the original changes.
        cache = self.site / 'calamar-video-cache'
        self.assertTrue((cache / session / 'seg0.ts').exists())
        self.assertIn('Require all denied', (cache / '.htaccess').read_text())
        original = self.site / 'MENCIA MEDIA' / 'SERIES' / 'Prueba (Temporada 1)' / 'Capitulo [AC3 5.1].mkv'
        stamp = original.stat().st_mtime + 60
        os.utime(original, (stamp, stamp))
        status, body = self.start(source)
        self.assertFalse((cache / session).exists())
        replaced = urllib.parse.parse_qs(urllib.parse.urlparse(json.loads(body)['url'] or 'x?session=').query).get('session', [''])[0]
        self.assertNotEqual(replaced, session)

    def test_only_video_files_of_this_site(self):
        for source in ('https://example.com/a.mkv', 'http://calamarmenciano.com/MENCIA%20MEDIA/x.mkv',
                       'https://calamarmenciano.com/calamar-video.php', 'https://calamarmenciano.com/..%2F..%2Fetc%2Fpasswd.mkv',
                       'https://calamarmenciano.com/MENCIA%20MEDIA/no-existe.mkv'):
            status, body = self.start(source)
            self.assertEqual(status, 400, source)
        self.assertEqual(self.get('action=media&session=../x&file=index.m3u8')[0], 404)
        self.assertEqual(self.get(f'action=media&session={"a" * 64}&file=../../secret')[0], 404)


if __name__ == '__main__':
    unittest.main()
