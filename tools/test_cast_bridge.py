"""Real HEVC -> H.264/AAC HLS and supervisor lifecycle, without provider credentials."""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = ROOT / 'hosting/calamar-cast.php'


@unittest.skipUnless(shutil.which('php') and shutil.which('ffmpeg'), 'Requires PHP CLI and FFmpeg')
class CastBridgeTest(unittest.TestCase):
    def php(self, expression):
        program = 'define("CALAMAR_CAST_TEST_ONLY", true); require ' + json.dumps(str(PHP)) + '; ' + expression
        return subprocess.check_output(['php', '-r', program], text=True)

    def test_public_iptv_sources_and_no_private_hosts(self):
        sources = ['http://31.43.191.125:8080/Test/Pass/123',
                   'http://31.43.191.125:8080/Test/Pass/123.ts',
                   'http://127.0.0.1:8080/Test/Pass/123',
                   'http://31.43.191.125:8080/Test/Pass/123?url=http://localhost',
                   'http://user:pass@31.43.191.125:8080/Test/Pass/123',
                   'http://31.43.191.125:8080/Test/Pass/123#test']
        result = self.php('echo json_encode(array_map("castSourceAllowed", ' + json.dumps(sources) + '));')
        self.assertEqual(json.loads(result), [True, True, False, True, False, False])
        result = self.php('echo json_encode([castSourceAllowed("http://neospaxy.top:8080/Test/Pass/57476"), castSourceAllowed("http://other.example/live/Test/Pass/1.ts?token=A%2Bb")]);')
        self.assertEqual(json.loads(result), [True, True])

    def test_dns_and_redirects_cannot_reach_private_addresses(self):
        result = self.php('echo json_encode(['
            'publicTarget("http://video.example/Test/Pass/1", fn($host) => ["127.0.0.1"]),'
            'publicTarget("http://video.example/Test/Pass/1", fn($host) => ["8.8.8.8", "10.0.0.1"]),'
            'publicTarget("http://video.example/Test/Pass/1", fn($host) => ["8.8.8.8"]),'
            'redirectTarget("http://video.example/live/Test/Pass/1", "file:///etc/passwd")'
            ']);')
        data = json.loads(result)
        self.assertIsNone(data[0])
        self.assertIsNone(data[1])
        self.assertEqual(data[2]['ip'], '8.8.8.8')
        self.assertIsNone(data[3])

    def test_actual_hevc_ts_becomes_h264_aac_hls(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            source = folder / 'input.ts'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
                '-t', '8', '-c:v', 'libx265', '-threads', '1', '-x265-params', 'pools=1:frame-threads=1',
                '-c:a', 'aac', '-f', 'mpegts', str(source)], check=True, stderr=subprocess.DEVNULL, timeout=40)
            args = json.loads(self.php('echo json_encode(castArguments("ffmpeg", "http://31.43.191.125:8080/Test/Pass/123", '
                + json.dumps(directory) + '));'))
            self.assertIn('-tls_verify', args)
            self.assertEqual(args[args.index('-i') + 1], 'https://calamarmenciano.com/calamar-tv-relay.php?stream=1')
            self.assertNotIn('X-Calamar-Worker', args[args.index('-headers') + 1])
            keyed = json.loads(self.php('echo json_encode(castArguments("ffmpeg", "http://31.43.191.125:8080/Test/Pass/123", '
                + json.dumps(directory) + ', "abc123"));'))
            # The hosting's own worker keeps its single connection to the provider open.
            self.assertIn('X-Calamar-Worker: abc123\r\n', keyed[keyed.index('-headers') + 1])
            # Feed a real local HEVC fixture to exactly the production output arguments.
            command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source)] + args[args.index('-i') + 2:]
            subprocess.run(command, check=True, timeout=40)
            playlist = (folder / 'live.m3u8').read_text()
            self.assertGreaterEqual(playlist.count('#EXTINF:'), 3)
            segment = next(folder.glob('seg*.ts'))
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(segment)], text=True))
            self.assertEqual({s['codec_name'] for s in probe['streams']}, {'h264', 'aac'})
            video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
            self.assertLessEqual(video['height'], 720)

    def test_h264_channels_are_only_repackaged_without_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            source = folder / 'input.ts'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
                '-t', '8', '-c:v', 'libx264', '-g', '25', '-c:a', 'aac', '-f', 'mpegts', str(source)],
                check=True, stderr=subprocess.DEVNULL, timeout=40)
            args = json.loads(self.php('echo json_encode(castArguments("ffmpeg", "http://31.43.191.125:8080/Test/Pass/123", '
                + json.dumps(directory) + ', "k", "copy"));'))
            self.assertEqual(args[args.index('-c:v') + 1], 'copy')
            self.assertNotIn('libx264', args)
            command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source)] + args[args.index('-i') + 2:]
            subprocess.run(command, check=True, timeout=40)
            self.assertGreaterEqual((folder / 'live.m3u8').read_text().count('#EXTINF:'), 3)
            segment = next(folder.glob('seg*.ts'))
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(segment)], text=True))
            self.assertEqual({s['codec_name'] for s in probe['streams']}, {'h264', 'aac'})
            self.assertEqual(next(s for s in probe['streams'] if s['codec_type'] == 'video')['height'], 360)
            # The probe reads the channel only to choose; it never writes the stream.
            probe_args = json.loads(self.php('echo json_encode(castArguments("ffmpeg", "http://31.43.191.125:8080/Test/Pass/123", '
                + json.dumps(directory) + ', "k", "probe"));'))
            self.assertEqual(probe_args[-3:], ['-f', 'null', '-'])
            self.assertNotIn('X-Calamar-Worker', probe_args[probe_args.index('-headers') + 1])

    def test_the_worker_repackages_h264_and_converts_the_rest(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            for codec, expected in (('h264', 'copy'), ('hevc', 'encode')):
                (folder / 'heartbeat').touch()
                for name in ('copy', 'encode'): (folder / name).unlink(missing_ok=True)
                script = self.php('echo castWorker("touch encode", ' + json.dumps(directory) + ', "touch copy", '
                    + json.dumps(f"echo 'Stream #0:0: Video: {codec} (Main)'") + ');')
                path = folder / 'worker.sh'; path.write_text(script)
                subprocess.run(['/bin/sh', str(path)], timeout=10)
                self.assertTrue((folder / expected).exists(), codec)
                self.assertFalse((folder / ('encode' if expected == 'copy' else 'copy')).exists(), codec)

    def test_one_worker_per_channel_and_idle_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            (folder / 'heartbeat').touch()
            command = 'sleep 60'
            script = self.php('echo castWorker(' + json.dumps(command) + ', ' + json.dumps(directory) + ');')
            path = folder / 'worker.sh'; path.write_text(script)
            first = subprocess.Popen(['/bin/sh', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(30):
                    if (folder / 'worker.alive').exists(): break
                    time.sleep(.1)
                self.assertTrue((folder / 'worker.alive').exists())
                second = subprocess.run(['/bin/sh', str(path)], timeout=3)
                self.assertEqual(second.returncode, 0)
                self.assertIsNone(first.poll())
                os.utime(folder / 'heartbeat', (time.time() - 100, time.time() - 100))
                first.wait(timeout=12)
                self.assertFalse((folder / 'worker.alive').exists())
                self.assertFalse(path.exists(), 'Worker script containing private source headers must be removed')
            finally:
                if first.poll() is None: first.terminate(); first.wait(timeout=8)


if __name__ == '__main__':
    unittest.main()