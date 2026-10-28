import { writeFileSync } from 'node:fs';
const out = [];
let url = 'https://share.google/DJd1zj8nhTStnCTTd';
for (let i = 0; i < 6 && url; i++) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
    const loc = r.headers.get('location');
    out.push({ url, status: r.status, location: loc });
    url = loc ? new URL(loc, url).href : null;
  } catch (e) { out.push({ url, error: String(e.message) }); break; }
}
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
