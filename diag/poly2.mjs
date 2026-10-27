import fs from 'node:fs';
const out = {};
for (const slug of ['lal-vil-esp-2026-10-30-more-markets', 'lal-vil-esp-2026-10-30']) {
  const r = await fetch('https://gamma-api.polymarket.com/events?slug=' + slug);
  const ev = await r.json();
  out[slug] = ev.map((e) => ({ title: e.title, slug: e.slug, markets: (e.markets || []).map((m) => ({ type: m.sportsMarketType, group: m.groupItemTitle, q: m.question, outcomes: m.outcomes, prices: m.outcomePrices, line: m.line, closed: m.closed, keys: Object.keys(m).join(',') })) }));
}
fs.writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
