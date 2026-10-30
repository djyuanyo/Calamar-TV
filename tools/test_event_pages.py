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
    {'id': 'd', 'name': 'Celtic vs Celta', 'cover': 'https://image.dazn.example/ca/image?id=abc&quality=70', 'channelId': 'c'},
    {'id': 'e', 'name': 'Betis vs Feyenoord', 'cover': 'https://raw.githubusercontent.com/djyuanyo/Calamar-TV/main/web/images/abc.jpg', 'channelId': 'c'},
]}
COPIES = {'https://image.dazn.example/ca/image?id=abc&quality=70': (b'\x89PNGfake', 'png')}
BASE = 'https://djyuanyo.github.io/Calamar-TV/'


class EventPagesTest(unittest.TestCase):
    def test_slugs_match_the_web(self):
        self.assertEqual(pages.event_slugs(CATALOG), {'b': 'local-vs-visitante-co', 'a': 'final-de-copa-nora-1', 'c': 'final-de-copa-nora-2',
                                                      'd': 'celtic-vs-celta', 'e': 'betis-vs-feyenoord'})
        script = ("import('./web/catalog.js').then(m => console.log(JSON.stringify([...m.eventSlugs("
                  + json.dumps(CATALOG) + ")])))")
        web = dict(json.loads(subprocess.check_output(['node', '-e', script], cwd=ROOT, text=True)))
        self.assertEqual(web, pages.event_slugs(CATALOG))

    def test_pages_with_cover_name_date_and_redirect(self):
        with tempfile.TemporaryDirectory() as site:
            asked = []
            pages.publish(site, BASE, CATALOG, download=lambda url: asked.append(url) or COPIES.get(url))
            html = (pathlib.Path(site) / 'evento/local-vs-visitante-co/index.html').read_text(encoding='utf-8')
            self.assertIn('<meta property="og:title" content="Local vs &lt;Visitante&gt; &amp; &quot;Co&quot;">', html)
            self.assertIn('<meta property="og:image" content="https://example.com/foto.jpg">', html)
            self.assertIn('Liga Menciana · sábado 24 de octubre, 21:00 · Jornada 9', html)
            self.assertIn('url=https://djyuanyo.github.io/Calamar-TV/#/evento/local-vs-visitante-co', html)
            self.assertNotIn('<Visitante>', html)
            upload = pathlib.Path(site) / 'evento/final-de-copa-nora-1'
            self.assertEqual((upload / 'portada.jpg').read_bytes(), JPEG)
            self.assertIn(f'og:image" content="{BASE}evento/final-de-copa-nora-1/portada.jpg"', (upload / 'index.html').read_text(encoding='utf-8'))
            # A link shared before repeated names were numbered opens the first one, with its image.
            old = (pathlib.Path(site) / 'evento/final-de-copa-nora/index.html').read_text(encoding='utf-8')
            self.assertIn(f'og:image" content="{BASE}evento/final-de-copa-nora-1/portada.jpg"', old)
            self.assertIn('#/evento/final-de-copa-nora-1', old)
            self.assertIn('martes 1 de diciembre, 21:00', (upload / 'index.html').read_text(encoding='utf-8'))
            self.assertTrue((pathlib.Path(site) / 'evento/final-de-copa-nora-2/index.html').exists())
            # A cover on another site is copied next to the page; the copy is the preview image.
            dazn = pathlib.Path(site) / 'evento/celtic-vs-celta'
            self.assertEqual((dazn / 'portada.png').read_bytes(), b'\x89PNGfake')
            self.assertIn(f'og:image" content="{BASE}evento/celtic-vs-celta/portada.png"', (dazn / 'index.html').read_text(encoding='utf-8'))
            # Covers already in the repository are linked as they are, not downloaded.
            self.assertNotIn(CATALOG['events'][4]['cover'], asked)
            self.assertIn('og:image" content="https://raw.githubusercontent.com/djyuanyo/Calamar-TV/main/web/images/abc.jpg"',
                          (pathlib.Path(site) / 'evento/betis-vs-feyenoord/index.html').read_text(encoding='utf-8'))

    def test_a_cover_that_is_not_an_image_is_not_copied(self):
        class Answer:
            headers = {'Content-Type': 'text/html'}
            def read(self, n): return b'<html>'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        original = pages.urllib.request.urlopen
        pages.urllib.request.urlopen = lambda request, timeout: Answer()
        try:
            self.assertIsNone(pages.download_cover('https://example.com/a'))
        finally:
            pages.urllib.request.urlopen = original


def png(color, size=(200, 200)):
    import io
    from PIL import Image
    out = io.BytesIO()
    Image.new('RGBA', size, color).save(out, 'PNG')
    return out.getvalue()


FIXTURES = {'channels': [{'id': 'mine', 'name': 'La 1', 'group': 'Deportes', 'streams': ['https://example.com/a.m3u8'], 'logo': 'https://img.example/mine.png'},
                         {'id': 'off', 'name': 'Oculto', 'hidden': True, 'streams': ['https://example.com/b.m3u8']}],
            'featured': [], 'hidden': ['tdt-hidden'],
            'leagues': [{'id': 'l', 'name': 'LaLiga', 'logo': 'https://img.example/liga.png', 'background': 'https://img.example/fondo.jpg'}],
            'teams': [{'id': 'h', 'name': 'Real Betis', 'logo': 'https://img.example/h.png'}, {'id': 'a', 'name': 'Feyenoord', 'logo': 'https://img.example/a.png'}],
            'events': [{'id': 'manual', 'name': 'Real Betis vs Feyenoord', 'cover': 'https://img.example/cover.jpg', 'channelId': 'mine', 'startAt': '2026-12-01T20:00:00Z'}],
            'fixtures': [{'id': 'partido-1', 'leagueId': 'l', 'homeTeamId': 'h', 'awayTeamId': 'a', 'startAt': '2026-10-25T19:00:00Z', 'matchId': '1', 'round': 'Jornada 10'}]}
