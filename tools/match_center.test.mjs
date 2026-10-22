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
