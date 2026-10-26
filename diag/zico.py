import json, socket, urllib.request
out = {'ips': sorted({a[4][0] for a in socket.getaddrinfo('calamarmenciano.com', 443)})}
r = urllib.request.urlopen(urllib.request.Request('https://calamarmenciano.com/calamar-cast.php?action=status&json=1', headers={'User-Agent': 'Mozilla/5.0'}), timeout=20)
out['status'] = r.status; out['server'] = r.headers.get('server'); out['cf'] = r.headers.get('cf-ray'); out['body'] = r.read(200).decode()
open('diag/zico.json', 'w').write(json.dumps(out, indent=1))
