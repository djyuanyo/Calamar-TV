import base64, json, time, urllib.request, urllib.error
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
out = {}
def probe(name, req, n=200000):
    t = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=25); b = r.read(n)
        out[name] = {'status': r.status, 'bytes': len(b), 'ts': b[:1] == b'G', 's': round(time.time() - t, 1), 'type': r.headers.get('content-type')}
    except urllib.error.HTTPError as e:
        out[name] = {'status': e.code, 'body': e.read(200).decode('utf-8', 'replace'), 's': round(time.time() - t, 1)}
    except Exception as e:
        out[name] = {'error': repr(e)[:200], 's': round(time.time() - t, 1)}
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
iptv = [s for c in data['channels'] for s in c.get('streams', []) if '31.43.191.125' in s]
other = [s for c in data['channels'] for s in c.get('streams', []) if 'streamhostingcdn' in s]
probe('provider_direct', urllib.request.Request(iptv[0], headers={'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20'}))
probe('provider_direct_2', urllib.request.Request(iptv[5], headers={'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20'}))
probe('relay', urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers={'Origin': 'https://djyuanyo.github.io', 'X-Calamar-Source': base64.b64encode(iptv[0].encode()).decode()}))
probe('relay_no_source', urllib.request.Request('https://calamarmenciano.com/calamar-tv-relay.php?stream=1', headers={'Origin': 'https://djyuanyo.github.io'}))
probe('cast_status', urllib.request.Request('https://calamarmenciano.com/calamar-cast.php?action=status&json=1'))
if other: probe('other_direct', urllib.request.Request(other[0], headers={'User-Agent': 'Mozilla/5.0'}), 3000)
open('diag/zico.json', 'w').write(json.dumps(out, indent=1))
