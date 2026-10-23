import { fetchSeason, parseSeason } from './competitions.js';
const s = await fetchSeason('esp.1');
console.log('M2026 ' + JSON.stringify(s.matches.map(m => [m.date.slice(0, 16), m.home, m.away])));
const B = 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard';
const boards = [await (await fetch(B)).json(), await (await fetch(B + '?dates=2025&limit=1000')).json(), await (await fetch(B + '?dates=2026&limit=1000')).json()];
boards[0].leagues[0].season.year = 2025;
const o = parseSeason(boards, 'esp.1');
console.log('M2025 ' + JSON.stringify(o.matches.map(m => [m.date.slice(0, 16), m.home, m.away])));
