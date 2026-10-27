import test from 'node:test';
import assert from 'node:assert/strict';
import { matchKey, votingOpen, tally, voterId, myPick, rememberPick, fetchVotes, sendVote, VOTES_ENDPOINT } from '../web/votes.js';
import { porraCard } from '../web/match-center.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('the same match gets the same key on the web and the app, from ESPN or event names', () => {
  assert.equal(matchKey('Villarreal CF', 'RCD Espanyol', '2026-10-30T20:00Z'), '2026-10-30-villarreal-espanyol');
  assert.equal(matchKey('Atlético Madrid', 'Real Betis', '2026-10-31T13:00:00Z'), '2026-10-31-atletico-madrid-real-betis');
  assert.equal(matchKey('Villarreal', '', '2026-10-30T20:00Z'), '');
  assert.equal(matchKey('Villarreal', 'Espanyol', ''), '');
});

test('voting is open before and during the match, and closes when it ends', () => {
  for (const state of ['scheduled', 'live', 'halftime']) assert.equal(votingOpen({ state }), true, state);
  for (const state of ['finished', 'postponed', 'cancelled', 'suspended']) assert.equal(votingOpen({ state }), false, state);
});

test('votes go to the hosting as plain text and come back as totals', async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => { calls.push([url, options]); return { ok: true, json: async () => ({ h: 2, d: 1, a: 0 }) }; };
  assert.deepEqual(await fetchVotes('2026-10-30-a-b', fetcher), { h: 2, d: 1, a: 0 });
  assert.equal(calls[0][0], `${VOTES_ENDPOINT}?match=2026-10-30-a-b`);
  await sendVote('A'.repeat(24), '2026-10-30-a-b', 'X', fetcher);
  assert.equal(calls[1][1].method, 'POST');
  assert.equal(calls[1][1].headers['Content-Type'], 'text/plain');
  assert.deepEqual(JSON.parse(calls[1][1].body), { match: '2026-10-30-a-b', voter: 'A'.repeat(24), pick: 'X' });
  await assert.rejects(sendVote('A'.repeat(24), '2026-10-30-a-b', '3', fetcher));
  const refused = async () => ({ ok: false, json: async () => ({ error: 'Demasiados votos desde esta conexión. Espera unos minutos.' }) });
  await assert.rejects(sendVote('A'.repeat(24), '2026-10-30-a-b', '1', refused), /Demasiados votos/);
});

test('totals add up to 100', () => {
  assert.deepEqual(tally({ h: 1, d: 1, a: 1 }), { home: 34, draw: 33, away: 33, total: 3 });
  assert.deepEqual(tally({ h: 0, d: 0, a: 0 }), { home: 0, draw: 0, away: 0, total: 0 });
});

test('the voter id and picks are kept in the browser', () => {
  const storage = memory();
  const id = voterId(storage, () => new Uint8Array(24).fill(1));
  assert.match(id, /^[A-Za-z0-9]{24}$/);
  assert.equal(voterId(storage, () => new Uint8Array(24).fill(2)), id);
  rememberPick('m1', '2', storage);
  assert.equal(myPick('m1', storage), '2');
  assert.equal(myPick('m2', storage), '');
});

const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat().filter((c) => c != null) });
const texts = (node) => typeof node === 'string' ? [node] : node.children.flatMap(texts);
const find = (node, test) => typeof node === 'string' ? [] : [...(test(node) ? [node] : []), ...node.children.flatMap((c) => find(c, test))];
const base = { home: { name: 'Villarreal' }, away: { name: 'Espanyol' }, state: 'scheduled' };
const odds = { home: 68, draw: 19, away: 13, url: 'https://polymarket.com/event/x', goals: [{ label: '+1,5 goles', pct: 84 }, { label: 'Ambos marcan', pct: 57 }],
  history: { home: [[1, 60], [2, 68]], draw: [[1, 25], [2, 19]], away: [[1, 15], [2, 13]] } };

test('the porra shows Polymarket as the big number and the votes as the bar, and a tap votes', () => {
  const picked = [];
  const card = porraCard(el, { ...base, odds, votes: { open: true, pick: '', tally: tally({ h: 1, d: 0, a: 3 }), choose: (p) => picked.push(p) } });
  const all = texts(card).join(' ');
  assert.match(all, /Porra · ¿Quién gana\?/);
  assert.match(all, /Favorito: +Villarreal 68%/);
  const tiles = find(card, (n) => n.tag === 'button' && /mc-porra-tile/.test(n.attrs.class || ''));
  assert.deepEqual(tiles.map((t) => texts(t).join(' ')), ['Villarreal 68% 25%', 'Empate 19% 0%', 'Espanyol 13% 75%']);
  tiles[2].attrs.onclick();
  assert.deepEqual(picked, ['2']);
  assert.match(all, /Evolución en Polymarket/);
  assert.match(all, /\+1,5 goles 84%/);
  assert.match(all, /Número: probabilidad en Polymarket · barra: votos de la porra \(4 votos\)/);
  assert.match(all, /Toca un equipo para votar\./);
});

test('without Polymarket the votes are the number, a closed porra has no buttons, and it can be folded', () => {
  const card = porraCard(el, { ...base, state: 'finished', odds, votes: { open: false, pick: '1', tally: tally({ h: 2, d: 2, a: 0 }), choose() {} } });
  assert.equal(find(card, (n) => n.tag === 'button' && /mc-porra-tile/.test(n.attrs.class || '')).length, 0);
  const all = texts(card).join(' ');
  assert.match(all, /Villarreal 50% 50%/);
  assert.match(all, /Votación cerrada\./);
  assert.doesNotMatch(all, /Polymarket/);
  let toggled = 0;
  const folded = porraCard(el, { ...base, odds, votes: { open: true, pick: '', tally: null, choose() {}, collapsed: true, toggle: () => toggled++ } });
  assert.equal(find(folded, (n) => /mc-porra-tile/.test(n.attrs?.class || '')).length, 0);
  find(folded, (n) => n.tag === 'button')[0].attrs.onclick();
  assert.equal(toggled, 1);
  assert.equal(porraCard(el, { ...base }), null);
});
