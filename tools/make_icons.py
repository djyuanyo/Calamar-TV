#!/usr/bin/env python3
"""Builds the app icon, the Android TV banner and the web favicons from the header logo.

Usage: python tools/make_icons.py   (needs Pillow). Run it again whenever the logo changes.
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOGO = ROOT / 'web/assets/calamar-menciano-tv.png'
RES = ROOT / 'app/src/main/res'
BACKGROUND = (11, 13, 16, 255)  # #0b0d10, the background of the web and the app
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def logo():
    image = Image.open(LOGO).convert('RGBA')
    return image.crop(image.getbbox())


def place(canvas, image, height, center=None):
    """Pastes the logo scaled to `height` pixels, centred on `center` (default: canvas centre)."""
    width = round(image.width * height / image.height)
    scaled = image.resize((width, height), Image.LANCZOS)
    cx, cy = center or (canvas.width / 2, canvas.height / 2)
    canvas.alpha_composite(scaled, (round(cx - width / 2), round(cy - height / 2)))
    return canvas


def rounded(size, radius):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    tile.paste(Image.new('RGBA', (size, size), BACKGROUND), mask=mask)
    return tile


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def main():
    crest = logo()
    for name, scale in DENSITIES.items():
        # Android 7 and earlier: a rounded dark tile with the crest.
        size = round(48 * scale)
        save(place(rounded(size, round(size * 0.2)), crest, round(size * 0.82)), RES / f'mipmap-{name}/ic_launcher.png')
        # Android 8+: adaptive icon layer, 108dp, crest inside the 66dp safe zone.
        size = round(108 * scale)
        save(place(Image.new('RGBA', (size, size), (0, 0, 0, 0)), crest, round(60 * scale)), RES / f'mipmap-{name}/ic_launcher_foreground.png')
    # Android TV launcher banner, 320x180dp.
    save(place(Image.new('RGBA', (640, 360), BACKGROUND), crest, 300), RES / 'drawable-xhdpi/banner.png')
    # Web: transparent favicons for the tab, a dark tile for iOS home screens.
    assets = ROOT / 'web/assets'
    for size in (32, 192):
        save(place(Image.new('RGBA', (size, size), (0, 0, 0, 0)), crest, size), assets / f'favicon-{size}.png')
    save(place(Image.new('RGBA', (180, 180), BACKGROUND), crest, 150), assets / 'apple-touch-icon.png')


if __name__ == '__main__':
    main()
