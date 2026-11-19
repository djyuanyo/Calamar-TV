import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTER = """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Español, latino",LANGUAGE="es-419",DEFAULT=NO,URI="lat.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Castellano",LANGUAGE="spa",DEFAULT=NO,AUTOSELECT=NO,URI="es.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a",SUBTITLES="s"
video.m3u8
"""


@unittest.skipUnless(shutil.which("php"), "PHP CLI is required")
class CastAudioTest(unittest.TestCase):
    def select(self, language, name=""):
        return subprocess.run(
            ["php", "-r",
             'require "hosting/calamar-cast-audio.php"; echo castAudioManifest(stream_get_contents(STDIN), $argv[1], $argv[2]);',
             "--", language, name],
            cwd=ROOT, input=MASTER, capture_output=True, text=True, check=True
        ).stdout

    def test_castellano_is_preferred_and_the_other_tracks_are_left_alone(self):
        result = self.select("es-ES")
        self.assertNotIn('URI="lat.m3u8"', result)
        self.assertNotIn('URI="en.m3u8"', result)
        self.assertIn('URI="es.m3u8",DEFAULT=YES,AUTOSELECT=YES', result)
        self.assertIn('URI="subs.m3u8"', result)
        self.assertTrue(result.endswith("video.m3u8\n"))

    def test_the_mobile_selection_overrides_generic_spanish(self):
        result = self.select("es", "Español, latino")
        self.assertIn('URI="lat.m3u8",DEFAULT=YES,AUTOSELECT=YES', result)
        self.assertNotIn('URI="es.m3u8"', result)

    def test_unavailable_language_does_not_remove_existing_audio(self):
        self.assertEqual(self.select("ja"), MASTER)
