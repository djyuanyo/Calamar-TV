import fs from 'node:fs';
const out = {};
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const now = Date.now();
const q = new URLSearchParams({ tag_id: '100350', closed: 'false', limit: '100', end_date_min: iso(now + 20 * 3600e3), end_date_max: iso(now + 30 * 3600e3) });
const events = await (await fetch('https://gamma-api.polymarket.com/events?' + q)).json();
out.count = events.length;
const main = events.find((e) => !/ - /.test(e.title) && (e.markets || []).some((m) => m.sportsMarketType === 'moneyline'));
out.main = main && { title: main.title, slug: main.slug, endDate: main.endDate, startTime: main.startTime, keys: Object.keys(main) };
const related = events.filter((e) => main && (e.slug.startsWith(main.slug) || e.title.startsWith(main.title)));
out.related = related.map((e) => ({ title: e.title, slug: e.slug, markets: (e.markets || []).map((m) => ({ type: m.sportsMarketType, group: m.groupItemTitle, q: m.question, outcomes: m.outcomes, prices: m.outcomePrices, line: m.line, tokens: m.clobTokenIds, closed: m.closed })) }));
// Also sample all distinct sportsMarketType and titles suffixes
out.types = [...new Set(events.flatMap((e) => (e.markets || []).map((m) => m.sportsMarketType)))];
out.suffixes = [...new Set(events.map((e) => (e.title.split(' - ')[1] || '(main)')))];
const token = main && JSON.parse(main.markets.find((m) => m.sportsMarketType === 'moneyline').clobTokenIds)[0];
for (const url of [`https://clob.polymarket.com/prices-history?market=${token}&interval=1d&fidelity=10`, `https://clob.polymarket.com/prices-history?market=${token}&interval=max&fidelity=60`]) {
  const r = await fetch(url, { headers: { Origin: 'https://djyuanyo.github.io' } });
  const body = await r.text();
  out[url.slice(30, 90)] = { status: r.status, acao: r.headers.get('access-control-allow-origin'), points: (() => { try { const h = JSON.parse(body).history; return [h.length, h[0], h[h.length - 1]]; } catch { return body.slice(0, 200); } })() };
}
// Live match example too
const liveQ = new URLSearchParams({ tag_id: '100350', closed: 'false', limit: '100', end_date_min: iso(now - 3 * 3600e3), end_date_max: iso(now) });
const live = await (await fetch('https://gamma-api.polymarket.com/events?' + liveQ)).json();
out.live = live.filter((e) => !/ - /.test(e.title)).slice(0, 3).map((e) => ({ title: e.title, markets: (e.markets || []).filter((m) => m.sportsMarketType === 'moneyline').map((m) => [m.groupItemTitle, m.outcomePrices, m.closed, m.active]) }));
fs.writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
