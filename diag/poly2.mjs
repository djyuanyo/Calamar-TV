import fs from 'node:fs';
const out = [];
const urls = ['https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401874780', 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/summary?event=401874780',
  'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401874780', 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/scoreboard', 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/ita.1/summary?event=401874780'];
for (const u of urls) for (const origin of ['https://djyuanyo.github.io', null]) {
  const r = await fetch(u, { headers: origin ? { Origin: origin } : {} });
  const b = await r.text();
  out.push({ u, origin, status: r.status, acao: r.headers.get('access-control-allow-origin'), size: b.length, head: b.slice(0, 80) });
}
fs.writeFileSync('diag/host3.json', JSON.stringify(out, null, 1));
