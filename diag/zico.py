import json, urllib.request, urllib.error
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30))
out = {'matches': [], 'heads': []}
ids = []
for lg, d in (('esp.1', '20261025'), ('eng.1', '20261025'), ('uefa.champions', '20261022'), ('ita.1', '20261026')):
    try:
        sb = get(f'https://site.api.espn.com/apis/site/v2/sports/soccer/{lg}/scoreboard?dates={d}')
        ids += [e['id'] for e in sb['events'] if e['status']['type']['state'] == 'post'][:2]
    except Exception as e: out['matches'].append(repr(e))
abbrs = {}
for i in ids:
    s = get('https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=' + i)
    for r in s.get('rosters', []):
        st = sorted([p for p in r['roster'] if p.get('starter')], key=lambda p: int(p.get('formationPlace') or 99))
        out['matches'].append({'team': r['team']['displayName'], 'formation': r.get('formation'), 'xi': [(p.get('formationPlace'), p['position']['abbreviation'], p['athlete']['displayName']) for p in st]})
        for p in st[:3]:
            if len(out['heads']) < 12:
                u = f"https://a.espncdn.com/i/headshots/soccer/players/full/{p['athlete']['id']}.png"
                try: out['heads'].append([p['athlete']['displayName'], urllib.request.urlopen(urllib.request.Request(u, method='HEAD'), timeout=10).status])
                except urllib.error.HTTPError as e: out['heads'].append([p['athlete']['displayName'], e.code])
open('diag/zico.json', 'w').write(json.dumps(out, indent=0, ensure_ascii=False))
