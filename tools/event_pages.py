#!/usr/bin/env python3
"""Publishes a link preview page for every event: SITE/evento/<slug>/index.html.

WhatsApp, Telegram and the rest read the HTML without running JavaScript and never receive the
"#/evento/…" part of an address, so each event gets a real page on the public web with its cover and
name as Open Graph tags; the page then opens the event. The slug is the one the web uses
(eventSlugs() in web/catalog.js). The catalog comes from the public Firestore document, or from
data/custom.json when Firestore does not answer.

Usage: event_pages.py SITE_DIR BASE_URL   e.g. event_pages.py _site https://djyuanyo.github.io/Calamar-TV/
"""
import base64
import datetime
import html
import json
import math
import pathlib
import re
import sys
import unicodedata
import urllib.request
import zoneinfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG_URL = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
COVER = re.compile(r'^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$')


def slugify(text):
    """Same as slugify() in web/catalog.js: "Final de Copa: Ñora" -> "final-de-copa-nora"."""
    plain = ''.join(ch for ch in unicodedata.normalize('NFD', str(text)) if not unicodedata.category(ch).startswith('M'))
    return re.sub(r'[^a-z0-9]+', '-', plain.lower()).strip('-') or 'canal'


def instant(value):
    try:
        return datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return math.inf


def event_slugs(catalog):
    """Same as eventSlugs() in web/catalog.js: date order, repeated names get -2, -3…"""
    events = sorted(catalog.get('events') or [], key=lambda e: (instant(e.get('startAt') or ''), str(e.get('id'))))
    out, used = {}, set()
    for event in events:
        base = slug = slugify(event.get('name', ''))
        n = 2
        while slug in used:
            slug, n = f'{base}-{n}', n + 1
        used.add(slug)
        out[event['id']] = slug
    return out


def summary(event, catalog):
    """"Liga · sábado 24 de octubre, 21:00 · Jornada 9", in Madrid time."""
    parts = [l['name'] for l in catalog.get('leagues') or [] if l.get('id') == event.get('leagueId') and l.get('name')]
    if event.get('startAt') and math.isfinite(instant(event['startAt'])):
        local = datetime.datetime.fromtimestamp(instant(event['startAt']), zoneinfo.ZoneInfo('Europe/Madrid'))
        parts.append(f"{DAYS[local.weekday()]} {local.day} de {MONTHS[local.month - 1]}, {local:%H:%M}")
    parts += [event[key] for key in ('round', 'venue') if isinstance(event.get(key), str) and event[key]]
    return ' · '.join(parts)


def page(event, catalog, slug, base, image):
    target = f'{base}#/evento/{slug}'
    title, text = event.get('name') or 'Calamar TV', summary(event, catalog)
    e = lambda value: html.escape(str(value), quote=True)
    tags = [
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Calamar TV">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(text)}">',
        f'<meta property="og:url" content="{e(base)}evento/{e(slug)}/">',
        f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}">',
        f'<meta name="twitter:title" content="{e(title)}">',
        f'<meta name="twitter:description" content="{e(text)}">',
    ]
    if image:
        tags += [f'<meta property="og:image" content="{e(image)}">', f'<meta property="og:image:alt" content="{e(title)}">',
                 f'<meta name="twitter:image" content="{e(image)}">']
    script_target = json.dumps(target).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{e(title)}</title>\n<meta name="description" content="{e(text)}">\n' + '\n'.join(tags) + '\n'
            f'<meta http-equiv="refresh" content="0; url={e(target)}">\n<link rel="canonical" href="{e(target)}">\n'
            '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f5f5f5;font:16px system-ui,sans-serif}a{color:#d6ff00}</style>\n'
            f'</head>\n<body>\n<p><a href="{e(target)}">Abrir {e(title)} en Calamar TV</a></p>\n'
            f'<script>location.replace({script_target});</script>\n</body>\n</html>\n')


def read_catalog():
    try:
        with urllib.request.urlopen(CATALOG_URL, timeout=15) as answer:
            document = json.load(answer)
        return json.loads(document['fields']['json']['stringValue'])
    except Exception as error:  # Firestore down or not reachable: the bundled copy still gives pages.
        print(f'::warning::No se pudo leer el catálogo de Firestore ({error}); se usa data/custom.json')
        return json.loads((ROOT / 'data/custom.json').read_text(encoding='utf-8'))


def publish(site, base, catalog):
    site, base = pathlib.Path(site), base if base.endswith('/') else base + '/'
    slugs = event_slugs(catalog)
    for event in catalog.get('events') or []:
        slug = slugs[event['id']]
        folder = site / 'evento' / slug
        folder.mkdir(parents=True, exist_ok=True)
        cover, image = str(event.get('cover') or ''), ''
        if cover.startswith('https://'):
            image = cover
        elif COVER.match(cover):
            kind, data = COVER.match(cover).groups()
            name = 'portada.' + ('jpg' if kind == 'jpeg' else kind)
            (folder / name).write_bytes(base64.b64decode(data))
            image = f'{base}evento/{slug}/{name}'
        (folder / 'index.html').write_text(page(event, catalog, slug, base, image), encoding='utf-8')
    return slugs


if __name__ == '__main__':
    found = publish(sys.argv[1], sys.argv[2], read_catalog())
    print(f'Páginas de vista previa de eventos: {len(found)}')
