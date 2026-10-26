# How long one IPTV connection lasts: straight from GitHub, and through the hosting's relay.
import base64, json, re, subprocess, time, urllib.request
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])
src = next(s for c in data['channels'] if c['name'] == 'Movistar Plus' for s in c['streams'] if s.startswith('http://'))
def run(args):
    t = time.time()
    p = subprocess.run(['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code} %{size_download} %{content_type}'] + args,
                       capture_output=True, text=True)
    err = re.sub(r'https?://\S+', '<url>', p.stderr.strip())[:200]
    return {'secs': round(time.time() - t, 1), 'curl_exit': p.returncode, 'out': p.stdout, 'err': err}
out = {}
srv = subprocess.Popen(['php', '-S', '127.0.0.1:8099', '-t', 'diag/host2'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
local = ['-H', 'Origin: https://djyuanyo.github.io', '-H', 'X-Calamar-Source: ' + base64.b64encode(src.encode()).decode(),
         'http://127.0.0.1:8099/calamar-tv-relay.php?stream=1']
out['new_relay_realtime_90s'] = run(['--limit-rate', '700k', '--max-time', '90'] + local)
srv.terminate()
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
