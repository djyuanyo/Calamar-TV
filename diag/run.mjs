import { fetchSeason, parseSeason, assignRounds } from './competitions.js';
for (const slug of ['esp.1', 'eng.1', 'uefa.champions']) {
  try {
    const s = await fetchSeason(slug);
    const r = assignRounds(s.matches), count = new Map();
    for (const v of r.values()) count.set(v, (count.get(v) || 0) + 1);
    console.log(slug, s.name, s.season, 'teams', s.teams.length, 'matches', s.matches.length, 'todo', s.matches.filter(m => !m.done).length);
    console.log(' rounds', JSON.stringify([...count.entries()].sort((a, b) => a[0] - b[0])));
    const by = new Map(); for (const m of s.matches) { const k = r.get(m.id); (by.get(k) || by.set(k, []).get(k)).push(m.date.slice(0, 10)); }
    console.log(' dates', [...by.entries()].sort((a, b) => a[0] - b[0]).slice(0, 40).map(([k, d]) => `${k}:${[...new Set(d)].join('/')}`).join(' '));
  } catch (e) { console.log(slug, 'ERROR', e.message); }
}
// Last season, complete: every round should have 10 matches.
const B = 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard';
const boards = [await (await fetch(B)).json(), await (await fetch(B + '?dates=2025&limit=1000')).json(), await (await fetch(B + '?dates=2026&limit=1000')).json()];
boards[0].leagues[0].season.year = 2025;
const s = parseSeason(boards, 'esp.1'); const r = assignRounds(s.matches), count = new Map();
for (const v of r.values()) count.set(v, (count.get(v) || 0) + 1);
console.log('2025-26', s.matches.length, JSON.stringify([...count.entries()].sort((a, b) => a[0] - b[0])));
