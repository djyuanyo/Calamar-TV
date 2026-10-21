"""Event preview pages on the public web: same slugs as the web, Open Graph tags, uploaded covers."""
import base64
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('event_pages', ROOT / 'tools/event_pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)

JPEG = b'\xff\xd8\xff\xe0fake-jpeg'
CATALOG = {'channels': [], 'featured': [], 'hidden': [], 'leagues': [{'id': 'l', 'name': 'Liga Menciana'}], 'events': [
    {'id': 'b', 'name': 'Local vs <Visitante> & "Co"', 'cover': 'https://example.com/foto.jpg', 'leagueId': 'l',
     'startAt': '2026-10-24T19:00:00.000Z', 'round': 'Jornada 9', 'channelId': 'c'},
    {'id': 'a', 'name': 'Final de Copa: Ñora', 'cover': 'data:image/jpeg;base64,' + base64.b64encode(JPEG).decode(),
     'startAt': '2026-12-01T20:00:00Z', 'channelId': 'c'},
    {'id': 'c', 'name': 'Final de Copa: Ñora', 'cover': 'https://example.com/x.jpg', 'channelId': 'c'},
]}
BASE = 'https://djyuanyo.github.io/Calamar-TV/'


class EventPagesTest(unittest.TestCase):
    def test_slugs_match_the_web(self):
        self.assertEqual(pages.event_slugs(CATALOG), {'b': 'local-vs-visitante-co', 'a': 'final-de-copa-nora', 'c': 'final-de-copa-nora-2'})
        script = ("import('./web/catalog.js').then(m => console.log(JSON.stringify([...m.eventSlugs("
                  + json.dumps(CATALOG) + ")])))")
        web = dict(json.loads(subprocess.check_output(['node', '-e', script], cwd=ROOT, text=True)))
        self.assertEqual(web, pages.event_slugs(CATALOG))

    def test_pages_with_cover_name_date_and_redirect(self):
        with tempfile.TemporaryDirectory() as site:
            pages.publish(site, BASE, CATALOG)
            html = (pathlib.Path(site) / 'evento/local-vs-visitante-co/index.html').read_text(encoding='utf-8')
            self.assertIn('<meta property="og:title" content="Local vs &lt;Visitante&gt; &amp; &quot;Co&quot;">', html)
            self.assertIn('<meta property="og:image" content="https://example.com/foto.jpg">', html)
            self.assertIn('Liga Menciana · sábado 24 de octubre, 21:00 · Jornada 9', html)
            self.assertIn('url=https://djyuanyo.github.io/Calamar-TV/#/evento/local-vs-visitante-co', html)
            self.assertNotIn('<Visitante>', html)
            upload = pathlib.Path(site) / 'evento/final-de-copa-nora'
            self.assertEqual((upload / 'portada.jpg').read_bytes(), JPEG)
            self.assertIn(f'og:image" content="{BASE}evento/final-de-copa-nora/portada.jpg"', (upload / 'index.html').read_text(encoding='utf-8'))
            self.assertIn('martes 1 de diciembre, 21:00', (upload / 'index.html').read_text(encoding='utf-8'))
            self.assertTrue((pathlib.Path(site) / 'evento/final-de-copa-nora-2/index.html').exists())


if __name__ == '__main__':
    unittest.main()
