# What zicotv answers to an app (no browser): the event API and a player page (only structure, no tokens).
import json, re, time, urllib.request, urllib.error
UA = {'Chrome': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'okhttp': 'okhttp/4.12.0'}
def get(url, ua):
    t = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': ua, 'Accept': '*/*'}), timeout=20)
        body = r.read(400000).decode('utf-8', 'replace'); return r.status, body, round(time.time() - t, 2)
    except urllib.error.HTTPError as e:
        return e.code, e.read(3000).decode('utf-8', 'replace'), round(time.time() - t, 2)
    except Exception as e:
        return 0, repr(e)[:200], round(time.time() - t, 2)
out = {}
for name, ua in UA.items():
    st, body, s = get('https://bp.zicotv.cc/api/v1/events/97986', ua)
    srcs = []
    try:
        for x in json.loads(body)['data'].get('sources', []): srcs.append({'name': x.get('name'), 'locked': x.get('locked'), 'premium': x.get('is_premium'), 'player': re.sub(r'[?#].*', '', str(x.get('player_url') or x.get('url')))})
    except Exception as e: srcs = str(e)[:100] + ' ' + body[:200]
    out[f'event_{name}'] = {'status': st, 'secs': s, 'sources': srcs}
    st, body, s = get('https://zicotv.cc/api/player/4', ua)
    m = re.search(r'ZT_SOURCES\s*=\s*\[', body)
    out[f'player_{name}'] = {'status': st, 'secs': s, 'has_ZT_SOURCES': bool(m), 'm3u8_count': len(re.findall(r'\.m3u8', body)), 'cloudflare': 'cf-chl' in body or 'Just a moment' in body, 'head': body[:160] if not m else ''}
open('diag/cut.json', 'w').write(json.dumps(out, indent=1))
