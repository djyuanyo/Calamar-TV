# The hosting relay v6 for 30 s with the catalog channel whose link ends in /265 (link never written).
import base64, json, subprocess, time, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
found = [(c['name'], s) for c in data['channels'] for s in c.get('streams', []) if s.startswith('http://') and s.rstrip('/').endswith('/265')]
out = {'channel': found[0][0] if found else None}
if found:
    src = found[0][1]
    req = urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers={
        'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(src.encode()).decode()})
    t = time.time(); total = 0; marks = []; res = {}
    try:
        r = urllib.request.urlopen(req, timeout=40); res['status'] = r.status; res['ctype'] = r.headers.get('Content-Type')
        body = bytearray()
        while time.time() - t < 12:
            chunk = r.read(65536)
            if not chunk: res['ended'] = True; break
            if total == 0: res['first_byte_s'] = round(time.time() - t, 2)
            total += len(chunk); body += chunk
            if not marks or time.time() - t - marks[-1][0] >= 3: marks.append((round(time.time() - t, 1), total))
    except urllib.error.HTTPError as e:
        res['status'] = e.code; res['body'] = e.read(400).decode('utf-8', 'replace')
    except Exception as e:
        res['error'] = type(e).__name__ + ': ' + str(e)[:200]
    res.update({'secs': round(time.time() - t, 1), 'bytes': total, 'marks': marks})
    out['stream'] = res
    open('/tmp/s.ts', 'wb').write(body)
    p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,profile,width,height,pix_fmt,field_order', '-of', 'json', '/tmp/s.ts'], capture_output=True, text=True)
    out['probe'] = p.stdout[-1500:] + p.stderr[-500:]
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
