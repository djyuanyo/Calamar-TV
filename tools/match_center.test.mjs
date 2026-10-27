import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchCenter, renderMatchCenter } from '../web/match-center.js';

const summary = {
  header: { id: '1', league: { name: 'UEFA Champions League' }, competitions: [{ id: '1', date: '2026-10-21T19:00Z',
    status: { displayClock: "67'", type: { state: 'in', name: 'STATUS_SECOND_HALF', completed: false } },
    competitors: [{ homeAway: 'home', score: '1', team: { id: '86', displayName: 'Real Madrid', abbreviation: 'RMA', logos: [{ href: 'https://a.espncdn.com/rma.png' }] } },
      { homeAway: 'away', score: { displayValue: '1' }, team: { id: '111', displayName: 'Juventus', abbreviation: 'JUV', logo: 'http://insecure/juv.png' } }] }] },
  keyEvents: [
    { type: { type: 'goal---header', text: 'Goal - Header' }, scoringPlay: true, clock: { displayValue: "23'" }, team: { id: '86' }, participants: [{ athlete: { displayName: 'Vinícius Júnior' } }] },
    { type: { type: 'penalty---scored', text: 'Penalty - Scored' }, scoringPlay: true, clock: { displayValue: "55'" }, team: { id: '111' }, participants: [{ athlete: { displayName: 'Dušan Vlahović' } }] },
    { type: { type: 'red-card', text: 'Red Card' }, clock: { displayValue: "60'" }, team: { id: '111' }, participants: [{ athlete: { displayName: 'Bremer' } }] },
    { type: { type: 'kickoff', text: 'Kickoff' }, clock: { displayValue: "0'" } }],
  boxscore: { teams: [{ team: { id: '111' }, statistics: [{ name: 'possessionPct', displayValue: '35.5' }, { name: 'foulsCommitted', displayValue: '14' }] },
    { team: { id: '86' }, statistics: [{ name: 'possessionPct', displayValue: '64.5' }, { name: 'foulsCommitted', displayValue: '9' }, { name: 'unknownStat', displayValue: '3' }] }] },
  rosters: [{ homeAway: 'away', formation: '3-5-2', roster: [{ starter: false, jersey: '9', athlete: { displayName: 'Milik' } }, { starter: true, jersey: '1', athlete: { displayName: 'Di Gregorio' }, position: { abbreviation: 'G' }, formationPlace: '1' }] }],
  gameInfo: { venue: { fullName: 'Santiago Bernabéu', address: { city: 'Madrid' } }, attendance: 78000, officials: [{ fullName: 'Szymon Marciniak', position: { name: 'Referee' } }] },
};

test('reads score, teams, key events by side, statistics in order and line-ups from ESPN', () => {
  const m = parseMatchCenter(summary);
  assert.equal(m.status, '1 – 1 · En juego · 67′');
  assert.deepEqual([m.home.name, m.home.score, m.home.logo, m.away.score, m.away.logo], ['Real Madrid', '1', 'https://a.espncdn.com/rma.png', '1', '']);
  assert.deepEqual(m.events.map((e) => [e.minute, e.kind, e.side, e.player]),
    [["23'", 'goal', 'home', 'Vinícius Júnior'], ["55'", 'penalty', 'away', 'Dušan Vlahović'], ["60'", 'red', 'away', 'Bremer']]);
  assert.deepEqual(m.stats.map((s) => [s.label, s.home, s.away]), [['Posesión', '64.5%', '35.5%'], ['Faltas', '9', '14']], 'matched to each side by team id');
  assert.equal(m.lineups.length, 1);
  assert.equal(m.lineups[0].side, 'away');
  assert.deepEqual(m.lineups[0].starters.map((p) => p.name), ['Di Gregorio']);
  assert.deepEqual(m.lineups[0].subs.map((p) => p.name), ['Milik']);
  assert.deepEqual([m.league, m.venue, m.city, m.attendance, m.referee], ['UEFA Champions League', 'Santiago Bernabéu', 'Madrid', 78000, 'Szymon Marciniak']);
});

