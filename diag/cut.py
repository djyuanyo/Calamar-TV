# What each IPTV connection carries: its PCR time range (s), so we see overlap/gaps between consecutive ones.
import json, time, urllib.request
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
src = next(s for c in data['channels'] if c['name'] == 'Movistar Plus' for s in c['streams'] if s.startswith('http://'))
def info(body):
    pcrs, rai, pids, sync_off = [], 0, {}, 0
    i = 0
    while i < len(body) and body[i] != 0x47: i += 1
    sync_off = i
    while i + 188 <= len(body):
        p = body[i:i + 188]
        if p[0] != 0x47: i += 1; continue
        pid = ((p[1] & 0x1f) << 8) | p[2]; pids[pid] = pids.get(pid, 0) + 1
        if p[3] & 0x20 and p[4] > 0:
            flags = p[5]
            if flags & 0x40: rai += 1
            if flags & 0x10 and p[4] >= 7:
                base = (p[6] << 25) | (p[7] << 17) | (p[8] << 9) | (p[9] << 1) | (p[10] >> 7)
                pcrs.append(base / 90000)
        i += 188
    return {'bytes': len(body), 'sync_offset': sync_off, 'pcr_first': round(pcrs[0], 2) if pcrs else None,
            'pcr_last': round(pcrs[-1], 2) if pcrs else None, 'pcr_min': round(min(pcrs), 2) if pcrs else None,
            'pcr_max': round(max(pcrs), 2) if pcrs else None, 'random_access': rai, 'top_pids': sorted(pids.items(), key=lambda x: -x[1])[:4]}
out = []
for n in range(4):
    t = time.time()
    req = urllib.request.Request(src, headers={'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20'})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        body = b''
        while len(body) < 80_000_000 and time.time() - t < 60:
            chunk = r.read(65536)
            if not chunk: break
            body += chunk
        out.append({'n': n, 'start': round(t % 1000, 2), 'secs': round(time.time() - t, 2), **info(body)})
    except Exception as e:
        out.append({'n': n, 'error': type(e).__name__ + ' ' + str(getattr(e, 'code', ''))})
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
