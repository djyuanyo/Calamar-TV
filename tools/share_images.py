"""Preview images (1200×630 JPEG) for shared links, drawn like the cards of the web and the app.

Events with a cover use the cover; events without one (imported matches) get the league's background
with the home and away crests and the league's logo between them; channels get their logo on the
colour of their category. Images are read once and kept in a cache folder between runs.
"""
import base64
import concurrent.futures
import hashlib
import io
import pathlib
import re
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

SIZE = (1200, 630)
MAX_BYTES = 300 * 1024  # WhatsApp drops larger preview images.
DATA = re.compile(r'^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$')
AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


class Images:
    """Reads images by address (https or data:), once, with a cache folder that survives between runs."""

    def __init__(self, cache=None, opener=None):
        self.cache = pathlib.Path(cache) if cache else None
        self.opener = opener or self._download
        self.memory = {}
        if self.cache:
            self.cache.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _download(url):
        request = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'image/jpeg,image/png,image/webp,image/*;q=0.8'})
        with urllib.request.urlopen(request, timeout=10) as answer:
            data = answer.read(5 * 1024 * 1024 + 1)
        if len(data) > 5 * 1024 * 1024:
            raise ValueError('imagen de más de 5 MB')
        return data

    def raw(self, url):
        url = str(url or '')
        if url in self.memory:
            return self.memory[url]
        data = None
        match = DATA.match(url)
        if match:
            data = base64.b64decode(match.group(2))
        elif url.startswith('https://'):
            file = self.cache / hashlib.sha256(url.encode()).hexdigest() if self.cache else None
            if file and file.exists():
                data = file.read_bytes()
            else:
                try:
                    data = self.opener(url)
                    if file and data:
                        file.write_bytes(data)
                except Exception as error:
                    print(f'::warning::No se pudo leer la imagen {url[:80]} ({error})')
        self.memory[url] = data
        return data

    def image(self, url):
        data = self.raw(url)
        if not data:
            return None
        try:
            picture = Image.open(io.BytesIO(data))
            picture.load()
            return ImageOps.exif_transpose(picture).convert('RGBA')
        except Exception as error:
            print(f'::warning::La imagen {str(url)[:80]} no se puede abrir ({error})')
            return None

    def prefetch(self, urls, workers=16):
        """Downloads many images at once, so hundreds of channel logos do not take minutes."""
        todo = sorted({u for u in urls if isinstance(u, str) and u.startswith('https://')})
        with concurrent.futures.ThreadPoolExecutor(workers) as pool:
            list(pool.map(self.raw, todo))


def cover_crop(picture, size=SIZE):
    """The picture filling the card. Transparent parts (a PNG) show the dark green of the cards, not black."""
    fitted = ImageOps.fit(picture.convert('RGBA'), size, Image.LANCZOS, centering=(0.5, 0.5))
    base = gradient((16, 38, 26, 255), (11, 20, 16, 255), size)
    base.alpha_composite(fitted)
    return base.convert('RGB')


def fit_inside(canvas, picture, box):
    """Pastes `picture` as large as fits in box (x, y, width, height), centred, keeping its shape."""
    x, y, w, h = box
    copy = picture.copy()
    copy.thumbnail((w, h), Image.LANCZOS)
    if copy.width < w and copy.height < h:  # Small logos are enlarged to the box too.
        scale = min(w / copy.width, h / copy.height)
        copy = picture.resize((max(1, round(picture.width * scale)), max(1, round(picture.height * scale))), Image.LANCZOS)
    canvas.alpha_composite(copy, (x + (w - copy.width) // 2, y + (h - copy.height) // 2))


def gradient(top, bottom, size=SIZE):
    base = Image.new('RGBA', size, top)
    mask = Image.linear_gradient('L').resize(size)
    base.paste(Image.new('RGBA', size, bottom), (0, 0), mask)
    return base


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow older than 10.1.
        return ImageFont.load_default()


def shadow(canvas, picture, box, offset=8, blur_alpha=110):
    """A soft dark copy under a crest, as the drop shadow of the cards."""
    x, y, w, h = box
    copy = picture.copy()
    copy.thumbnail((w, h), Image.LANCZOS)
    if copy.width < w and copy.height < h:
        scale = min(w / copy.width, h / copy.height)
        copy = picture.resize((max(1, round(picture.width * scale)), max(1, round(picture.height * scale))), Image.LANCZOS)
    dark = Image.new('RGBA', copy.size, (0, 0, 0, 0))
    dark.putalpha(copy.getchannel('A').point(lambda a: a * blur_alpha // 255))
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    layer.alpha_composite(dark, (x + (w - copy.width) // 2, y + (h - copy.height) // 2 + offset))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(14)))


def match_card(background, home, away, league_logo):
    """League background, home crest left, away crest right, the league's logo on a dark tile between."""
    canvas = cover_crop(background).convert('RGBA') if background else gradient((16, 38, 26, 255), (11, 20, 16, 255))
    for crest, x in ((home, 90), (away, 750)):
        box = (x, 135, 360, 360)
        if crest:
            shadow(canvas, crest, box)
            fit_inside(canvas, crest, box)
        else:
            dot = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
            ImageDraw.Draw(dot).ellipse((x + 60, 195, x + 300, 435), fill=(255, 255, 255, 36))
            canvas.alpha_composite(dot)
    draw = ImageDraw.Draw(canvas)
    if league_logo:
        draw.rounded_rectangle((495, 210, 705, 420), radius=38, fill=(11, 18, 64, 255))
        fit_inside(canvas, league_logo, (519, 234, 162, 162))
    else:
        draw.text((600, 315), 'VS', font=font(64), fill=(255, 255, 255, 255), anchor='mm', stroke_width=3, stroke_fill=(0, 0, 0, 200))
    return canvas


def channel_card(color, logo, name):
    """The channel's logo on its category colour, as its card; without a logo, its initials."""
    rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5)) if re.match(r'^#[0-9a-fA-F]{6}$', color or '') else (31, 79, 143)
    canvas = gradient(rgb + (255,), tuple(max(0, c * 55 // 100) for c in rgb) + (255,))
    if logo:
        fit_inside(canvas, logo, (300, 95, 600, 440))
    else:
        initials = ''.join(w[0] for w in str(name).split()[:2]).upper() or 'TV'
        text = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(text).text((600, 315), initials, font=font(220), fill=(255, 255, 255, 90), anchor='mm')
        canvas.alpha_composite(text)
    return canvas


def jpeg(canvas):
    """JPEG bytes small enough for WhatsApp."""
    picture = canvas.convert('RGB')
    for quality in (88, 80, 72, 64, 55):
        out = io.BytesIO()
        picture.save(out, 'JPEG', quality=quality, optimize=True, progressive=True)
        if out.tell() <= MAX_BYTES:
            break
    return out.getvalue()
