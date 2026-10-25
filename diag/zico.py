import json, time, urllib.request, urllib.parse
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
out = []
for c in data['channels']:
    for i, s in enumerate(c.get('streams', [])):
        h = urllib.parse.urlsplit(s).hostname or ''
        if 'zico' not in h: continue
        row = {'channel': c['name'], 'option': i + 1, 'host': h, 'kind': urllib.parse.urlsplit(s).path.split('/')[1] if '/' in urllib.parse.urlsplit(s).path else ''}
        t = time.time()
        try:
            r = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-player.php?page=' + urllib.parse.quote(s, safe='') + '&hls=1',
                                                              headers={'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'}), timeout=40)
            b = r.read(200000); row['relay'] = [r.status, b[:7].decode('latin1')]
        except urllib.error.HTTPError as e:
            row['relay'] = [e.code, e.read(300).decode('utf-8', 'replace')]
        except Exception as e:
            row['relay'] = [str(e)[:80]]
        row['secs'] = round(time.time() - t, 1)
        out.append(row)
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
