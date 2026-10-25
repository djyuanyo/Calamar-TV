import json, re, time, urllib.request, urllib.parse
CAT = 'https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarCatalog/custom'
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
data = json.loads(json.load(urllib.request.urlopen(CAT, timeout=20))['fields']['json']['stringValue'])

def get(url, ref=None):
    h = {'User-Agent': UA}
    if ref:
        p = urllib.parse.urlsplit(ref); h['Referer'] = ref; h['Origin'] = p.scheme + '://' + p.netloc
    r = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=20)
    return r.status, r.read(400000).decode('utf-8', 'replace'), r.url

def shape(url):
    """Host, path shape and query: names only, numbers that look like epochs as seconds from now."""
    u = urllib.parse.urlsplit(url); q = []
    for k, v in urllib.parse.parse_qsl(u.query, keep_blank_values=True):
        m = re.findall(r'(?<!\d)(1[6-9]\d{8})(?!\d)', v)
        q.append(k + ('=epoch%+ds' % (int(m[0]) - time.time()) if m else '=<%d chars>' % len(v)))
    return {'host': u.hostname, 'path': re.sub(r'[A-Za-z0-9_-]{16,}', '<id>', u.path), 'query': q}

out = []
for c in data['channels']:
    for i, s in enumerate(c.get('streams', [])):
        if 'zico' not in (urllib.parse.urlsplit(s).hostname or ''): continue
        row = {'channel': c['name'], 'option': i + 1, 'page': shape(s)}
        try:
            st, html, final = get(s)
            m = re.search(r'ZT_SOURCES\s*=\s*(\[.*?\]);', html, re.S)
            srcs = json.loads(m.group(1)) if m else []
            row['sources'] = []
            for src in srcs[:6]:
                url = urllib.parse.urljoin(final, src.get('url', ''))
                item = {'label': src.get('label'), 'locked': src.get('locked'), **shape(url)}
                if not src.get('locked') and '.m3u8' in url:
                    try:
                        st2, body, at = get(url, final)
                        lines = body.splitlines()
                        item['list'] = [l if l.startswith('#') else '<uri> ' + json.dumps(shape(urllib.parse.urljoin(at, l))) for l in lines[:14]]
                        uris = [l for l in lines if l and not l.startswith('#')]
                        if uris and '#EXT-X-STREAM-INF' in body:
                            st3, media, at3 = get(urllib.parse.urljoin(at, uris[0]), final)
                            ml = media.splitlines()
                            item['media'] = [l if l.startswith('#') else '<uri> ' + json.dumps(shape(urllib.parse.urljoin(at3, l))) for l in ml[:12]]
                    except Exception as e:
                        item['list'] = ['error ' + str(e)[:100]]
                row['sources'].append(item)
        except Exception as e:
            row['error'] = str(e)[:120]
        out.append(row)
open('diag/zico.json', 'w').write(json.dumps(out, indent=1, ensure_ascii=False))
