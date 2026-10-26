import json, urllib.request
s = json.load(urllib.request.urlopen(urllib.request.Request('https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401882835', headers={'User-Agent': 'Mozilla/5.0'}), timeout=30))
keep = {k: s[k] for k in ('header', 'rosters', 'boxscore', 'keyEvents', 'gameInfo') if k in s}
open('diag/zico.json', 'w').write(json.dumps(keep, ensure_ascii=False))
