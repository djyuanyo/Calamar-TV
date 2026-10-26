# The real hosting relay for 60 s: version, rate, clock continuity and decode errors.
import base64, json, subprocess, time, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
chan = next(c for c in data['channels'] if c['id'] == 'mio-movistar-mvhqvujf')
src = next(s for s in chan['streams'] if s.startswith('http://'))
req = urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers={
    'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
t = time.time(); body = bytearray(); marks = []; res = {}
try:
    r = urllib.request.urlopen(req, timeout=40); res['status'] = r.status; res['version'] = r.headers.get('X-Calamar-Relay')
    while time.time() - t < 60:
        chunk = r.read(65536)
        if not chunk: res['ended'] = True; break
        if not body: res['first_byte_s'] = round(time.time() - t, 2)
        body += chunk
        if not marks or time.time() - t - marks[-1][0] >= 5: marks.append((round(time.time() - t, 1), len(body)))
except urllib.error.HTTPError as e:
    res['status'] = e.code; res['body'] = e.read(300).decode('utf-8', 'replace')
except Exception as e:
    res['error'] = type(e).__name__ + ': ' + str(e)[:150]
pcrs = []
for i in range(0, len(body) - 187, 188):
    p = body[i:i + 188]
    if p[0] == 0x47 and p[3] & 0x20 and p[4] >= 7 and p[5] & 0x10:
        pcrs.append(((p[6] << 25) | (p[7] << 17) | (p[8] << 9) | (p[9] << 1) | (p[10] >> 7)) / 90000)
open('/tmp/out.ts', 'wb').write(body)
p = subprocess.run(['ffmpeg', '-v', 'error', '-i', '/tmp/out.ts', '-f', 'null', '-'], capture_output=True, text=True)
lines = [l for l in p.stderr.splitlines() if l.strip()]
res.update({'secs': round(time.time() - t, 1), 'bytes': len(body), 'marks': marks,
            'misaligned': sum(1 for i in range(0, len(body) - 187, 188) if body[i] != 0x47),
            'pcr_first': round(pcrs[0], 2) if pcrs else None, 'pcr_last': round(pcrs[-1], 2) if pcrs else None,
            'backward': [(round(a, 2), round(b, 2)) for a, b in zip(pcrs, pcrs[1:]) if b < a][:8],
            'gaps_over_1s': [(round(a, 2), round(b, 2)) for a, b in zip(pcrs, pcrs[1:]) if b - a > 1][:8],
            'decode_errors': len(lines), 'decode_sample': sorted(set(l.split('] ')[-1][:80] for l in lines))[:6]})
open('diag/cut.json', 'w').write(json.dumps(res, indent=1))
