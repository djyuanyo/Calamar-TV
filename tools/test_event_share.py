"""Link previews of events: Open Graph tags, uploaded covers served as images, safe escaping."""
import base64
import json
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = ROOT / 'hosting/calamar-evento.php'
COVER = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff\xe0fake-jpeg').decode()
CATALOG = {'channels': [], 'featured': [], 'hidden': [], 'leagues': [{'id': 'l', 'name': 'Liga Menciana'}],
           'events': [{'id': 'final', 'name': 'Local vs <Visitante> & "Co"', 'cover': 'https://example.com/foto.jpg', 'leagueId': 'l',
                       'startAt': '2026-10-24T19:00:00.000Z', 'round': 'Jornada 9', 'channelId': 'c'},
                      {'id': 'subida', 'name': 'Con foto subida', 'cover': COVER, 'channelId': 'c'}]}


@unittest.skipUnless(shutil.which('php'), 'Requires PHP CLI')
class EventShareTest(unittest.TestCase):
    def php(self, expression):
        program = ('define("CALAMAR_EVENT_TEST_ONLY", true); require ' + json.dumps(str(PHP)) + '; $catalog = json_decode('
                   + json.dumps(json.dumps(CATALOG)) + ', true); ' + expression)
        return subprocess.check_output(['php', '-r', program], text=True)

    def test_preview_has_cover_name_and_redirect(self):
        html = self.php('echo eventPage(findEvent($catalog, "final"), $catalog, "final", "https://calamarmenciano.com/calamar-evento.php");')
        self.assertIn('<meta property="og:title" content="Local vs &lt;Visitante&gt; &amp; &quot;Co&quot;">', html)
        self.assertIn('<meta property="og:image" content="https://example.com/foto.jpg">', html)
        self.assertIn('Liga Menciana · sábado 24 de octubre, 21:00 · Jornada 9', html)
        self.assertIn('url=https://djyuanyo.github.io/Calamar-TV/#/evento/final', html)
        self.assertIn('summary_large_image', html)
        self.assertNotIn('<Visitante>', html)

    def test_uploaded_cover_is_served_from_this_page(self):
        html = self.php('echo eventPage(findEvent($catalog, "subida"), $catalog, "subida", "https://calamarmenciano.com/calamar-evento.php");')
        self.assertIn('og:image" content="https://calamarmenciano.com/calamar-evento.php?id=subida&amp;imagen=1"', html)
        image = self.php('$i = coverImage(findEvent($catalog, "subida")["cover"]); echo $i["type"], "|", bin2hex($i["bytes"]);')
        self.assertEqual(image, 'image/jpeg|' + b'\xff\xd8\xff\xe0fake-jpeg'.hex())
        self.assertEqual(self.php('var_export(coverImage("data:image/svg+xml;base64,PHN2Zz4="));'), 'NULL')

    def test_unknown_event_and_firestore_answer(self):
        html = self.php('echo eventPage(findEvent($catalog, "nada"), $catalog, "nada", "https://calamarmenciano.com/calamar-evento.php");')
        self.assertIn('<meta property="og:title" content="Calamar TV">', html)
        self.assertNotIn('og:image"', html)
        answer = json.dumps({'fields': {'json': {'stringValue': json.dumps(CATALOG)}, 'revision': {'integerValue': '3'}}})
        self.assertEqual(self.php('echo findEvent(parseCatalog(' + json.dumps(answer) + '), "final")["round"];'), 'Jornada 9')
        self.assertEqual(self.php('var_export(parseCatalog("{}"));'), 'NULL')


if __name__ == '__main__':
    unittest.main()
