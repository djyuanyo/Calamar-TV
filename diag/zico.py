import json, urllib.request
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30))
sb = get('https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261025')
ev = [e for e in sb['events'] if e['status']['type']['state'] == 'post'][0]
s = get('https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=' + ev['id'])
out = {'event': ev['name'], 'id': ev['id'], 'rosterKeys': list(s['rosters'][0].keys()), 'formation': s['rosters'][0].get('formation')}
r = s['rosters'][0]['roster']
out['players'] = r[:3] + [p for p in r if p.get('subbedOut') or p.get('subbedIn')][:2]
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False)[:60000])
