import json, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
out = []
for c in data['channels']:
    for s in c.get('streams', []):
        if 'zicotv' not in s: continue
        r = urllib.request.urlopen(urllib.request.Request(s, headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'}), timeout=20)
        h = {k.lower(): v for k, v in r.headers.items()}
        out.append({'channel': c['name'], 'status': r.status, 'x-frame-options': h.get('x-frame-options'), 'csp': (h.get('content-security-policy') or '')[:300], 'acao': h.get('access-control-allow-origin')})
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
