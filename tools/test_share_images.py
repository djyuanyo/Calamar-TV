"""Preview images: transparent parts of a PNG show the cards' dark green, not black."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

try:
    from PIL import Image
    import share_images
except ImportError:  # pragma: no cover
    Image = None


@unittest.skipUnless(Image, 'Requires Pillow')
class CoverTest(unittest.TestCase):
    def test_transparent_png_cover_is_not_black(self):
        logo = Image.new('RGBA', (200, 100), (0, 0, 0, 0))
        logo.paste(Image.new('RGBA', (50, 50), (255, 0, 0, 255)), (75, 25))
        card = share_images.cover_crop(logo)
        self.assertEqual(card.size, share_images.SIZE)
        corner = card.getpixel((5, 5))
        self.assertGreater(sum(corner), 30, corner)
        self.assertEqual(card.getpixel((600, 315))[:3], (255, 0, 0))


if __name__ == '__main__':
    unittest.main()
