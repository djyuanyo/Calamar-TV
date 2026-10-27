import json, urllib.request, urllib.error, datetime
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=25) as r: return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e: return -1, repr(e)
out = []
for league in ['esp.copa_del_rey', 'ita.1', 'eng.league_cup', 'esp.1']:
    s, b = get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard')
    if s != 200: out.append({'league': league, 'http': s}); continue
    for e in json.loads(b).get('events', [])[:8]:
        s2, b2 = get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={e["id"]}')
        s3, b3 = get(f'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/summary?event={e["id"]}')
        info = {'league': league, 'id': e['id'], 'name': e['name'], 'state': e['status']['type']['state'], 'http_league': s2, 'http_all': s3}
        try:
            j = json.loads(b3 if s3 == 200 else b2)
            info['stats'] = [len(t.get('statistics', [])) for t in j.get('boxscore', {}).get('teams', [])]
            info['keyEvents'] = len(j.get('keyEvents', []))
            info['rosters'] = [len(r.get('roster', [])) for r in j.get('rosters', [])]
        except Exception as x: info['parse'] = repr(x)[:100]
        out.append(info)
json.dump(out, open('diag/host3.json', 'w'), indent=1, ensure_ascii=False)
