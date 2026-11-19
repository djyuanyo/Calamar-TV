import json, re, subprocess, time, urllib.request, urllib.parse, os
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
page = next(s for c in data['channels'] if 'federaci' in c['name'].lower() for s in c['streams'])
srv = subprocess.Popen(['php', '-S', '127.0.0.1:8099', '-t', 'diag/host'], env={**os.environ, 'CALAMAR_PLAYER_SECRET': 'x' * 40}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
out = []
def get(path, origin=True):
    h = {'Origin': 'https://djyuanyo.github.io'} if origin else {}
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8099/' + path, headers=h), timeout=60)
        body = r.read(3_000_000)
        return r.status, r.headers.get('Content-Type'), r.headers.get('Access-Control-Allow-Origin'), body, round(time.time() - t, 2)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type'), None, e.read(300), round(time.time() - t, 2)
st, ct, acao, body, sec = get('calamar-player.php?page=' + urllib.parse.quote(page, safe='') + '&hls=1')
out.append({'step': 'master', 'status': st, 'ctype': ct, 'acao': acao, 'secs': sec, 'starts': body[:7].decode('latin1'), 'lines': len(body.splitlines()),
            'leaks_zicotv': b'zicotv' in body, 'error': body.decode('utf-8', 'replace') if st != 200 else None})
def first(body):
    return next((l for l in body.decode().splitlines() if l and not l.startswith('#')), None)
if st == 200:
    nxt = first(body)
    st, ct, acao, body, sec = get(nxt)
    out.append({'step': 'variant', 'status': st, 'ctype': ct, 'acao': acao, 'secs': sec, 'lines': len(body.splitlines()), 'leaks_zicotv': b'zicotv' in body})
    if st == 200 and body.startswith(b'#EXTM3U'):
        seg = first(body)
        if seg and '.m3u8' in urllib.parse.unquote(seg):
            st, ct, acao, body, sec = get(seg); seg = first(body)
        st, ct, acao, body, sec = get(seg)
        out.append({'step': 'segment', 'status': st, 'ctype': ct, 'acao': acao, 'secs': sec, 'bytes': len(body), 'ts_sync': body[:1] == b'G'})
srv.terminate()
open('diag/relay.json', 'w').write(json.dumps(out, indent=1))