test('a match that has not started has no events, statistics or line-ups, and still shows who plays', () => {
  const m = parseMatchCenter({ header: { competitions: [{ status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
    competitors: [{ homeAway: 'home', team: { displayName: 'A' } }, { homeAway: 'away', team: { displayName: 'B' } }] }] } });
  assert.deepEqual([m.home.name, m.away.name, m.home.score, m.state, m.events.length, m.stats.length, m.lineups.length], ['A', 'B', '', 'scheduled', 0, 0, 0]);
});

test('last results and earlier meetings; an event without a link shows its own teams, league and date', async () => {
  const { eventMatchModel, minuteOf } = await import('../web/match-center.js');
  const m = parseMatchCenter({ ...summary,
    boxscore: { ...summary.boxscore, form: [{ team: { id: '86' }, events: [{ gameResult: 'W', score: '3-0', opponent: { displayName: 'Getafe' } }, { gameResult: 'L', score: '0-1' }] }] },
    headToHeadGames: [{ team: { id: '86', displayName: 'Real Madrid' }, events: [{ id: 'a', gameDate: '2024-02-01T20:00Z', homeTeamId: '86', score: '2-1', leagueName: 'Champions', opponent: { displayName: 'Juventus' } },
      { id: 'b', gameDate: '2025-02-01T20:00Z', homeTeamId: '111', atVs: '@', score: '0-0', opponent: { displayName: 'Juventus' } }] }] });
  assert.deepEqual(m.form.home.map((f) => f.result), ['W', 'L']);
  assert.deepEqual(m.h2h.map((g) => [g.home, g.score, g.away]), [['Juventus', '0 – 0', 'Real Madrid'], ['Real Madrid', '2 – 1', 'Juventus']]);
  const custom = { teams: [{ id: 'c', name: 'Celtic', logo: 'https://x/celtic.png' }, { id: 'v', name: 'Celta de Vigo' }], leagues: [{ id: 'l', name: 'Europa League' }] };
  const e = eventMatchModel({ name: 'Celtic vs Celta de Vigo', homeTeamId: 'c', awayTeamId: 'v', leagueId: 'l', startAt: '2026-10-22T19:00:00Z', venue: 'Celtic Park', description: 'Fase de liga' }, custom, '22/10 21:00');
  assert.deepEqual([e.home.name, e.home.logo, e.away.name, e.league, e.venue, e.description, e.source], ['Celtic', 'https://x/celtic.png', 'Celta de Vigo', 'Europa League', 'Celtic Park', 'Fase de liga', 'event']);
  assert.deepEqual([eventMatchModel({ name: 'Celtic vs Celta de Vigo' }, {}).home.name, eventMatchModel({ name: 'Celtic vs Celta de Vigo' }, {}).away.name], ['Celtic', 'Celta de Vigo']);
  assert.equal(minuteOf("45'+2'"), 47);
});