TDT = {'channels': [{'id': 'la-1', 'name': 'La 1', 'group': 'Generalistas', 'streams': ['https://rtve.example/la1.m3u8'], 'logo': 'https://img.example/la1.png'},
                    {'id': 'tdt-hidden', 'name': 'Oculta', 'streams': ['https://x.example/o.m3u8']},
                    {'id': 'web-only', 'name': 'Solo Web', 'streams': [], 'web': 'https://web.example/'},
                    {'id': 'nada', 'name': 'Sin nada', 'streams': []}]}


class SharePreviewTest(unittest.TestCase):
    def web(self, expression):
        script = f"Promise.all([import('./web/catalog.js')]).then(([m]) => console.log(JSON.stringify({expression})))"
        return json.loads(subprocess.check_output(['node', '-e', script], cwd=ROOT, text=True))

    def test_imported_matches_and_channels_use_the_web_slugs(self):
        self.assertEqual(pages.event_slugs(FIXTURES), {'manual': 'real-betis-vs-feyenoord-1', 'partido-1': 'real-betis-vs-feyenoord-2'})
        self.assertEqual(dict(self.web(f'[...m.eventSlugs({json.dumps(FIXTURES)})]')), pages.event_slugs(FIXTURES))
        python = [(c['id'], c['slug'], c['color']) for c in pages.channels(TDT, FIXTURES)]
        web = [tuple(x) for x in self.web(f'm.merge({json.dumps(TDT)}, {json.dumps(FIXTURES)}).map(c => [c.id, c.slug, c.color])')]
        self.assertEqual(python, web)
        self.assertEqual([x[1] for x in python], ['la-1', 'la-1-2', 'solo-web'])

    def test_every_page_gets_its_card_as_preview_image(self):
        import sys
        from PIL import Image
        sys.path.insert(0, str(ROOT / 'tools'))
        import share_images
        files = {'https://img.example/' + k: png(c) for k, c in (('mine.png', (200, 0, 0, 255)), ('la1.png', (0, 0, 200, 255)),
                 ('liga.png', (255, 255, 255, 255)), ('h.png', (0, 150, 70, 255)), ('a.png', (200, 20, 40, 255)), ('cover.jpg', (10, 10, 10, 255)))}
        asked = []
        images = share_images.Images(opener=lambda url: asked.append(url) or files[url])
        with tempfile.TemporaryDirectory() as site:
            pages.publish(site, BASE, FIXTURES, download=lambda url: self.fail('covers are drawn, not linked'), images=images, tdt=TDT)
            root = pathlib.Path(site)
            for folder in ('liga/laliga', 'evento/real-betis-vs-feyenoord-1', 'evento/real-betis-vs-feyenoord-2', 'canal/la-1', 'canal/la-1-2', 'canal/solo-web'):
                with Image.open(root / folder / 'vista.jpg') as picture:
                    self.assertEqual(picture.size, (1200, 630))
                self.assertLessEqual((root / folder / 'vista.jpg').stat().st_size, 300 * 1024)
                html = (root / folder / 'index.html').read_text(encoding='utf-8')
                self.assertIn(f'og:image" content="{BASE}{folder}/vista.jpg"', html)
                self.assertIn('<meta property="og:image:width" content="1200">', html)
            with Image.open(root / 'evento/real-betis-vs-feyenoord-2/vista.jpg') as opened:
                match = opened.convert('RGB')
            self.assertEqual(match.getpixel((600, 315)), (255, 255, 255))  # The league's logo in the middle.
            self.assertGreater(match.getpixel((270, 315))[1], 120)        # The home crest on the left.
            self.assertIn('url=https://djyuanyo.github.io/Calamar-TV/#/canal/la-1"', (root / 'canal/la-1/index.html').read_text(encoding='utf-8'))
            self.assertIn('Deportes · En directo en Calamar TV', (root / 'canal/la-1/index.html').read_text(encoding='utf-8'))
            # Each league has its own page to share: its logo large in the middle, opening #/liga/<slug>.
            live = (root / 'directo/index.html').read_text(encoding='utf-8')
            self.assertIn('url=https://djyuanyo.github.io/Calamar-TV/#/directo"', live)
            self.assertIn('content="https://djyuanyo.github.io/Calamar-TV/directo/"', live)
            self.assertIn('Eventos En Directo', live)
            self.assertTrue((root / 'directo/vista.jpg').is_file())
            league = (root / 'liga/laliga/index.html').read_text(encoding='utf-8')
            self.assertIn('url=https://djyuanyo.github.io/Calamar-TV/#/liga/laliga"', league)
            self.assertIn('Todos los partidos de LaLiga con canal, en Calamar TV', league)
            with Image.open(root / 'liga/laliga/vista.jpg') as opened:
                self.assertGreater(min(opened.convert('RGB').getpixel((600, 315))), 200)
            # The background that does not answer is left out; each image is read once.
            self.assertEqual(asked.count('https://img.example/liga.png'), 1)


if __name__ == '__main__':
    unittest.main()
