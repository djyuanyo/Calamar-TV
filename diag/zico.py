import base64, json, re, time, urllib.request
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
H = {'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'}
out = {}
try:
    data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
    src = next(s for c in data['channels'] for s in c.get('streams', []) if s.startswith('http://31.43.191.125:8080/') and s.endswith('/244'))
    hdr = dict(H, **{'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
    # 1) The browser relay: how fast does video arrive (bytes in 20 s)?
    t = time.time(); n = 0
    try:
        r = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers=hdr), timeout=30)
        while time.time() - t < 20:
            b = r.read(65536)
            if not b: break
            n += len(b)
        r.close()
        out['relay'] = {'mbps': round(n * 8 / (time.time() - t) / 1e6, 2), 'bytes': n}
    except Exception as e:
        out['relay'] = str(e)[:200]
    time.sleep(3)
    # 2) The adapted HLS (FFmpeg on the hosting): does it make video as fast as real time?
    url = None; t0 = time.time()
    for i in range(40):
        r = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-cast.php?action=start', headers=hdr), timeout=20)
        d = json.loads(r.read())
        if d.get('url'): url = d['url']; break
        time.sleep(1)
    out['cast_ready_s'] = round(time.time() - t0, 1)
    if url:
        samples = []
        for i in range(8):
            pl = urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=20).read().decode()
            seq = int(re.search(r'#EXT-X-MEDIA-SEQUENCE:(\d+)', pl).group(1))
            durs = [float(x) for x in re.findall(r'#EXTINF:([\d.]+)', pl)]
            samples.append({'t': round(time.time() - t0, 1), 'seq': seq, 'segments': len(durs), 'last': durs[-1] if durs else None})
            time.sleep(8)
        out['cast'] = samples
        segs = re.findall(r'^(https://\S+)$', pl, re.M)
        if segs:
            t = time.time(); b = urllib.request.urlopen(urllib.request.Request(segs[-1], headers=H), timeout=30).read()
            out['segment'] = {'bytes': len(b), 's': round(time.time() - t, 2)}
except Exception as e:
    out['error'] = str(e)[:300]
open('diag/zico.json', 'w').write(json.dumps(out, indent=1))
