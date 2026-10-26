# The real hosting relay (calamarmenciano.com) for 60 s: status, when bytes arrive, error text.
import base64, json, time, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
chan = next(c for c in data['channels'] if c['id'] == 'mio-movistar-mvhqvujf')
src = next(s for s in chan['streams'] if s.startswith('http://'))
out = {'channel': chan['name'], 'runs': []}
for attempt in range(2):
    req = urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers={
        'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
    t = time.time(); total = 0; marks = []; res = {}
    try:
        r = urllib.request.urlopen(req, timeout=40); res['status'] = r.status; res['ctype'] = r.headers.get('Content-Type')
        while time.time() - t < 60:
            chunk = r.read(65536)
            if not chunk: res['ended'] = True; break
            if total == 0: res['first_byte_s'] = round(time.time() - t, 2)
            total += len(chunk)
            if not marks or time.time() - t - marks[-1][0] >= 5: marks.append((round(time.time() - t, 1), total))
    except urllib.error.HTTPError as e:
        res['status'] = e.code; res['body'] = e.read(300).decode('utf-8', 'replace')
    except Exception as e:
        res['error'] = type(e).__name__ + ': ' + str(e)[:150]
    res.update({'secs': round(time.time() - t, 1), 'bytes': total, 'marks': marks})
    out['runs'].append(res)
    time.sleep(3)
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
