#!/usr/bin/env python3
"""Publishes a link preview page for every event and channel: SITE/evento/<slug>/ and SITE/canal/<slug>/.

WhatsApp, Telegram and the rest read the HTML without running JavaScript and never receive the
"#/evento/…" part of an address, so each event gets a real page on the public web with its cover and
name as Open Graph tags; the page then opens it. Each page carries its own preview image, drawn like the
card (tools/share_images.py): the cover, or for imported matches the league's background with both
crests and the league's logo, or for channels their logo on their category's colour. The slugs are the
ones the web uses (eventSlugs() and merge() in web/catalog.js). The catalog comes from the public
Firestore document, or from data/custom.json when Firestore does not answer.

Usage: event_pages.py SITE_DIR BASE_URL [CACHE_DIR]   e.g. event_pages.py _site https://djyuanyo.github.io/Calamar-TV/ .share-cache
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
import urllib.parse
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


def fixture_event(fixture, catalog):
    """Same as fixtureEvent() in web/competitions.js: an imported match named after its teams."""
    team = {t.get('id'): t for t in catalog.get('teams') or []}
    home = (team.get(fixture.get('homeTeamId')) or {}).get('name') or 'Local'
    away = (team.get(fixture.get('awayTeamId')) or {}).get('name') or 'Visitante'
    return {**fixture, 'name': fixture.get('name') or f'{home} vs {away}', 'cover': fixture.get('cover') or '', 'imported': True}


def all_events(catalog):
    return list(catalog.get('events') or []) + [fixture_event(f, catalog) for f in catalog.get('fixtures') or []]


def event_slugs(catalog):
    """Same as eventSlugs() in web/catalog.js: date order, a repeated name is numbered in every event
    that has it (-1, -2, -3…); imported matches after the events, so they never change an event's number."""
    order = lambda e: (instant(e.get('startAt') or ''), str(e.get('id')))
    every = all_events(catalog)
    events = sorted([e for e in every if not e.get('imported')], key=order) + sorted([e for e in every if e.get('imported')], key=order)
    times = {}
    for event in events:
        base = slugify(event.get('name', ''))
        times[base] = times.get(base, 0) + 1
    out, used = {}, set()
    for event in events:
        base = slugify(event.get('name', ''))
        repeated = times[base] > 1
        n = 1 if repeated else 2
        slug = f'{base}-1' if repeated else base
        while slug in used:
            n += 1
            slug = f'{base}-{n}'
        used.add(slug)
        out[event['id']] = slug
    return out


OWN_GROUP = 'Calamar TV'
CATEGORY_COLORS = {OWN_GROUP: '#5a6b12', 'Generalistas': '#1f4f8f', 'Deportes': '#1d7a40', 'Informativos': '#8f2c2c',
                   'Infantiles': '#b35c14', 'Música': '#6a2f8f', 'Autonómicos': '#1c7373'}
EXTRA_COLORS = ['#7a5418', '#2d5a8a', '#8a2d63', '#4a6b2a', '#5c3d8a', '#8a4a2d', '#2d7a6b', '#6b6b2d']


def default_color(name):
    """Same as defaultColor() in web/catalog.js."""
    if name in CATEGORY_COLORS:
        return CATEGORY_COLORS[name]
    h = 0
    for ch in str(name):
        h = (h * 31 + ord(ch)) % 360
    return EXTRA_COLORS[h % len(EXTRA_COLORS)]


def _stream(value):
    try:
        u = urllib.parse.urlsplit(str(value).strip())
        return u.scheme in ('http', 'https') and bool(u.hostname)
    except ValueError:
        return False


