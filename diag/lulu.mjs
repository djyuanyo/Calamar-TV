import { writeFileSync } from 'node:fs';
const urls = [
  'https://lulustream.com/', 'https://luluvido.com/', 'https://www.luluvido.com/',
  'https://api.lulustream.com/api/account/info?key=x', 'https://api.luluvido.com/api/account/info?key=x', 'https://luluvido.com/api/account/info?key=x',
  'https://lulustream.com/e/duj5ak4x5waa', 'https://luluvido.com/e/duj5ak4x5waa', 'https://luluvido.com/d/duj5ak4x5waa', 'https://luluvdo.com/e/duj5ak4x5waa',
];
const out = [];
for (const url of urls) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
    const text = await r.text();
    out.push({ url, status: r.status, location: r.headers.get('location'), body: text.slice(0, 400), m3u8: /\.m3u8/.test(text), sources: (text.match(/sources\s*:\s*\[[^\]]{0,200}/) || [''])[0].slice(0, 200) });
  } catch (e) { out.push({ url, error: String(e.cause?.code || e.message) }); }
}
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
