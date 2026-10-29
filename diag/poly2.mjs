import fs from 'node:fs';
const out = {};
const t0 = Date.now();
async function time(name, fn) { const s = Date.now(); try { out[name] = { ...(await fn()), ms: Date.now() - s }; } catch (e) { out[name] = { error: String(e), ms: Date.now() - s }; } }
await time('hosting_post_fake', async () => {
  const r = await fetch('https://calamarmenciano.com/calamar-lulu.php', { method: 'POST', headers: { Origin: 'https://djyuanyo.github.io', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api: 'folder/list', key: 'abcdefghij12345', fld_id: '0', files: '1' }), signal: AbortSignal.timeout(60000) });
  return { status: r.status, acao: r.headers.get('access-control-allow-origin'), type: r.headers.get('content-type'), body: (await r.text()).slice(0, 400) };
});
await time('hosting_get', async () => { const r = await fetch('https://calamarmenciano.com/calamar-lulu.php', { headers: { Origin: 'https://djyuanyo.github.io' } }); return { status: r.status, body: (await r.text()).slice(0, 300) }; });
await time('lulu_direct_fake', async () => { const r = await fetch('https://api.lulustream.com/api/folder/list?key=abcdefghij12345&fld_id=0&files=1', { signal: AbortSignal.timeout(40000) }); return { status: r.status, acao: r.headers.get('access-control-allow-origin'), body: (await r.text()).slice(0, 300) }; });
fs.writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