def channels(tdt, catalog):
    """Same channels, order and slugs as merge() in web/catalog.js: the administrator's, then TDT."""
    hidden, out, ids = set(catalog.get('hidden') or []), [], set()
    for own, source in ((True, catalog.get('channels') or []), (False, (tdt or {}).get('channels') or [])):
        for c in source:
            if not isinstance(c, dict) or (own and c.get('hidden')):
                continue
            cid, playable = str(c.get('id') or ''), any(_stream(s) for s in c.get('streams') or [])
            web = str(c.get('web') or '').startswith('https://')
            if not cid or cid in ids or (not own and cid in hidden) or not (playable if own else playable or web):
                continue
            ids.add(cid)
            out.append({**c, 'own': own, 'group': str(c.get('group') or '').strip() or (OWN_GROUP if own else 'Otros')})
    categories = catalog.get('categories') if isinstance(catalog.get('categories'), list) else None
    used = set()
    for c in out:
        found = next((k for k in categories or [] if k.get('id') == c['group']), None) or next((k for k in categories or [] if k.get('name') == c['group']), None)
        c['shown'] = found['name'] if found else c['group']
        c['color'] = found['color'] if found else default_color(c['group'])
        base = slug = slugify(c.get('name') or 'Canal')
        n = 2
        while slug in used:
            slug, n = f'{base}-{n}', n + 1
        used.add(slug)
        c['slug'] = slug
    return out


def summary(event, catalog):
    """"Liga · sábado 24 de octubre, 21:00 · Jornada 9", in Madrid time."""
    parts = [l['name'] for l in catalog.get('leagues') or [] if l.get('id') == event.get('leagueId') and l.get('name')]
    if event.get('startAt') and math.isfinite(instant(event['startAt'])):
        local = datetime.datetime.fromtimestamp(instant(event['startAt']), zoneinfo.ZoneInfo('Europe/Madrid'))
        parts.append(f"{DAYS[local.weekday()]} {local.day} de {MONTHS[local.month - 1]}, {local:%H:%M}")
    parts += [event[key] for key in ('round', 'venue') if isinstance(event.get(key), str) and event[key]]
    return ' · '.join(parts)


def page(event, catalog, slug, base, image, kind='evento', text=None):
    route = f'{kind}/{slug}' if slug else kind
    public_path = f'{route}/'
    target = f'{base}#/{route}'
    title, text = event.get('name') or 'Calamar TV', summary(event, catalog) if text is None else text
    e = lambda value: html.escape(str(value), quote=True)
    tags = [
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Calamar TV">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(text)}">',
        f'<meta property="og:url" content="{e(base)}{e(public_path)}">',
        f'<meta name="twitter:card" content="{"summary_large_image" if image else "summary"}">',
        f'<meta name="twitter:title" content="{e(title)}">',
        f'<meta name="twitter:description" content="{e(text)}">',
    ]
    if image:
        tags += [f'<meta property="og:image" content="{e(image)}">', f'<meta property="og:image:alt" content="{e(title)}">',
                 f'<meta name="twitter:image" content="{e(image)}">']
        if image.endswith('/vista.jpg'):  # Drawn here: its size is known, so previews show it at once.
            tags += ['<meta property="og:image:type" content="image/jpeg">', '<meta property="og:image:width" content="1200">',
                     '<meta property="og:image:height" content="630">']
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


IMAGE_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}
OWN_IMAGES = ('https://raw.githubusercontent.com/djyuanyo/Calamar-TV/', 'https://djyuanyo.github.io/Calamar-TV/')


