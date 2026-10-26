import json, re, urllib.request, urllib.error
out = {}
url = 'https://djyuanyo.github.io/Calamar-TV/evento/shakhtar-donetsk-vs-sporting-cp/'
try:
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'WhatsApp/2.23.20.0'}), timeout=20)
    html = r.read().decode('utf-8', 'replace'); out['status'] = r.status
    out['og'] = re.findall(r'<meta property="og:[^>]+>', html)[:8]
    img = re.search(r'property="og:image" content="([^"]+)"', html)
    if img:
        i = urllib.request.urlopen(img.group(1), timeout=20); b = i.read(); out['image'] = [i.status, i.headers.get('content-type'), len(b)]
except urllib.error.HTTPError as e:
    out['status'] = e.code; out['body'] = e.read(300).decode('utf-8', 'replace')
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