test('before kick-off: last meetings (seasonseries) and last results (lastFiveGames), as ESPN sends them now', () => {
  // Barcelona vs Real Madrid, 25 October 2026, still scheduled (shape of ESPN's answer, trimmed).
  const team = (id, name) => ({ id, displayName: name, logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` });
  const meeting = (id, date, home, hs, away, as, competitionName, extra = {}) => ({ id, date, status: 'post', statusType: { completed: true, state: 'post' }, competitionName,
    competitors: [{ homeAway: 'home', team: home, score: hs }, { homeAway: 'away', team: away, score: as }], ...extra });
  const bar = team('83', 'Barcelona'), rma = team('86', 'Real Madrid');
  const m = parseMatchCenter({
    header: { id: '401882832', league: { name: 'Spanish LALIGA', slug: 'esp.1' }, competitions: [{ id: '401882832', date: '2026-10-25T20:00Z',
      status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } },
      competitors: [{ homeAway: 'home', team: { ...bar, abbreviation: 'BAR' } }, { homeAway: 'away', team: { ...rma, abbreviation: 'RMA' } }] }] },
    boxscore: {},
    lastFiveGames: [{ team: bar, events: [{ gameResult: 'W', score: '3-1', gameDate: '2026-09-19T19:00Z', opponent: { displayName: 'Sevilla' } }, { gameResult: 'L', score: '4-2', opponent: { displayName: 'PSG' } }] },
      { team: rma, events: [{ gameResult: 'L', score: '2-1', opponent: { displayName: 'Getafe' } }] }],
    seasonseries: [{ type: 'head-to-head', title: 'Barcelona vs. Real Madrid', events: [
      meeting('748484', '2026-05-10T19:00:00Z', bar, '2', rma, '0', '2025-26 LALIGA'),
      meeting('900001', '2026-01-11T19:00:00Z', bar, '3', rma, '2', '2026 Supercopa de España', { roundName: 'Final' }),
      meeting('700500', '2025-10-26T15:15:00Z', rma, '2', bar, '1', '2025-26 LALIGA'),
      { id: '999', date: '2027-05-09T19:00:00Z', status: 'pre', timeValid: false, statusType: { completed: false, state: 'pre' }, competitionName: '2026-27 LALIGA', competitors: [{ homeAway: 'home', team: rma }, { homeAway: 'away', team: bar }] },
      { id: '401882832', date: '2026-10-25T20:00:00Z', status: 'pre', statusType: { completed: false, state: 'pre' }, competitors: [{ homeAway: 'home', team: bar }, { homeAway: 'away', team: rma }] }] }],
  });
  assert.equal(m.state, 'scheduled');
  assert.deepEqual(m.h2h.map((g) => [g.home, g.score, g.away, g.competition]), [
    ['Real Madrid', '', 'Barcelona', '2026-27 LALIGA'],
    ['Barcelona', '2 – 0', 'Real Madrid', '2025-26 LALIGA'],
    ['Barcelona', '3 – 2', 'Real Madrid', '2026 Supercopa de España · Final'],
    ['Real Madrid', '2 – 1', 'Barcelona', '2025-26 LALIGA']]);
  assert.deepEqual([m.form.home.map((f) => f.result), m.form.away.map((f) => f.result)], [['W', 'L'], ['L']]);
  assert.deepEqual([m.h2h[0].upcoming, m.h2h[0].dateKnown, m.h2h[1].upcoming], [true, false, false]);
  // Drawn: «Próximo · Fecha por definir» first, then the results.
  const el = (tag, attrs, ...kids) => ({ tag, attrs, kids: kids.flat(Infinity).filter((k) => k != null && k !== false) });
  const text = (node) => typeof node === 'string' ? node : (node.kids || []).map(text).join(' ');
  const parts = renderMatchCenter(el, m, 'h2h', () => {});
  assert.match(text(parts[2]), /^Próximo Fecha por definir 2026-27 LALIGA Real Madrid vs Barcelona .*2025-26 LALIGA Barcelona 2 – 0 Real Madrid/);
});

test('line-ups go on the pitch in the rows of their formation, from the right to the left', async () => {
  const { pitchRows } = await import('../web/match-center.js');
  // Real ESPN elevens (formationPlace:position).
  const xi = (text) => text.split(' ').map((t) => { const [place, position] = t.split(':'); return { place, position, name: `${place}${position}` }; });
  const names = (rows) => rows.map((row) => row.map((p) => p.position).join(' '));
  assert.deepEqual(names(pitchRows('4-2-3-1', xi('1:G 2:RB 3:LB 4:LM 5:CD-R 6:CD-L 7:AM-R 8:RM 9:F 10:AM 11:AM-L'))),
    ['G', 'RB CD-R CD-L LB', 'RM LM', 'AM-R AM AM-L', 'F']);
  assert.deepEqual(names(pitchRows('5-4-1', xi('1:G 2:RB 3:LB 4:CD-L 5:CD 6:CD-R 7:RM 8:CM-R 9:F 10:CM-L 11:LM'))),
    ['G', 'RB CD-R CD CD-L LB', 'RM CM-R CM-L LM', 'F']);
  assert.deepEqual(names(pitchRows('3-4-3', xi('1:G 2:RM 3:LM 4:CD-L 5:CD 6:CD-R 7:CM-R 8:CM-L 9:F 10:CF-R 11:CF-L'))),
    ['G', 'CD-R CD CD-L', 'RM CM-R CM-L LM', 'CF-R F CF-L']);
  assert.deepEqual(names(pitchRows('3-4-2-1', xi('1:G 2:RM 3:LM 4:CD-L 5:CD 6:CD-R 7:CM-R 8:CM-L 9:F 10:CF-R 11:CF-L'))),
    ['G', 'CD-R CD CD-L', 'RM CM-R CM-L LM', 'CF-R CF-L', 'F']);
  // A formation that does not add up: one row per kind of position.
  assert.deepEqual(names(pitchRows('', xi('1:G 2:RB 3:LB 5:CD-R 6:CD-L 4:DM 8:CM-R 10:CM-L 7:RW 11:LW 9:F'))),
    ['G', 'RB CD-R CD-L LB', 'DM', 'CM-R CM-L', 'RW LW', 'F']);
});

test('photos and ratings go to ESPN players by side and number', async () => {
  const { withPlayerExtras, ratingClass } = await import('../web/match-center.js');
  const m = { lineups: [{ side: 'home', starters: [{ number: '1', name: 'Unai Simón' }, { number: '9', name: 'Iñaki Williams' }], subs: [{ number: '22', name: 'Nico Serrano' }] },
    { side: 'away', starters: [{ number: '1', name: 'David Soria' }], subs: [] }] };
  const extras = { teams: { home: [{ number: '1', photo: 'https://media.api-sports.io/football/players/47.png', rating: 7.4 }, { number: '22', photo: 'http://x/y.png', rating: 6.1 }],
    away: [{ number: '1', photo: '', rating: 5.8 }] } };
  const out = withPlayerExtras(m, extras);
  assert.deepEqual(out.lineups[0].starters[0], { number: '1', name: 'Unai Simón', photo: 'https://media.api-sports.io/football/players/47.png', rating: 7.4 });
  assert.deepEqual(out.lineups[0].starters[1], { number: '9', name: 'Iñaki Williams' });
  assert.equal(out.lineups[0].subs[0].photo, '');
  assert.equal(out.lineups[1].starters[0].rating, 5.8);
  assert.equal(withPlayerExtras(m, null), m);
  assert.deepEqual([8.4, 7.3, 6.5, 5.2].map(ratingClass), ['mc-r8', 'mc-r7', 'mc-r6', 'mc-r5']);
});

test('statistics ESPN leaves at 0 are taken from API-Football', async () => {
  const { statsMissing, withExtraStats } = await import('../web/match-center.js');
  const zero = (key, h = 0, a = 0) => ({ key, homeValue: h, awayValue: a });
  const m = { source: 'espn', state: 'live', stats: [zero('possessionPct'), zero('totalShots'), zero('yellowCards', 1, 2)] };
  assert.equal(statsMissing(m), true);
  assert.equal(statsMissing({ ...m, stats: [zero('possessionPct', 55, 45)] }), false);
  assert.equal(statsMissing({ ...m, state: 'scheduled' }), false);
  assert.equal(statsMissing({ ...m, source: 'event' }), false);
  const filled = withExtraStats(m, { home: { possessionPct: '61%', totalShots: '14', yellowCards: '1' }, away: { possessionPct: '39%', totalShots: '6', yellowCards: '2' } });
  assert.equal(filled.statsSource, 'API-Football');
  assert.deepEqual(filled.stats.map((s) => [s.label, s.home, s.away]), [['Posesión', '61%', '39%'], ['Tiros', '14', '6'], ['Tarjetas amarillas', '1', '2']]);
  assert.equal(withExtraStats(m, { home: {}, away: {} }), m);
});