def download_cover(url):
    """(bytes, extension) of a cover on another site, or None. Many image sites refuse WhatsApp's robot or
    links from elsewhere, so the preview page carries its own copy, made here from GitHub."""
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                                                       'Accept': 'image/jpeg,image/png,image/webp,image/*;q=0.8'})
        with urllib.request.urlopen(request, timeout=15) as answer:
            kind = (answer.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            data = answer.read(5 * 1024 * 1024 + 1)
    except Exception as error:
        print(f'::warning::No se pudo copiar la portada {url[:80]} ({error}); la vista previa usa el enlace')
        return None
    if kind not in IMAGE_TYPES or not data or len(data) > 5 * 1024 * 1024:
        print(f'::warning::La portada {url[:80]} no es una imagen JPEG/PNG/WebP de hasta 5 MB ({kind or "sin tipo"})')
        return None
    return data, IMAGE_TYPES[kind]


def event_preview(event, catalog, images):
    """The card of an event as a JPEG: its cover, or the league's background with both crests."""
    import share_images
    cover = images.image(event.get('cover')) if event.get('cover') else None
    find = lambda group, key: next((x for x in catalog.get(group) or [] if x.get('id') == event.get(key)), {})
    league = find('leagues', 'leagueId')
    home, away = find('teams', 'homeTeamId'), find('teams', 'awayTeamId')
    if cover and not (home.get('logo') or away.get('logo')):
        return share_images.jpeg(share_images.cover_crop(cover))
    pick = lambda value: images.image(value) if value else None
    return share_images.jpeg(share_images.match_card(cover if cover is not None else pick(league.get('background')), pick(home.get('logo')),
                                                     pick(away.get('logo')), pick(league.get('logo'))))


def publish(site, base, catalog, download=download_cover, images=None, tdt=None):
    """Writes the pages. With `images` (share_images.Images) every page gets its card drawn as vista.jpg;
    without it, events use their cover as it is."""
    site, base = pathlib.Path(site), base if base.endswith('/') else base + '/'
    slugs = event_slugs(catalog)
    if images:
        images.prefetch([e.get('cover') for e in all_events(catalog)] + [x.get(k) for x in catalog.get('leagues') or [] for k in ('logo', 'background')]
                        + [t.get('logo') for t in catalog.get('teams') or []])
    for event in all_events(catalog):
        slug = slugs[event['id']]
        folder = site / 'evento' / slug
        folder.mkdir(parents=True, exist_ok=True)
        cover, image = str(event.get('cover') or ''), ''
        if images:
            try:
                (folder / 'vista.jpg').write_bytes(event_preview(event, catalog, images))
                image = f'{base}evento/{slug}/vista.jpg'
            except Exception as error:
                print(f'::warning::No se pudo dibujar la vista previa de {event.get("name")} ({error})')
        copy = download(cover) if not image and cover.startswith('https://') and not cover.startswith(OWN_IMAGES) else None
        if copy:
            data, extension = copy
            (folder / f'portada.{extension}').write_bytes(data)
            image = f'{base}evento/{slug}/portada.{extension}'
        elif image:
            pass
        elif cover.startswith('https://'):
            image = cover
        elif COVER.match(cover):
            kind, data = COVER.match(cover).groups()
            name = 'portada.' + ('jpg' if kind == 'jpeg' else kind)
            (folder / name).write_bytes(base64.b64decode(data))
            image = f'{base}evento/{slug}/{name}'
        (folder / 'index.html').write_text(page(event, catalog, slug, base, image), encoding='utf-8')
        # A link shared before the names were numbered («local-vs-visitante») opens the first one («…-1»).
        old = slug[:-2] if slug.endswith('-1') else None
        if old and old not in slugs.values():
            alias = site / 'evento' / old
            alias.mkdir(parents=True, exist_ok=True)
            (alias / 'index.html').write_text(page(event, catalog, slug, base, image), encoding='utf-8')
    publish_live(site, base, catalog, images)
    publish_leagues(site, base, catalog, images)
    if tdt is not None:
        publish_channels(site, base, catalog, tdt, images)
    return slugs


def league_slugs(catalog):
    """Same as leagueSlugs() in web/catalog.js: the league's name, repeated names get -2, -3… in the catalog's order."""
    out, used = {}, set()
    for league in catalog.get('leagues') or []:
        base = slug = slugify(league.get('name', ''))
        n = 2
        while slug in used:
            slug, n = f'{base}-{n}', n + 1
        used.add(slug)
        out[league['id']] = slug
    return out


def publish_live(site, base, catalog, images=None):
    """The shared mixed live schedule uses Calamar TV's own logo."""
    folder = pathlib.Path(site) / 'directo'
    folder.mkdir(parents=True, exist_ok=True)
    image = f'{base}assets/calamar-menciano-tv.png'
    if images:
        import share_images
        from PIL import Image
        with Image.open(ROOT / 'web/assets/calamar-menciano-tv.png') as logo:
            (folder / 'vista.jpg').write_bytes(share_images.jpeg(share_images.league_card(None, logo.convert('RGBA'))))
        image = f'{base}directo/vista.jpg'
    (folder / 'index.html').write_text(page({'name': 'Eventos En Directo'}, catalog, '', base, image,
        kind='directo', text='Todos los eventos de hoy, ordenados por competición, en Calamar TV'), encoding='utf-8')


def publish_leagues(site, base, catalog, images=None):
    """liga/<slug>/ for every league, with its logo on its background; the page opens #/liga/<slug>."""
    slugs = league_slugs(catalog)
    for league in catalog.get('leagues') or []:
        slug = slugs[league['id']]
        folder = pathlib.Path(site) / 'liga' / slug
        folder.mkdir(parents=True, exist_ok=True)
        image = ''
        if images:
            import share_images
            try:
                pick = lambda value: images.image(value) if value else None
                (folder / 'vista.jpg').write_bytes(share_images.jpeg(share_images.league_card(pick(league.get('background')), pick(league.get('logo')))))
                image = f'{base}liga/{slug}/vista.jpg'
            except Exception as error:
                print(f'::warning::No se pudo dibujar la vista previa de {league.get("name")} ({error})')
        elif str(league.get('background') or league.get('logo') or '').startswith('https://'):
            image = league.get('background') or league.get('logo')
        text = f'Todos los partidos de {league.get("name")} con canal, en Calamar TV'
        (folder / 'index.html').write_text(page(league, catalog, slug, base, image, kind='liga', text=text), encoding='utf-8')


def publish_channels(site, base, catalog, tdt, images=None):
    """canal/<slug>/ for every channel, with its logo on its category's colour."""
    found = channels(tdt, catalog)
    if images:
        import share_images
        images.prefetch([c.get('logo') for c in found])
    for c in found:
        folder = site / 'canal' / c['slug']
        folder.mkdir(parents=True, exist_ok=True)
        image = ''
        if images:
            try:
                logo = images.image(c.get('logo')) if str(c.get('logo') or '').startswith('https://') else None
                (folder / 'vista.jpg').write_bytes(share_images.jpeg(share_images.channel_card(c['color'], logo, c.get('name'))))
                image = f'{base}canal/{c["slug"]}/vista.jpg'
            except Exception as error:
                print(f'::warning::No se pudo dibujar la vista previa de {c.get("name")} ({error})')
        elif str(c.get('logo') or '').startswith('https://'):
            image = c['logo']
        text = ' · '.join(x for x in (c['shown'], c.get('region'), 'En directo en Calamar TV') if x)
        (folder / 'index.html').write_text(page(c, catalog, c['slug'], base, image, kind='canal', text=text), encoding='utf-8')
    return found


if __name__ == '__main__':
    site, base = sys.argv[1], sys.argv[2]
    sys.path.insert(0, str(ROOT / 'tools'))
    try:
        import share_images
        images = share_images.Images(sys.argv[3] if len(sys.argv) > 3 else None)
    except ImportError as error:  # Without Pillow the pages still work, with the covers as they are.
        print(f'::warning::Sin Pillow no se dibujan las vistas previas ({error})')
        images = None
    tdt_file = pathlib.Path(site) / 'data/tdt.json'
    tdt = json.loads(tdt_file.read_text(encoding='utf-8')) if tdt_file.exists() else {'channels': []}
    found = publish(site, base, read_catalog(), images=images, tdt=tdt)
    print(f'Páginas de vista previa de eventos: {len(found)}')
