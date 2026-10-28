import { writeFileSync } from 'node:fs';
const urls = ['https://anonmp4.art/v/ESuKsItGgV4rMAE', 'https://anonmp4.art/embed/ESuKsItGgV4rMAE', 'https://anonmp4api.xyz/info/ESuKsItGgV4rMAE'];
const out = [];
for (const url of urls) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
    const text = await r.text();
    out.push({ url, status: r.status, location: r.headers.get('location'), type: r.headers.get('content-type'), length: text.length, body: text.slice(-45000) });
  } catch (e) { out.push({ url, error: String(e.cause?.code || e.message) }); }
}
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
