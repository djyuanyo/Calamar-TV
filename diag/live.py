import json, time, urllib.request, urllib.parse
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
page = next(s for c in data['channels'] if 'federaci' in c['name'].lower() for s in c['streams'])
BASE = 'https://calamarmenciano.com/'
out = []
def get(path):
    t = time.time()
    req = urllib.request.Request(BASE + path, headers={'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'})
    try:
        r = urllib.request.urlopen(req, timeout=60); body = r.read(2_000_000)
        return r.status, r.headers.get('Content-Type'), r.headers.get('Access-Control-Allow-Origin'), body, round(time.time() - t, 2)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type'), e.headers.get('Access-Control-Allow-Origin'), e.read(400), round(time.time() - t, 2)
    except Exception as e:
        return str(e)[:100], None, None, b'', round(time.time() - t, 2)
first = lambda b: next((l for l in b.decode('utf-8', 'replace').splitlines() if l and not l.startswith('#')), None)
st, ct, acao, body, s = get('calamar-player.php?page=' + urllib.parse.quote(page, safe='') + '&hls=1')
out.append({'step': 'master', 'status': st, 'ctype': ct, 'acao': acao, 'secs': s, 'leaks': b'zicotv' in body, 'body': body[:300].decode('utf-8', 'replace') if st != 200 else body[:7].decode()})
if st == 200:
    st, ct, acao, body, s = get(first(body))
    out.append({'step': 'variant', 'status': st, 'secs': s, 'lines': len(body.splitlines())})
    if st == 200:
        seg = first(body)
        st, ct, acao, body, s = get(seg)
        out.append({'step': 'segment', 'status': st, 'ctype': ct, 'acao': acao, 'secs': s, 'bytes': len(body), 'ts': body[:1] == b'G'})
open('diag/live.json', 'w').write(json.dumps(out, indent=1))
