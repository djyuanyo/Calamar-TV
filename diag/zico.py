import json, urllib.request
out = {}
for name, url in (('cast', 'https://calamarmenciano.com/calamar-cast.php?action=status&json=1'),):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30)
        out[name] = [r.status, r.read(2000).decode('utf-8', 'replace')]
    except urllib.error.HTTPError as e:
        out[name] = [e.code, e.read(500).decode('utf-8', 'replace')]
    except Exception as e:
        out[name] = [str(e)[:200]]
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
