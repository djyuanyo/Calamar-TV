import base64
import pathlib
import tempfile
import unittest
import event_pages as pages


class LibraryPagesTest(unittest.TestCase):
    def test_public_index_reads_all_three_sections(self):
        docs = {'index': {'sections': {'movies': 2, 'series': 1, 'documentaries': 1}},
                'movies-0': {'items': [{'id': 'm1'}]}, 'movies-1': {'items': [{'id': 'm2'}]},
                'series-0': {'items': [{'id': 's3'}]}, 'documentaries-0': {'items': [{'id': 'm4'}]}}
        library = pages.read_library(lambda name: docs[name])
        self.assertEqual([i['id'] for i in library['sections']['movies']], ['m1', 'm2'])
        self.assertEqual(library['sections']['documentaries'][0]['id'], 'm4')

    def test_shared_pages_have_the_cover_and_open_the_same_title(self):
        cover = 'data:image/jpeg;base64,' + base64.b64encode(b'photo').decode()
        library = {'sections': {section: [{'id': 'title', 'title': 'A <film>', 'tmdb': {'poster': 'https://img.example/poster.jpg'},
                                         'artwork': {'backdrop': cover}}] for section in pages.LIBRARY_PAGES}}
        with tempfile.TemporaryDirectory() as output:
            pages.publish_library(output, 'https://example.com/app/', library, download=lambda url: None)
            for route in pages.LIBRARY_PAGES.values():
                folder = pathlib.Path(output) / route / 'title'
                page = (folder / 'index.html').read_text()
                self.assertIn(f'og:image" content="https://example.com/app/{route}/title/portada.jpg"', page)
                self.assertIn(f'#/\u007broute\u007d/title'.format(route=route), page)
                self.assertIn('A &lt;film&gt;', page)
                self.assertEqual((folder / 'portada.jpg').read_bytes(), b'photo')
            # A removed title is absent from a new deployment directory.
        with tempfile.TemporaryDirectory() as output:
            pages.publish_library(output, 'https://example.com/', {'sections': {'movies': []}})
            self.assertFalse((pathlib.Path(output) / 'peliculas/title').exists())
