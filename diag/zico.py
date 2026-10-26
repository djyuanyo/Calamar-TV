import base64, json, re, time, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
H = {'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'}
out = {'log': []}
def log(**k): k['t'] = round(time.time() - T0, 1); out['log'].append(k)
T0 = time.time()
try:
    data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
    src = next(s for c in data['channels'] for s in c.get('streams', []) if '31.43.191.125' in s and s.endswith('/265'))
    hdr = dict(H, **{'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
    url = None
    for i in range(45):
        r = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-cast.php?action=start', headers=hdr), timeout=20)
        d = json.loads(r.read()); log(start=r.status, state=d.get('state'))
        if d.get('url'): url = d['url']; break
        time.sleep(1)
    while url and time.time() - T0 < 130:
        try:
            pl = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=20).read().decode()
            seq = int(re.search(r'#EXT-X-MEDIA-SEQUENCE:(\d+)', pl).group(1))
            durs = [float(x) for x in re.findall(r'#EXTINF:([\d.]+)', pl)]
            segs = re.findall(r'^(https://\S+)$', pl, re.M)
            t = time.time(); b = urllib.request.urlopen(urllib.request.Request(segs[-1], headers=H), timeout=30).read()
            log(seq=seq, n=len(durs), dur=durs[-1], seg_kb=len(b) // 1024, seg_s=round(time.time() - t, 2))
        except urllib.error.HTTPError as e:
            log(http=e.code, body=e.read(200).decode('utf-8', 'replace'))
        time.sleep(6)
except Exception as e:
    out['error'] = repr(e)[:300]
open('diag/zico.json', 'w').write(json.dumps(out, indent=0))
# run 1793002646
