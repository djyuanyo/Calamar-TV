import json, urllib.request, urllib.error, datetime
O = {'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'}
def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=O), timeout=20); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, e.read(300).decode('utf-8', 'replace')
out = {}
st, d = get('https://gamma-api.polymarket.com/events?series_id=10193&closed=false&limit=4&order=startDate&ascending=true')
evs = d if isinstance(d, list) else []
out['lal'] = []
for e in evs[:3]:
    out['lal'].append({'title': e.get('title'), 'slug': e.get('slug'), 'startDate': e.get('startDate'), 'endDate': e.get('endDate'), 'gameStartTime': e.get('gameStartTime'),
        'eventMetadata': e.get('eventMetadata'), 'teams': e.get('teams'), 'url': 'https://polymarket.com/event/' + str(e.get('slug')),
        'markets': [{k: m.get(k) for k in ('question','outcomes','outcomePrices','groupItemTitle','sportsMarketType','gameStartTime','volume','closed','active')} for m in e.get('markets', [])][:6]})
day = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
st, d = get(f'https://gamma-api.polymarket.com/events?tag_id=100350&closed=false&limit=40&end_date_min={day}T00:00:00Z&end_date_max={day}T23:59:59Z')
out['soccer_tomorrow'] = {'status': st, 'count': len(d) if isinstance(d, list) else d, 'titles': [ (e.get('title'), e.get('seriesSlug'), e.get('endDate')) for e in (d if isinstance(d, list) else [])][:40]}
open('diag/cut.json', 'w').write(json.dumps(out, indent=1, default=str)[:60000])
