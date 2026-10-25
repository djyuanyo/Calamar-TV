#!/usr/bin/env python3
"""Copies of the administrator's channel logos on the public web: SITE/logos/<hash>.png.

Logo sites are sometimes blocked by Spanish operators (or refuse other webs), so a logo that works from
anywhere else never shows on the phone. Each logo is read here, from GitHub, saved as PNG next to the web
and listed in SITE/data/logos.json ({original address: copy}); the web shows the copy. The app finds the
copy by the same name: the first 24 hex digits of the SHA-256 of the address (Catalog.mirror()).

Usage: logo_mirror.py SITE_DIR [CACHE_DIR]
"""
import hashlib
import io
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))


def mirror_name(url):
    """Same as Catalog.mirror() in the app."""
    return 'logos/' + hashlib.sha256(url.encode('utf-8')).hexdigest()[:24] + '.png'


def logo_addresses(catalog):
    found = []
    for group in ('channels', 'leagues', 'teams'):
        for item in catalog.get(group) or []:
            url = item.get('logo') if isinstance(item, dict) else None
            if isinstance(url, str) and url.startswith('https://') and url not in found:
                found.append(url)
    return found


def publish(site, catalog, images):
    """Writes the copies that could be read and returns their list."""
    from PIL import Image
    site = pathlib.Path(site)
    (site / 'logos').mkdir(parents=True, exist_ok=True)
    urls = logo_addresses(catalog)
    images.prefetch(urls)
    copies = {}
    for url in urls:
        data = images.raw(url)
        if not data:
            continue
        try:
            with Image.open(io.BytesIO(data)) as picture:
                picture.load()
                picture = picture.convert('RGBA')
                # Logos are shown small: at most 400 px keeps them sharp and light.
                picture.thumbnail((400, 400), Image.LANCZOS)
                out = io.BytesIO()
                picture.save(out, 'PNG', optimize=True)
        except Exception as error:
            print(f'::warning::El logo {url[:80]} no es una imagen ({error})')
            continue
        name = mirror_name(url)
        (site / name).write_bytes(out.getvalue())
        copies[url] = name
    (site / 'data').mkdir(parents=True, exist_ok=True)
    (site / 'data/logos.json').write_text(json.dumps(copies, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    return copies


if __name__ == '__main__':
    import event_pages
    import share_images
    found = publish(sys.argv[1], event_pages.read_catalog(), share_images.Images(sys.argv[2] if len(sys.argv) > 2 else None))
    print(f'Logos copiados: {len(found)}')
