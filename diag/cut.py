# The new relay against the real channel for 90 s: is its output one continuous, forward-moving clock?
import base64, json, subprocess, time, urllib.request
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
src = next(s for c in data['channels'] if c['name'] == 'Movistar Plus' for s in c['streams'] if s.startswith('http://'))
srv = subprocess.Popen(['php', '-S', '127.0.0.1:8099', '-t', 'diag/host2'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
req = urllib.request.Request('http://127.0.0.1:8099/calamar-tv-relay.php?stream=1', headers={
    'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
t = time.time(); body = bytearray(); marks = []; status = None
try:
    r = urllib.request.urlopen(req, timeout=40); status = r.status
    while time.time() - t < 90:
        chunk = r.read(65536)
        if not chunk: break
        body += chunk
        marks.append((round(time.time() - t, 1), len(body)))
except Exception as e:
    status = type(e).__name__
srv.terminate()
pcrs = []
for i in range(0, len(body) - 187, 188):
    p = body[i:i + 188]
    if p[0] != 0x47: continue
    if p[3] & 0x20 and p[4] >= 7 and p[5] & 0x10:
        pcrs.append(((p[6] << 25) | (p[7] << 17) | (p[8] << 9) | (p[9] << 1) | (p[10] >> 7)) / 90000)
back = [(round(a, 2), round(b, 2)) for a, b in zip(pcrs, pcrs[1:]) if b < a]
gaps = [(round(a, 2), round(b, 2)) for a, b in zip(pcrs, pcrs[1:]) if b - a > 1]
every10 = [m for m in marks if int(m[0]) % 10 == 0][::max(1, len(marks) // 20)]
out = {'status': status, 'secs': round(time.time() - t, 1), 'bytes': len(body), 'misaligned': sum(1 for i in range(0, len(body) - 187, 188) if body[i] != 0x47),
       'pcr_first': round(pcrs[0], 2) if pcrs else None, 'pcr_last': round(pcrs[-1], 2) if pcrs else None,
       'backward_jumps': back[:10], 'n_backward': len(back), 'gaps_over_1s': gaps[:10], 'progress': every10}
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
