import test from 'node:test';
import assert from 'node:assert/strict';
import { teamScore, eventOdds, pickEvent, fetchOdds } from '../web/polymarket.js';

const market = (title, price, type = 'moneyline') => ({ groupItemTitle: title, question: title, sportsMarketType: type, outcomePrices: JSON.stringify([String(price), String(1 - price)]), volume: '1000', closed: false });
const event = (home, away, prices = [0.31, 0.305, 0.455], extra = {}) => ({
  title: `${home} vs. ${away}`, slug: 'lal-ray-bil-2026-10-10',
  teams: [{ name: home, alias: home.split(' ')[0], ordering: 'home' }, { name: away, alias: away, ordering: 'away' }],
  markets: [market(home, prices[0]), market(`Draw (${home} vs. ${away})`, prices[1]), market(away, prices[2])], ...extra });

test('team names from ESPN and Polymarket match, and «Real» alone does not', () => {
  assert.ok(teamScore('Rayo Vallecano', 'Rayo Vallecano de Madrid') >= 2);
  assert.ok(teamScore('Atlético Madrid', 'Club Atlético de Madrid') >= 2);
  assert.equal(teamScore('Real Madrid', 'Real Sociedad'), 0);
  assert.equal(teamScore('Barcelona', 'FC Barcelona'), 10);
});

test('the odds add up to 100, with the page and the money traded', () => {
  const odds = eventOdds(event('Rayo Vallecano de Madrid', 'Athletic Club'));
  assert.deepEqual([odds.home, odds.draw, odds.away], [29, 28, 43]);
  assert.equal(odds.home + odds.draw + odds.away, 100);
  assert.equal(odds.url, 'https://polymarket.com/event/lal-ray-bil-2026-10-10');
  assert.equal(odds.volume, 3000);
  assert.equal(eventOdds({ markets: [], teams: [] }), null);
});

test('the match is picked by its teams, never a half-time or corners market, and swapped teams are turned round', () => {
  const half = { ...event('Rayo Vallecano de Madrid', 'Athletic Club'), title: 'Rayo Vallecano de Madrid vs. Athletic Club - Halftime Result' };
  const other = event('Getafe CF', 'Villarreal CF');
  const found = pickEvent([half, other, event('Rayo Vallecano de Madrid', 'Athletic Club')], 'Rayo Vallecano', 'Athletic Club');
  assert.equal(found.event.title, 'Rayo Vallecano de Madrid vs. Athletic Club');
  assert.equal(found.swapped, false);
  assert.equal(pickEvent([event('Rayo Vallecano de Madrid', 'Athletic Club')], 'Athletic Club', 'Rayo Vallecano').swapped, true);
  assert.equal(pickEvent([other], 'Real Madrid', 'Barcelona'), null);
});

test('fetchOdds asks for football events around kick-off and gives the odds in our order', async () => {
  let asked = '';
  const fetcher = async (url) => { asked = url; return { ok: true, json: async () => [event('Rayo Vallecano de Madrid', 'Athletic Club')] }; };
  const odds = await fetchOdds('Athletic Club', 'Rayo Vallecano', '2026-10-10T12:00:00Z', fetcher);
  assert.match(asked, /^https:\/\/gamma-api\.polymarket\.com\/events\?tag_id=100350&closed=false&limit=100&offset=0&end_date_min=2026-10-10T11%3A15%3A00Z&end_date_max=2026-10-10T12%3A45%3A00Z$/);
  assert.deepEqual([odds.home, odds.draw, odds.away], [43, 28, 29]);
  assert.equal(await fetchOdds('A', 'B', 'nunca', fetcher), null);
});

test('on a busy hour the following pages are read until the match appears', async () => {
  const filler = Array.from({ length: 100 }, (_, i) => event(`Equipo ${i}`, `Rival ${i}`));
  const offsets = [];
  const fetcher = async (url) => { const offset = Number(new URL(url).searchParams.get('offset')); offsets.push(offset);
    return { ok: true, json: async () => (offset === 0 ? filler : [event('Rayo Vallecano de Madrid', 'RC Celta de Vigo')]) }; };
  const odds = await fetchOdds('Rayo Vallecano', 'Celta Vigo', '2026-10-31T15:15:00Z', fetcher);
  assert.deepEqual(offsets, [0, 100]);
  assert.ok(odds);
});
