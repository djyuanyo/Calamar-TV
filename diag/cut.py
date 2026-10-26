# The hosting relay v4 for 30 s, as one more viewer of the shared connection: what it answers.
import base64, json, time, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
out = {}
try:
    out['version'] = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?version=1'), timeout=20).read().decode()
except Exception as e:
    out['version'] = repr(e)[:200]
chan = next(c for c in data['channels'] if c['id'] == 'mio-movistar-mvhqvujf')
src = next(s for s in chan['streams'] if s.startswith('http://'))
req = urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers={
    'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
t = time.time(); total = 0; marks = []; res = {}
try:
    r = urllib.request.urlopen(req, timeout=40); res['status'] = r.status; res['headers'] = dict(r.headers)
    while time.time() - t < 30:
        chunk = r.read(65536)
        if not chunk: res['ended'] = True; break
        if total == 0: res['first_byte_s'] = round(time.time() - t, 2); res['first_bytes'] = chunk[:8].hex()
        total += len(chunk)
        if not marks or time.time() - t - marks[-1][0] >= 3: marks.append((round(time.time() - t, 1), total))
except urllib.error.HTTPError as e:
    res['status'] = e.code; res['body'] = e.read(400).decode('utf-8', 'replace')
except Exception as e:
    res['error'] = type(e).__name__ + ': ' + str(e)[:200]
res.update({'secs': round(time.time() - t, 1), 'bytes': total, 'marks': marks})
out['stream'] = res
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
# run 10
