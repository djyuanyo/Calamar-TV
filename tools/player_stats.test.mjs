import test from 'node:test';
import assert from 'node:assert/strict';
import { playerStatsUrls, playerStatRows, fetchPlayerStats } from '../web/player-stats.js';
import { parseMatchCenter } from '../web/match-center.js';

const match = { id: '700', leagueCode: 'esp.2', seasonYear: 2026, seasonType: 1 };
const player = { id: '42', teamId: '99', position: 'G' };
test('player requests are scoped to the exact match, team, league and season', () => {
  const urls = playerStatsUrls(match, player);
  assert.match(urls.match, /esp\.2\/events\/700\/competitions\/700\/competitors\/99\/roster\/42\/statistics\/0/);
  assert.match(urls.season, /esp\.2\/seasons\/2026\/types\/1\/athletes\/42\/statistics\/0/);
  for (const bad of ['../esp.1', 'https://other.example', '']) {
    assert.deepEqual(playerStatsUrls({ ...match, leagueCode: bad }, player), { match: '', season: '' });
  }
  assert.equal(playerStatsUrls({ ...match, seasonYear: '' }, player).season, '');
});
test('renders available statistics including real zeros and percentage ratios, with keeper metrics for keepers', () => {
  const data = { splits: { categories: [{ stats: [
    { name: 'totalGoals', value: 0, displayValue: '0' }, { name: 'minutes', value: 90 },
    { name: 'passPct', value: .875, displayValue: '0.9' },
    { name: 'saves', value: 4 }, { name: 'goalAssists', displayValue: '-' },
  ] }] } };
  const keeper = playerStatRows(data, 'G');
  assert.deepEqual(keeper.map(row => [row.label, row.value]),
    [['Minutos', '90'], ['Goles', '0'], ['Precisión de pase', '87,5%'], ['Paradas', '4']]);
  assert.ok(!playerStatRows(data, 'F').some(row => row.key === 'saves'));
  assert.deepEqual(playerStatRows(null), []);
});
test('a failed request can retry, successful responses are reused across repeated player opens', async () => {
  const url = 'https://sports.core.api.espn.com/player-test-retry';
  let calls = 0;
  const fetcher = async (_url, options) => {
    calls++;
    assert.equal(options.credentials, 'omit');
    if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, status: 200, json: async () => ({ splits: { categories: [] } }) };
  };
  await assert.rejects(fetchPlayerStats(url, fetcher));
  const result = await fetchPlayerStats(url, fetcher);
  assert.equal(await fetchPlayerStats(url, fetcher), result);
  assert.equal(calls, 2);
});
test('lineup parsing retains player identity and season context and handles ESPN substitution objects', () => {
  const model = parseMatchCenter({ header: { id: '700', league: { slug: 'esp.2' }, season: { year: 2026, type: 1 },
    competitions: [{ status: { type: { state: 'in' } }, competitors: [
      { homeAway: 'home', team: { id: '99', displayName: 'Local' } },
      { homeAway: 'away', team: { id: '88', displayName: 'Visitante' } },
    ] }] }, rosters: [{ homeAway: 'home', roster: [
      { starter: true, athlete: { id: '42', displayName: 'Titular' }, subbedIn: { didSub: false }, stats: [{ name: 'totalGoals', value: 1 }] },
    ] }] });
  const parsed = model.lineups[0].starters[0];
  assert.deepEqual([parsed.id, parsed.teamId, parsed.teamName, parsed.subbedIn], ['42', '99', 'Local', false]);
  assert.equal(parsed.stats[0].value, 1);
  assert.equal(playerStatsUrls(model, parsed).season, playerStatsUrls(match, player).season);
});
