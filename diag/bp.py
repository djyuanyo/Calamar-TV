import json, re, urllib.request, urllib.parse
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
def host(u):
    try: return urllib.parse.urlsplit(u).hostname
    except Exception: return '?'
def fetch(u, ref=None):
    h = {'User-Agent': UA, 'Accept': '*/*'}
    if ref: h['Referer'] = ref
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=20)
        return r.status, r.geturl(), r.read(3_000_000).decode('utf-8', 'replace'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, u, e.read(2000).decode('utf-8', 'replace'), dict(e.headers)
out = {}
st, final, html, hdr = fetch('https://bp.zicotv.cc/channels/42898')
out['status'] = st; out['final'] = host(final); out['ctype'] = hdr.get('Content-Type'); out['len'] = len(html)
out['title'] = (re.search(r'<title>(.*?)</title>', html, re.S) or [None, None])[1]
for k in ('ZT_SOURCES', 'm3u8', '.mpd', 'clappr', 'Clappr', 'hls', 'jwplayer', 'videojs', 'shaka', 'atob(', 'fetch(', 'XMLHttpRequest', 'api/', 'token', 'eval(function(p,a,c,k'):
    out[k] = html.count(k)
out['iframes'] = [urllib.parse.urljoin(final, f) for f in re.findall(r'<iframe\b[^>]*\bsrc\s*=\s*["\']([^"\']+)', html, re.I)][:5]
out['scripts'] = [urllib.parse.urljoin(final, s) for s in re.findall(r'<script\b[^>]*\bsrc\s*=\s*["\']([^"\']+)', html, re.I)][:15]
out['m3u8_urls_hosts'] = sorted({host(m) for m in re.findall(r'https?://[^"\'\s<>]+?\.m3u8', html.replace('\\/', '/'))})
# Paths of API calls in inline scripts, without query values.
out['api_like'] = sorted({re.sub(r'\?.*', '', m) for m in re.findall(r'["\'](/[a-zA-Z0-9_\-/]*(?:api|stream|play|source|channel)[a-zA-Z0-9_\-/]*)["\']', html)})[:20]
inline = re.findall(r'<script\b[^>]*>(.*?)</script>', html, re.S)
out['inline_sizes'] = [len(s) for s in inline][:15]
# Snippets around "m3u8" / "source" with any URL query stripped.
snips = []
for m in re.finditer(r'm3u8|sources?\s*[:=]|ZT_SOURCES|channel', html):
    s = html[max(0, m.start() - 160): m.end() + 160]
    s = re.sub(r'\?[^"\'\s]*', '?…', s)
    snips.append(s)
    if len(snips) >= 8: break
out['snippets'] = snips
for i, f in enumerate(out['iframes'][:2]):
    s2, f2, h2, _ = fetch(f, final)
    out[f'iframe{i}'] = {'status': s2, 'host': host(f2), 'len': len(h2), 'ZT': h2.count('ZT_SOURCES'), 'm3u8': h2.count('m3u8'), 'hosts': sorted({host(m) for m in re.findall(r'https?://[^"\'\s<>]+?\.m3u8', h2.replace('\\/', '/'))})}
open('diag/bp.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
