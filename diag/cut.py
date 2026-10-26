# How long one IPTV connection lasts: straight from GitHub, and through the hosting's relay.
import base64, json, re, subprocess, time, urllib.request
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
src = next(s for c in data['channels'] if c['name'] == 'Movistar Plus' for s in c['streams'] if s.startswith('http://'))
def run(args):
    t = time.time()
    p = subprocess.run(['curl', '-sS', '-o', '/dev/null', '--max-time', '100', '-w', '%{http_code} %{size_download} %{content_type}'] + args,
                       capture_output=True, text=True)
    err = re.sub(r'https?://\S+', '<url>', p.stderr.strip())[:200]
    return {'secs': round(time.time() - t, 1), 'curl_exit': p.returncode, 'out': p.stdout, 'err': err}
out = {}
out['direct_vlc_ua'] = run(['-A', 'VLC/3.0.20 LibVLC/3.0.20', src])
time.sleep(3)
out['relay'] = run(['-H', 'Origin: https://djyuanyo.github.io', '-H', 'X-Calamar-Source: ' + base64.b64encode(src.encode()).decode(),
                    'https://calamarmenciano.com/calamar-tv-relay.php?stream=1'])
time.sleep(3)
out['relay_http11'] = run(['--http1.1', '-H', 'Origin: https://djyuanyo.github.io', '-H', 'X-Calamar-Source: ' + base64.b64encode(src.encode()).decode(),
                    'https://calamarmenciano.com/calamar-tv-relay.php?stream=1'])
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
