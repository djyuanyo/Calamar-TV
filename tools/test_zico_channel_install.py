"""The manual installer patches the existing PHP while preserving VPS routing and credentials."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / 'hosting/actualizar-zico-canales.php'


class ZicoChannelInstallTest(unittest.TestCase):
    def test_install_preserves_custom_server_routes_and_private_config_and_is_idempotent(self):
        original = (ROOT / 'hosting/calamar-player.php').read_text().replace(
            '#^/(?:api/player|channels)/([0-9]{1,16})/?$#D', '#^/api/player/([0-9]{1,16})/?$#D')
        original += '\n// Existing VPS route: https://video.calamarmenciano.com/ -- preserve this custom code\n'
        with tempfile.TemporaryDirectory() as tmp:
            public = Path(tmp, 'public'); public.mkdir()
            target = public / 'calamar-player.php'; target.write_text(original)
            config = Path(tmp, 'calamar-zico-config.php'); config.write_text('<?php return "test-private-credential";')
            code = f'''
            require {json.dumps(str(INSTALLER))};
            $_SERVER['DOCUMENT_ROOT'] = {json.dumps(str(public))};
            calamarInstallZicoChannels({json.dumps(str(public))});
            calamarInstallZicoChannels({json.dumps(str(public))});
            '''
            subprocess.check_call(['php', '-r', code])
            result = target.read_text()
            self.assertIn('#^/(?:api/player|channels)/([0-9]{1,16})/?$#D', result)
            self.assertEqual(result.count('CALAMAR_ZICO_CHANNEL_OPEN_V1'), 1)
            self.assertEqual(result.count('CALAMAR_ZICO_CHANNEL_ALLOW_V1'), 1)
            self.assertIn('Existing VPS route: https://video.calamarmenciano.com/', result)
            self.assertEqual(config.read_text(), '<?php return "test-private-credential";')
            backups = list(Path(tmp, 'calamar-zico-backups').glob('*.php'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), original)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
            subprocess.check_call(['php', '-l', str(target)], stdout=subprocess.DEVNULL)

    def test_unknown_server_version_is_not_modified(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp, 'calamar-player.php'); target.write_text('<?php echo "custom server";')
            code = f'''require {json.dumps(str(INSTALLER))};
            try {{calamarInstallZicoChannels({json.dumps(tmp)}); exit(1);}}
            catch (RuntimeException $error) {{echo "unchanged";}}'''
            result = subprocess.check_output(['php', '-r', code], text=True)
            self.assertEqual(result, 'unchanged')
            self.assertEqual(target.read_text(), '<?php echo "custom server";')
