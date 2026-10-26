import json, time, urllib.request, urllib.parse, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
out = []
for c in data['channels']:
    for s in c.get('streams', []):
        if 'zicotv' not in s: continue
        row = {'channel': c['name']}
        try:
            r = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-player.php?page=' + urllib.parse.quote(s, safe='') + '&hls=1', headers={'Origin': 'https://djyuanyo.github.io'}), timeout=40)
            row['hosting'] = [r.status, r.read(7).decode('latin1')]
        except urllib.error.HTTPError as e:
            row['hosting'] = [e.code, e.read(200).decode('utf-8', 'replace')]
        try:
            r = urllib.request.urlopen(urllib.request.Request(s, headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'}), timeout=20)
            row['direct'] = r.status
        except urllib.error.HTTPError as e:
            row['direct'] = e.code
        except Exception as e:
            row['direct'] = repr(e)[:80]
        out.append(row)
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
