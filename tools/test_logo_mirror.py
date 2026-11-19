"""Logo copies on the public web: PNG named like the app expects, listed in data/logos.json."""
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('logo_mirror', ROOT / 'tools/logo_mirror.py')
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)
import share_images


def png(size=(800, 400)):
    from PIL import Image
    out = io.BytesIO()
    Image.new('RGBA', size, (255, 255, 255, 255)).save(out, 'PNG')
    return out.getvalue()


class LogoMirrorTest(unittest.TestCase):
    def test_the_name_is_the_one_the_app_computes(self):
        # Same as CompetitionsTest.logoCopiesHaveTheNameTheWebPublishes in the app.
        self.assertEqual(mirror.mirror_name('https://docdog.top/logo/countries/spain/movistar/DAZN_1.png'), 'logos/d1d2ae4b65ac88a49c29625c.png')

    def test_readable_logos_are_copied_and_listed(self):
        catalog = {'channels': [{'id': 'a', 'logo': 'https://docdog.top/a.png'}, {'id': 'b', 'logo': 'https://bad.example/page'},
                                {'id': 'c', 'logo': 'data:image/png;base64,AAAA'}, {'id': 'd', 'logo': 'https://docdog.top/a.png'}],
                   'leagues': [{'id': 'l', 'logo': 'https://a.espncdn.com/l.png'}]}
        files = {'https://docdog.top/a.png': png(), 'https://bad.example/page': b'<html>no</html>', 'https://a.espncdn.com/l.png': png((50, 50))}
        asked = []
        images = share_images.Images(opener=lambda url: asked.append(url) or files[url])
        with tempfile.TemporaryDirectory() as site:
            copies = mirror.publish(site, catalog, images)
            self.assertEqual(sorted(copies), ['https://a.espncdn.com/l.png', 'https://docdog.top/a.png'])
            self.assertEqual(json.loads((pathlib.Path(site) / 'data/logos.json').read_text()), copies)
            from PIL import Image
            with Image.open(pathlib.Path(site) / copies['https://docdog.top/a.png']) as picture:
                self.assertEqual(picture.format, 'PNG')
                self.assertEqual(picture.size, (400, 200))
        self.assertEqual(asked.count('https://docdog.top/a.png'), 1)


class RecoveredCrestsTest(unittest.TestCase):
    def test_recovered_crests_publish_under_the_original_urls(self):
        import share_images
        images = share_images.Images(opener=lambda url: self.fail('Recovered crests must work offline'))
        urls = list(images.backups)
        self.assertEqual(len(urls), 2)
        with tempfile.TemporaryDirectory() as output:
            copies = mirror.publish(output, {'teams': [{'logo': url} for url in urls]}, images)
            self.assertEqual(set(copies), set(urls))
            for url, path in copies.items():
                self.assertTrue((pathlib.Path(output) / path).is_file())
                self.assertTrue(images.image(url).width > 0)


if __name__ == '__main__':
    unittest.main()
