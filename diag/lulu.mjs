import { writeFileSync } from 'node:fs';
const out = [];
const get = async (url, headers = {}) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', ...headers } });
    const type = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    const text = /mpegurl|text|xml|json/i.test(type) || buf.slice(0, 7).toString() === '#EXTM3U' ? buf.toString('utf8') : '';
    out.push({ url, status: r.status, type, length: buf.length, acao: r.headers.get('access-control-allow-origin'), lastModified: r.headers.get('last-modified'), cache: r.headers.get('cache-control'), body: text.slice(0, 1500), firstByte: buf[0] });
    return text;
  } catch (e) { out.push({ url, error: String(e.cause?.code || e.message) }); return ''; }
};
const list = 'https://7qd2b6je78ch5.s3.eu-north-1.amazonaws.com/hls/0/stream.m3u8';
const text = await get(list, { Origin: 'https://djyuanyo.github.io' });
const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
for (const l of lines.slice(-2)) await get(new URL(l, list).href, { Origin: 'https://djyuanyo.github.io' });
await new Promise((r) => setTimeout(r, 8000));
await get(list);
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
