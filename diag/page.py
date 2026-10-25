import json, re, urllib.request, urllib.parse, os
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
out = []
def host(u):
    try: return urllib.parse.urlsplit(u).hostname
    except Exception: return '?'
def mask(u):
    p = urllib.parse.urlsplit(u); return f'{p.scheme}://{p.hostname}/…{os.path.splitext(p.path)[1]}'
def fetch(u, ref=None):
    h = {'User-Agent': UA, 'Accept': 'text/html,*/*'}
    if ref: h['Referer'] = ref
    r = urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=20)
    return r.status, r.geturl(), r.read(3_000_000).decode('utf-8', 'replace'), dict(r.headers)
def analyse(html, base, depth=0):
    info = {'len': len(html), 'm3u8': len(re.findall(r'\.m3u8', html)), 'mpd': len(re.findall(r'\.mpd', html)), 'mp4': len(re.findall(r'\.mp4', html)),
            'zt': 'ZT_SOURCES' in html, 'packed': bool(re.search(r"eval\(function\(p,a,c,k,e", html)), 'video_tag': bool(re.search(r'<(video|source)\b[^>]*src', html, re.I)),
            'file_key': len(re.findall(r'\bfile\s*:', html)), 'atob': html.count('atob('), 'clappr': 'clappr' in html.lower(), 'jw': 'jwplayer' in html.lower(),
            'hls_js': 'hls.js' in html.lower() or 'hls.min.js' in html.lower(), 'videojs': 'video.js' in html.lower() or 'videojs' in html.lower()}
    info['m3u8_hosts'] = sorted({host(m) for m in re.findall(r'https?://[^"\'\s<>]+?\.m3u8', html.replace('\\/', '/'))})
    frames = re.findall(r'<iframe\b[^>]*\bsrc\s*=\s*["\']([^"\']+)', html, re.I)
    info['iframes'] = [host(urllib.parse.urljoin(base, f)) for f in frames][:5]
    if depth < 2:
        info['children'] = []
        for f in frames[:3]:
            u = urllib.parse.urljoin(base, f)
            try:
                s, final, h2, _ = fetch(u, base)
                info['children'].append({'host': host(final), 'status': s, **analyse(h2, final, depth + 1)})
            except Exception as e:
                info['children'].append({'host': host(u), 'error': str(e)[:120]})
    return info
for c in data.get('channels', []):
    if 'federaci' not in c.get('name', '').lower(): continue
    for s in c.get('streams', []):
        row = {'channel': c['name'], 'link': mask(s)}
        try:
            st, final, html, hdr = fetch(s)
            row.update({'status': st, 'final': host(final), 'ctype': hdr.get('Content-Type'), **analyse(html, final)})
        except Exception as e:
            row['error'] = str(e)[:200]
        out.append(row)
open('diag/page.json', 'w').write(json.dumps(out, indent=1))

# Sources and whether a browser could read them (CORS) or needs the hosting.
def zt(html):
    m = re.search(r'\b(?:var|let|const)\s+ZT_SOURCES\s*=\s*(\[)', html)
    if not m: return []
    i, depth, q, esc = m.start(1), 0, False, False
    for j in range(i, len(html)):
        ch = html[j]
        if q:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == '"': q = False
        elif ch == '"': q = True
        elif ch == '[': depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0: return json.loads(html[i:j + 1])
    return []
def get(u, headers):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=headers), timeout=20)
        return r.status, dict(r.headers), r.read(400_000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), ''
    except Exception as e:
        return str(e)[:80], {}, ''
report = []
for c in data.get('channels', []):
    if 'federaci' not in c.get('name', '').lower(): continue
    st, final, html, _ = fetch(c['streams'][0])
    sources = zt(html)
    report.append({'sources': [{'label': s.get('label'), 'locked': s.get('locked'), 'link': mask(urllib.parse.urljoin(final, s.get('url', ''))), 'keys': sorted(s.keys())} for s in sources]})
    for s in [s for s in sources if not s.get('locked')][:3]:
        u = urllib.parse.urljoin(final, s['url'])
        row = {'link': mask(u)}
        for name, h in (('plain', {'User-Agent': UA}), ('browser-origin', {'User-Agent': UA, 'Origin': 'https://djyuanyo.github.io', 'Referer': 'https://djyuanyo.github.io/'}),
                        ('page-referer', {'User-Agent': UA, 'Referer': final, 'Origin': 'https://zicotv.cc'})):
            code, hdr, body = get(u, h)
            lines = [l for l in body.splitlines() if l and not l.startswith('#')]
            row[name] = {'status': code, 'acao': hdr.get('Access-Control-Allow-Origin') or hdr.get('access-control-allow-origin'), 'ctype': hdr.get('Content-Type'),
                         'variant': '#EXT-X-STREAM-INF' in body, 'key': '#EXT-X-KEY' in body, 'n': len(lines), 'first_ext': os.path.splitext(urllib.parse.urlsplit(urllib.parse.urljoin(u, lines[0])).path)[1] if lines else None,
                         'same_host': (host(urllib.parse.urljoin(u, lines[0])) == host(u)) if lines else None, 'token_in_query': bool(urllib.parse.urlsplit(u).query)}
            if name == 'page-referer' and lines:
                child = urllib.parse.urljoin(u, lines[0])
                c2, h2, b2 = get(child, h)
                row['child'] = {'status': c2, 'acao': h2.get('Access-Control-Allow-Origin'), 'ctype': h2.get('Content-Type'), 'len': len(b2)}
                cp, hp, _ = get(child, {'User-Agent': UA})
                row['child_plain'] = cp
        report.append(row)
open('diag/sources.json', 'w').write(json.dumps(report, indent=1))
