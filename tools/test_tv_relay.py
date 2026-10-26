"""The IPTV relay joins the provider's repeated connections into one continuous MPEG-TS."""
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = ROOT / 'hosting/calamar-tv-relay.php'


def packet(pcr=None, key=False, tag=0):
    """A 188-byte TS packet on PID 256; tag marks it so the test can tell packets apart."""
    head = bytes([0x47, 0x01, 0x00, 0x30])
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
                   '$s = ["pcr" => null]; $out = [];'
                   'foreach (json_decode(file_get_contents("php://stdin"), true) as $c) {'
                   '  $s["skip"] = $s["pcr"] !== null; $s["ahead"] = false; $s["carry"] = ""; $data = hex2bin($c); $got = "";'
                   '  foreach (str_split($data, ' + str(chunk) + ') as $piece) $got .= tsSplice($s, $piece);'
                   '  $tags = []; foreach (str_split($got, 188) as $p) $tags[] = ord($p[187]); $out[] = $tags; }'
                   'echo json_encode($out);')
        stdin = json.dumps([b''.join(c).hex() for c in connections])
        return json.loads(subprocess.run(['php', '-r', program], input=stdin, capture_output=True, text=True, check=True).stdout)

    def test_a_repeated_window_resumes_after_the_last_moment_sent(self):
        first = [packet(10, True, 1), packet(None, False, 2), packet(11, False, 3), packet(12, True, 4)]
        # The next connection starts again at 10 s: only what comes after 12 s, from a keyframe.
        second = [packet(10, True, 5), packet(11, False, 6), packet(12, True, 7), packet(12.5, False, 8),
                  packet(None, False, 9), packet(13, True, 10), packet(None, False, 11), packet(14, False, 12)]
        self.assertEqual(self.splice([first, second]), [[1, 2, 3, 4], [10, 11, 12]])

    def test_a_connection_with_nothing_new_passes_nothing(self):
        first = [packet(10, True, 1), packet(20, True, 2)]
        second = [packet(10, True, 3), packet(15, True, 4)]
        third = [packet(18, True, 5), packet(21, True, 6)]
        self.assertEqual(self.splice([first, second, third]), [[1, 2], [], [6]])

    def test_a_restarted_channel_clock_resumes_at_once(self):
        first = [packet(5000, True, 1)]
        second = [packet(None, False, 2), packet(3, True, 3), packet(4, False, 4)]
        self.assertEqual(self.splice([first, second], chunk=188), [[1], [3, 4]])

    def test_garbage_before_the_first_packet_is_skipped(self):
        data = [b'\x00\x01junk', packet(1, True, 1), packet(2, False, 2)]
        self.assertEqual(self.splice([data], chunk=77), [[1, 2]])


if __name__ == '__main__':
    unittest.main()
