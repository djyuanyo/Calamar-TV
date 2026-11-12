import json, re, urllib.request, urllib.error
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
out = {}
def get(url, headers=None, n=400000):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})}), timeout=25)
        return r.status, r.read(n).decode('utf-8', 'replace'), r.url
    except urllib.error.HTTPError as e:
        return e.code, e.read(300).decode('utf-8', 'replace'), url
    except Exception as e:
        return repr(e)[:120], '', url
for code in ('dab8pb27hxdg', 'zjmkh1lwsejz', 'll2hidg1m59q', 'shrtan7z8hmm', 'odql1gbzy42u', 'duj5ak4x5waa'):
    row = {}
    st, html, final = get(f'https://lulustream.com/e/{code}')
    row['page'] = [st, final, len(html), 'eval(function(p,a,c,k' in html, bool(re.search(r'\.m3u8', html))]
    m = re.search(r'https?://[^"\'\s]+\.m3u8[^"\'\s]*', html)
    if not m and 'eval(function(p,a,c,k' in html:
        # unpack p,a,c,k,e,d
        pm = re.search(r"\}\('(.*)',(\d+),(\d+),'(.*?)'\.split\('\|'\)", html, re.S)
        if pm:
            p, a, c, k = pm.group(1), int(pm.group(2)), int(pm.group(3)), pm.group(4).split('|')
            def base(n):
                d = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
                return (base(n // a) if n >= a else '') + d[n % a]
            src = re.sub(r'\b\w+\b', lambda w: k[int(w.group(0), 36)] if (lambda i: i < len(k) and k[i])(int(w.group(0), 36) if re.fullmatch(r'[0-9a-z]+', w.group(0)) else 10**9) else w.group(0), p)
            m = re.search(r'https?://[^"\'\s]+\.m3u8[^"\'\s]*', src)
    if m:
        u = m.group(0)
        row['m3u8_host'] = urllib.parse.urlsplit(u).hostname if hasattr(urllib, 'parse') else ''
        import urllib.parse
        row['m3u8_host'] = urllib.parse.urlsplit(u).hostname
        o = urllib.parse.urlsplit(final); st2, body, _ = get(u, {'Referer': f'{o.scheme}://{o.netloc}/', 'Origin': f'{o.scheme}://{o.netloc}'})
        row['master'] = [st2, body[:7]]
    st3, body3, _ = get(f'https://calamarmenciano.com/calamar-lulu.php?code={code}&hls=1', {'Origin': 'https://djyuanyo.github.io'})
    row['hosting'] = [st3, body3[:120]]
    out[code] = row
open('diag/zico.json', 'w').write(json.dumps(out, indent=1))
