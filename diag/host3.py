import urllib.parse
import json, urllib.request, urllib.error, datetime
UA = {'User-Agent': 'Mozilla/5.0', 'Origin': 'https://djyuanyo.github.io'}
def get(url, data=None, headers=UA, method=None):
    req = urllib.request.Request(url, data=data, headers={**headers, **({'Content-Type': 'text/plain'} if data else {})}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as r: return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf-8', 'replace'), dict(e.headers)
    except Exception as e: return -1, repr(e), {}
out = {}
s, b, h = get('https://calamarmenciano.com/calamar-votes.php?match=2026-10-30-villarreal-espanyol')
out['votes_get'] = [s, b[:300], h.get('Access-Control-Allow-Origin'), h.get('Content-Type')]
s, b, h = get('https://calamarmenciano.com/calamar-votes.php', data=json.dumps({'match': '2026-10-30-villarreal-espanyol', 'voter': 'x', 'pick': '9'}).encode())
out['votes_post_invalid'] = [s, b[:300]]
for f in ['votes.js', 'app.js', 'match-center.js', 'polymarket.js']:
    s, b, h = get('https://djyuanyo.github.io/Calamar-TV/' + f)
    out['pages_' + f] = [s, len(b), 'loadVotes' in b, 'votesCard' in b, 'fetchVotes' in b, h.get('Last-Modified'), h.get('Cache-Control')]
now = datetime.datetime.now(datetime.timezone.utc)
games = []
for league in ['esp.1', 'eng.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'esp.copa_del_rey', 'eng.league_cup', 'ger.dfb_pokal', 'ita.coppa_italia']:
    for d in [now - datetime.timedelta(days=1), now, now + datetime.timedelta(days=1)]:
        s, b, h = get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates={d:%Y%m%d}', headers={'User-Agent': 'Mozilla/5.0'})
        if s != 200: continue
        for e in json.loads(b).get('events', []):
            c = e['competitions'][0]; t = {x['homeAway']: x['team']['displayName'] for x in c['competitors']}
            games.append({'league': league, 'date': e['date'], 'home': t.get('home'), 'away': t.get('away'), 'state': e['status']['type']['state']})
seen = set(); games = [g for g in games if not (g['date'] + g['home'] in seen or seen.add(g['date'] + g['home']))]
def at(g): return datetime.datetime.fromisoformat(g['date'].replace('Z', '+00:00'))
pick = sorted(games, key=lambda g: abs((at(g) - now).total_seconds()))[:8]
out['lineups'] = []
for g in pick:
    q = urllib.parse.urlencode({'home': g['home'], 'away': g['away'], 'date': g['date'][:10]})
    s, b, h = get('https://calamarmenciano.com/calamar-lineups.php?' + q)
    try:
        j = json.loads(b); teams = j.get('teams') or {}
        summary = {'status': j.get('status'), 'error': j.get('error'), 'home': [len(teams.get('home', [])), sum(1 for p in teams.get('home', []) if p.get('photo'))], 'away': [len(teams.get('away', [])), sum(1 for p in teams.get('away', []) if p.get('photo'))]}
    except Exception: summary = b[:200]
    out['lineups'].append({**g, 'http': s, 'answer': summary})
json.dump(out, open('diag/host3.json', 'w'), indent=1, ensure_ascii=False)
