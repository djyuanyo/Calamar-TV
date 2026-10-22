import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchCenter } from '../web/match-center.js';

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
      { id: '999', date: '2027-05-09T19:00:00Z', status: 'pre', statusType: { completed: false }, competitors: [{ homeAway: 'home', team: rma }, { homeAway: 'away', team: bar }] }] }],
  });
  assert.equal(m.state, 'scheduled');
  assert.deepEqual(m.h2h.map((g) => [g.home, g.score, g.away, g.competition]), [
    ['Barcelona', '2 – 0', 'Real Madrid', '2025-26 LALIGA'],
    ['Barcelona', '3 – 2', 'Real Madrid', '2026 Supercopa de España · Final'],
    ['Real Madrid', '2 – 1', 'Barcelona', '2025-26 LALIGA']]);
  assert.deepEqual([m.form.home.map((f) => f.result), m.form.away.map((f) => f.result)], [['W', 'L'], ['L']]);
});
