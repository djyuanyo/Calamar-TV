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
