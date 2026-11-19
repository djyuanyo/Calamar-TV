import json
from pathlib import Path
import shutil
import subprocess
import unittest


BRIDGE = Path(__file__).resolve().parents[1] / "hosting" / "calamar-vidara.php"
PHP = shutil.which("php")
MOCK_CURL = r"""
$fixture = json_decode(stream_get_contents(STDIN), true);
$_SERVER['REQUEST_METHOD'] = $fixture['method'] ?? 'POST';
$_GET = $fixture['query'] ?? [];
$_POST = ['action' => 'videos', 'key' => 'test-only-key', 'id' => '5', 'page' => $fixture['page']];
foreach (['CONNECTTIMEOUT', 'TIMEOUT', 'FOLLOWLOCATION', 'HTTPHEADER', 'WRITEFUNCTION',
          'POST', 'POSTFIELDS', 'REFERER', 'CURLINFO_RESPONSE_CODE'] as $i => $option) {
    define($option === 'CURLINFO_RESPONSE_CODE' ? $option : 'CURLOPT_' . $option, $i);
}
function curl_init($url) {
    $GLOBALS['upstream'] = $url;
    return 1;
}
function curl_setopt_array($handle, $options) {
    $GLOBALS['write'] = $options[CURLOPT_WRITEFUNCTION];
    $GLOBALS['post_body'] = $options[CURLOPT_POSTFIELDS] ?? null;
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
    parse_str(parse_url($GLOBALS['upstream'] ?? '', PHP_URL_QUERY) ?? '', $query);
    fwrite(STDERR, json_encode(['http' => http_response_code(), 'query' => $query,
        'upstream' => parse_url($GLOBALS['upstream'] ?? '', PHP_URL_PATH), 'post' => $GLOBALS['post_body'] ?? null]));
});
require $argv[1];
"""


@unittest.skipUnless(PHP, "PHP CLI not installed")
class VidaraBridgeTests(unittest.TestCase):
    def call_bridge(self, body, http=200, page="1", curl_error=0, **fields):
        result = subprocess.run(
            [PHP, "-n", "-r", MOCK_CURL, str(BRIDGE)],
            input=json.dumps(dict(body=body, http=http, page=page, curl_error=curl_error, **fields)),
            capture_output=True, text=True, check=True, timeout=5,
        )
        return json.loads(result.stderr), result.stdout

    def run_bridge(self, body, http=200, page="1", curl_error=0):
        metadata, stdout = self.call_bridge(body, http, page, curl_error)
        self.assertEqual(metadata["query"]["fld_id"], "5")
        self.assertNotIn("status", metadata["query"])
        self.assertNotIn("test-only-key", stdout)
        return metadata["http"], json.loads(stdout)

    def test_playback_uses_vidara_hls_and_never_returns_ads_or_non_media(self):
        query = {"hls": "1", "code": "TestVidara123"}
        media = {"filecode": query["code"], "streaming_url": "https://s1.vidara.so/hls/master.m3u8?token=one",
                 "vast_ads": "https://ads.example.com/vast"}
        metadata, stdout = self.call_bridge(media, method="GET", query=query)
        self.assertEqual(metadata["http"], 302)
        self.assertEqual(metadata["upstream"], "/api/stream")
        self.assertEqual(json.loads(metadata["post"]), {"filecode": query["code"], "device": "web", "codecs": []})
        self.assertEqual(stdout, "")
        for url in ("https://ads.example.com/player.html", "http://s1.vidara.so/hls/master.m3u8",
                    "https://127.0.0.1/index.m3u8", "https://media.internal/index.m3u8", "https://me@cdn.com/index.m3u8"):
            metadata, stdout = self.call_bridge(dict(media, streaming_url=url), method="GET", query=query)
            self.assertEqual(metadata["http"], 502)
            self.assertEqual(json.loads(stdout)["error"], "vidara_playback")

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
                    "bridge": 4, "complete_inventory": True, "videos": [],
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
