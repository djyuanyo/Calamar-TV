import json, time, urllib.request, urllib.parse
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
H = {'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'}
out = []
try:
    data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
    pages = [(c['name'], s) for c in data['channels'] for s in c.get('streams', []) if 'zicotv.cc/api' in s][:4]
except Exception as e:
    pages = []; out.append({'catalog': str(e)[:200]})
def get(url):
    t = time.time(); r = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60); b = r.read(); return b, round(time.time() - t, 2)
for name, page in pages:
    row = {'channel': name}
    try:
        base = 'https://calamarmenciano.com/calamar-player.php'
        master, row['master_s'] = get(base + '?page=' + urllib.parse.quote(page, safe='') + '&hls=1')
        lines = [l for l in master.decode().splitlines() if l and not l.startswith('#')]
        media, row['media_s'] = get(urllib.parse.urljoin(base, lines[0]))
        segs = [l for l in media.decode().splitlines() if l and not l.startswith('#')]
        row['segments'] = []
        for s in segs[-3:]:
            b, secs = get(urllib.parse.urljoin(base, s))
            row['segments'].append({'bytes': len(b), 's': secs, 'mbps': round(len(b) * 8 / secs / 1e6, 1)})
    except urllib.error.HTTPError as e:
        row['error'] = [e.code, e.read(300).decode('utf-8', 'replace')]
    except Exception as e:
        row['error'] = str(e)[:200]
    out.append(row)
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
