import fs from 'node:fs';
const out = [];
for (const league of ['esp.copa_del_rey', 'ita.1', 'eng.league_cup']) {
  const board = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`)).json();
  for (const e of (board.events || []).filter((x) => x.status.type.state !== 'pre').slice(0, 4)) {
    const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=${e.id}`)).json();
    out.push({ league, id: e.id, name: e.name, state: e.status.type.state,
      header: (s.header?.competitions?.[0]?.competitors || []).map((c) => [c.homeAway, c.team?.id, c.team?.displayName]),
      box: (s.boxscore?.teams || []).map((t) => ({ team: [t.team?.id, t.team?.displayName, t.homeAway], stats: (t.statistics || []).map((x) => `${x.name}=${x.displayValue}`).join(' ') })),
      boxKeys: Object.keys(s.boxscore || {}), form: !!s.boxscore?.form });
  }
}
fs.writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
