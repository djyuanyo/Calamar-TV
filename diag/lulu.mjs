import { writeFileSync } from 'node:fs';
const out = [];
const get = async (url, opts = {}) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts, headers: { Origin: 'https://djyuanyo.github.io', ...(opts.headers || {}) } });
    const text = await r.text();
    out.push({ url, method: opts.method || 'GET', status: r.status, type: r.headers.get('content-type'), acao: r.headers.get('access-control-allow-origin'), body: text.slice(0, 400) });
  } catch (e) { out.push({ url, error: String(e.cause?.code || e.message) }); }
};
await get('https://calamarmenciano.com/calamar-drive.php');
await get('https://calamarmenciano.com/calamar-drive.php', { method: 'POST', body: new URLSearchParams({ id: 'abcdefghijk', resourceKey: '', key: 'AIza' + 'x'.repeat(35), pageToken: '' }) });
await get('https://calamarmenciano.com/calamar-drive.php', { method: 'OPTIONS' });
await get('https://calamarmenciano.com/calamar-lulu.php?api=1');
await get('https://luluvido.com/api/folder/list?key=x&fld_id=0');
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
