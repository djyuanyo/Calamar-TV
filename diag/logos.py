import json, urllib.request, urllib.parse
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
out = []
for c in data['channels']:
    logo = c.get('logo') or ''
    row = {'name': c.get('name'), 'group': c.get('group'), 'kind': 'none' if not logo else 'data' if logo.startswith('data:') else urllib.parse.urlsplit(logo).scheme}
    if logo.startswith('http'):
        p = urllib.parse.urlsplit(logo); row['host'] = p.hostname; row['path_end'] = p.path[-40:]
        for ref in (None, 'https://djyuanyo.github.io/'):
            h = {'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8'}
            if ref: h['Referer'] = ref
            try:
                r = urllib.request.urlopen(urllib.request.Request(logo, headers=h), timeout=15); b = r.read(400000)
                row['ref' if ref else 'plain'] = [r.status, r.headers.get('Content-Type'), len(b), r.geturl() != logo]
            except urllib.error.HTTPError as e: row['ref' if ref else 'plain'] = [e.code, e.headers.get('Content-Type')]
            except Exception as e: row['ref' if ref else 'plain'] = [str(e)[:60]]
    out.append(row)
open('diag/logos.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
