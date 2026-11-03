import json
from pathlib import Path
import shutil
import subprocess
import unittest


BRIDGE = Path(__file__).resolve().parents[1] / "hosting" / "calamar-vidara.php"
PHP = shutil.which("php")
MOCK_CURL = r"""
$fixture = json_decode(stream_get_contents(STDIN), true);
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = ['action' => 'videos', 'key' => 'test-only-key', 'id' => '5', 'page' => $fixture['page']];
foreach (['CONNECTTIMEOUT', 'TIMEOUT', 'FOLLOWLOCATION', 'HTTPHEADER', 'WRITEFUNCTION', 'CURLINFO_RESPONSE_CODE'] as $i => $option) {
    define($option === 'CURLINFO_RESPONSE_CODE' ? $option : 'CURLOPT_' . $option, $i);
}
function curl_init($url) {
    $GLOBALS['upstream'] = $url;
    return 1;
}
function curl_setopt_array($handle, $options) {
    $GLOBALS['write'] = $options[CURLOPT_WRITEFUNCTION];
}
function curl_exec($handle) {
    global $fixture, $write;
    if ($fixture['curl_error']) return false;
    $write($handle, json_encode($fixture['body']));
    return true;
}
function curl_errno($handle) { return $GLOBALS['fixture']['curl_error']; }
function curl_getinfo($handle, $info) { return $GLOBALS['fixture']['http']; }
function curl_close($handle) {}
register_shutdown_function(function () {
    parse_str(parse_url($GLOBALS['upstream'], PHP_URL_QUERY), $query);
    fwrite(STDERR, json_encode(['http' => http_response_code(), 'query' => $query]));
});
require $argv[1];
"""


@unittest.skipUnless(PHP, "PHP CLI not installed")
class VidaraBridgeTests(unittest.TestCase):
    def run_bridge(self, body, http=200, page="1", curl_error=0):
        result = subprocess.run(
            [PHP, "-n", "-r", MOCK_CURL, str(BRIDGE)],
            input=json.dumps(dict(body=body, http=http, page=page, curl_error=curl_error)),
            capture_output=True, text=True, check=True, timeout=5,
        )
        metadata = json.loads(result.stderr)
        self.assertEqual(metadata["query"]["fld_id"], "5")
        self.assertNotIn("status", metadata["query"])
        self.assertNotIn("test-only-key", result.stdout)
        return metadata["http"], json.loads(result.stdout)

    def test_explicit_empty_first_pages_are_normalized(self):
        cases = [
            (200, {"status": 200, "result": {"results": 0, "videos": None}}),
            (404, {"status": 404, "msg": "No videos found in this folder."}),
        ]
        for upstream, body in cases:
            with self.subTest(upstream=upstream):
                http, response = self.run_bridge(body, http=upstream)
                self.assertEqual(http, 200)
                self.assertEqual(response, {
                    "bridge": 3, "complete_inventory": True, "videos": [],
                    "page": 1, "total_pages": 0, "total": 0,
                })

    def test_unknown_errors_and_missing_later_pages_are_not_reported_as_empty(self):
        http, response = self.run_bridge({"status": 404, "msg": "No videos found"}, http=404, page="2")
        self.assertEqual(http, 502)
        self.assertEqual(response["error"], "vidara_upstream")
        self.assertEqual(response["upstream_http"], 404)
        http, response = self.run_bridge({"status": 200, "result": {"total": 2, "videos": None}})
        self.assertEqual(http, 502)
        self.assertEqual(response["error"], "vidara_response")
        http, response = self.run_bridge(None, http=0, curl_error=28)
        self.assertEqual(http, 502)
        self.assertEqual(response["error"], "vidara_transport")
        self.assertEqual(response["curl_error"], 28)
