# LuluStream API (with an invalid key): does it answer, how fast, with CORS? And the hosting relay.
import json, time, urllib.request, urllib.error, urllib.parse
def ask(url, data=None, headers=None):
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers or {}), timeout=40)
        return {'status': r.status, 'secs': round(time.time() - t, 2), 'cors': r.headers.get('Access-Control-Allow-Origin'), 'body': r.read(300).decode('utf-8', 'replace')}
    except urllib.error.HTTPError as e:
        return {'status': e.code, 'secs': round(time.time() - t, 2), 'cors': e.headers.get('Access-Control-Allow-Origin'), 'body': e.read(300).decode('utf-8', 'replace')}
    except Exception as e:
        return {'error': type(e).__name__ + ': ' + str(e)[:200], 'secs': round(time.time() - t, 2)}
o = {'Origin': 'https://djyuanyo.github.io'}
out = {
  'api_direct': ask('https://api.lulustream.com/api/folder/list?key=invalid&fld_id=0&files=1', headers=o),
  'api_account': ask('https://api.lulustream.com/api/account/info?key=invalid', headers=o),
  'hosting_relay': ask('https://calamarmenciano.com/calamar-lulu.php', data=urllib.parse.urlencode({'api': 'folder/list', 'fld_id': '0', 'files': '1', 'key': 'invalid'}).encode(),
                       headers={**o, 'Content-Type': 'application/x-www-form-urlencoded'}),
  'hosting_preflight': ask('https://calamarmenciano.com/calamar-lulu.php', headers=o),
}
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
