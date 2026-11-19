import { writeFileSync } from 'node:fs';
const out = [];
const seen = new Set();
async function list(id, path, depth) {
  if (seen.has(id) || depth > 4 || seen.size > 60) return;
  seen.add(id);
  let html = '';
  try {
    const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}#list`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130' } });
    html = await r.text();
    out.push({ path, status: r.status });
  } catch (e) { out.push({ path, error: String(e.message) }); return; }
  const entries = [...html.matchAll(/<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)];
  for (const [, eid, href, title] of entries) {
    const folder = /\/drive\/folders\//.test(href);
    const icon = (html.split(`entry-${eid}`)[1] || '').match(/<img src="([^"]+)"/)?.[1] || '';
    out.push({ path: path + '/' + title, folder, href: href.replace(/[?&]usp=[^&]*/,''), icon: icon.split('/').pop() });
    if (folder) await list(href.match(/folders\/([A-Za-z0-9_-]+)/)[1], path + '/' + title, depth + 1);
  }
  if (!entries.length) out.push({ path, sample: html.slice(0, 600) });
}
await list('1yItvPkH9YyOEJRVZtlWwDCy1t137DxdU', '', 0);
writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
