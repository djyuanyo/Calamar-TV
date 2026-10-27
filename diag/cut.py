# Polymarket public data for football matches: endpoints, CORS and shape.
import json, urllib.request, urllib.error, urllib.parse
O = {'Origin': 'https://djyuanyo.github.io', 'User-Agent': 'Mozilla/5.0'}
def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=O), timeout=20)
        return r.status, r.headers.get('Access-Control-Allow-Origin'), json.loads(r.read(3_000_000))
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Access-Control-Allow-Origin'), e.read(300).decode('utf-8', 'replace')
    except Exception as e:
        return 0, None, repr(e)[:200]
out = {}
st, cors, d = get('https://gamma-api.polymarket.com/sports')
out['sports'] = {'status': st, 'cors': cors, 'sample': [ {k: x.get(k) for k in ('sport','tags','series','image')} for x in (d if isinstance(d, list) else [])][:40]}
st, cors, d = get('https://gamma-api.polymarket.com/public-search?q=' + urllib.parse.quote('Real Madrid') + '&limit_per_type=5')
out['search'] = {'status': st, 'cors': cors, 'events': [{k: e.get(k) for k in ('title','slug','startDate','endDate','closed','tags')} for e in (d.get('events', []) if isinstance(d, dict) else [])][:5], 'raw': d if not isinstance(d, dict) else None}
st, cors, d = get('https://gamma-api.polymarket.com/events?tag_slug=la-liga&closed=false&limit=5&order=startDate&ascending=true')
evs = d if isinstance(d, list) else []
out['laliga'] = {'status': st, 'cors': cors, 'count': len(evs)}
if evs:
    e = evs[0]
    out['laliga']['first'] = {k: e.get(k) for k in ('title','slug','startDate','endDate','gameStartTime','eventDate','seriesSlug')}
    out['laliga']['markets'] = [{k: m.get(k) for k in ('question','outcomes','outcomePrices','groupItemTitle','sportsMarketType','slug','volume')} for m in e.get('markets', [])][:8]
    out['laliga']['keys'] = sorted(e.keys())
open('diag/cut.json', 'w').write(json.dumps(out, indent=1, default=str)[:60000])
