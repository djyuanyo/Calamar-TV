# Only the relay's version on the hosting (no IPTV request).
import json, urllib.request
try: v = urllib.request.urlopen('https://calamarmenciano.com/calamar-tv-relay.php?version=1', timeout=20).read().decode()[:300]
except Exception as e: v = repr(e)[:300]
open('diag/cut.json', 'w').write(json.dumps({'version': v}))
