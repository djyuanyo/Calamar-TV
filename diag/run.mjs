import { writeFileSync } from 'node:fs';
import { fetchSeason, assignRounds } from './competitions.js';
const lines = [];
for (const slug of ['esp.1', 'esp.2', 'eng.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'esp.copa_del_rey']) {
  try {
    const s = await fetchSeason(slug); const r = assignRounds(s.matches), c = new Map();
    for (const v of r.values()) c.set(v, (c.get(v) || 0) + 1);
    lines.push(`${slug} ${s.name} ${s.season} teams=${s.teams.length} matches=${s.matches.length} rounds=${c.size} sizes=${JSON.stringify([...c].sort((a, b) => a[0] - b[0]).map(x => x[1]))}`);
  } catch (e) { lines.push(`${slug} ERROR ${e.message}`); }
}
writeFileSync('diag/rounds.json', JSON.stringify(lines, null, 1));
