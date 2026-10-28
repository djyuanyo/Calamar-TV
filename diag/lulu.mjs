import { writeFileSync } from 'node:fs';
const out = [];
for (const url of ['https://anonmp4.art/embed/ESuKsItGgV4rMAE']) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36', Referer: 'https://djyuanyo.github.io/', 'Sec-Fetch-Dest': 'iframe' } });
    out.push({ url, status: r.status, xfo: r.headers.get('x-frame-options'), csp: r.headers.get('content-security-policy'), coep: r.headers.get('cross-origin-embedder-policy'), corp: r.headers.get('cross-origin-resource-policy') });
  } catch (e) { out.push({ url, error: String(e.message) }); }
}
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
