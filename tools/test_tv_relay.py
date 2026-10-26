"""The IPTV relay joins the provider's repeated connections into one continuous MPEG-TS."""
import json
import pathlib
import shutil
import subprocess
import unittest

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


@unittest.skipUnless(shutil.which('php'), 'Requires PHP CLI')
class TvRelayTest(unittest.TestCase):
    def splice(self, connections, chunk=1000):
        """Tags passed on for each connection, cut into chunks that split packets."""
        program = ('define("CALAMAR_RELAY_TEST_ONLY", true); require ' + json.dumps(str(PHP)) + ';'
                   '$s = null; $out = [];'
                   'foreach (json_decode(file_get_contents("php://stdin"), true) as $c) {'
                   '  $s = tsSpliceNext($s); $data = hex2bin($c); $got = "";'
                   '  foreach (str_split($data, ' + str(chunk) + ') as $piece) $got .= tsSplice($s, $piece);'
                   '  $tags = []; foreach (str_split($got, 188) as $p) $tags[] = ord($p[187]); $out[] = $tags; }'
                   'echo json_encode($out);')
        stdin = json.dumps([b''.join(c).hex() for c in connections])
        return json.loads(subprocess.run(['php', '-r', program], input=stdin, capture_output=True, text=True, check=True).stdout)

    def test_cuts_only_at_keyframes_and_resumes_after_the_last_one_sent(self):
        # Sent: 1-4 (up to the keyframe at 12 s, held until the next keyframe). 5-6 are dropped when the
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

    def test_a_connection_with_nothing_new_passes_nothing(self):
        first = [packet(10, True, 1), packet(20, True, 2), packet(None, True, 3)]
        second = [packet(10, True, 4), packet(15, True, 5)]
        third = [packet(18, True, 6), packet(21, True, 7), packet(22, True, 8)]
        self.assertEqual(self.splice([first, second, third]), [[1, 2], [], [7]])

    def test_a_restarted_channel_clock_resumes_at_once(self):
        first = [packet(5000, True, 1), packet(None, True, 2)]
        second = [packet(None, False, 3), packet(3, True, 4), packet(4, False, 5), packet(None, True, 6)]
        self.assertEqual(self.splice([first, second], chunk=188), [[1], [4, 5]])

    def test_garbage_before_the_first_packet_is_skipped(self):
        data = [b'\x00\x01junk', packet(1, True, 1), packet(2, False, 2), packet(None, True, 3)]
        self.assertEqual(self.splice([data], chunk=77), [[1, 2]])


if __name__ == '__main__':
    unittest.main()
