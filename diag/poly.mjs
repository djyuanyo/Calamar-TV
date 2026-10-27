import { fetchOdds } from './web2/polymarket.js';
import { writeFileSync } from 'node:fs';
const now = new Date();
const q = new URLSearchParams({ series_id: '10193', closed: 'false', limit: '50', end_date_min: now.toISOString().slice(0, 19) + 'Z' });
const list = await (await fetch(`https://gamma-api.polymarket.com/events?${q}`)).json();
const games = list.filter((e) => !/ - /.test(e.title)).sort((a, b) => a.endDate.localeCompare(b.endDate)).slice(0, 4);
const out = [];
for (const g of games) {
  const [h, a] = [g.teams.find((t) => t.ordering === 'home'), g.teams.find((t) => t.ordering === 'away')];
  // ESPN-like short names: the alias.
  const odds = await fetchOdds(h.alias || h.name, a.alias || a.name, g.endDate);
  out.push({ title: g.title, kickoff: g.endDate, asked: [h.alias, a.alias], odds });
}
writeFileSync('diag/cut.json', JSON.stringify(out, null, 1));
