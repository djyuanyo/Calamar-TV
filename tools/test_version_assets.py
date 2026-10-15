import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("version_assets.py")

INDEX = """<link rel="stylesheet" href="styles.css" />
<link rel="icon" href="data:image/svg+xml,x" />
<a href="#/canales">Canales</a>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<script type="module" src="app.js"></script>
"""
APP = """import { merge } from './catalog.js';
import { initControls } from './player-controls.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
const admin = await import('./admin.js');
"""


class VersionAssetsTest(unittest.TestCase):
    def build(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        site = pathlib.Path(folder.name)
        (site / "index.html").write_text(INDEX, encoding="utf-8")
        (site / "app.js").write_text(APP, encoding="utf-8")
        return site

    def run_script(self, site, version="abc123"):
        return subprocess.run([sys.executable, str(SCRIPT), str(site), version], capture_output=True, text=True)

    def test_local_files_and_imports_get_the_version(self):
        site = self.build()
        result = self.run_script(site)
        self.assertEqual(result.returncode, 0, result.stderr)
        index = (site / "index.html").read_text(encoding="utf-8")
        app = (site / "app.js").read_text(encoding="utf-8")
        self.assertIn('href="styles.css?v=abc123"', index)
        self.assertIn('src="app.js?v=abc123"', index)
        self.assertIn("from './catalog.js?v=abc123'", app)
        self.assertIn("from './player-controls.js?v=abc123'", app)
        self.assertIn("import('./admin.js?v=abc123')", app)

    def test_remote_links_anchors_and_data_are_untouched(self):
        site = self.build()
        self.run_script(site)
        index = (site / "index.html").read_text(encoding="utf-8")
        app = (site / "app.js").read_text(encoding="utf-8")
        self.assertIn('src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"', index)
        self.assertIn('href="#/canales"', index)
        self.assertIn('href="data:image/svg+xml,x"', index)
        self.assertIn("from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'", app)

    def test_running_twice_changes_nothing(self):
        site = self.build()
        self.run_script(site)
        first = (site / "app.js").read_text(encoding="utf-8")
        self.assertEqual(self.run_script(site).returncode, 0)
        self.assertEqual((site / "app.js").read_text(encoding="utf-8"), first)

    def test_rejects_a_strange_version(self):
        site = self.build()
        result = self.run_script(site, "a b'c")
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
