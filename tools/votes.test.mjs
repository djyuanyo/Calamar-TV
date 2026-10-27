import test from 'node:test';
import assert from 'node:assert/strict';
import { matchKey, votingOpen, voteData, voteId, tally, voterId, myPick, rememberPick } from '../web/votes.js';
import { votesCard } from '../web/match-center.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('the same match gets the same key on the web and the app, from ESPN or event names', () => {
  assert.equal(matchKey('Villarreal CF', 'RCD Espanyol', '2026-10-30T20:00Z'), '2026-10-30-villarreal-espanyol');
  assert.equal(matchKey('Atlético Madrid', 'Real Betis', '2026-10-31T13:00:00Z'), '2026-10-31-atletico-madrid-real-betis');
  assert.equal(matchKey('Villarreal', '', '2026-10-30T20:00Z'), '');
  assert.equal(matchKey('Villarreal', 'Espanyol', ''), '');
});

test('voting is open only before kick-off', () => {
  const at = Date.parse('2026-10-30T20:00:00Z');
  assert.equal(votingOpen({ state: 'scheduled', date: '2026-10-30T20:00Z' }, at - 1000), true);
  assert.equal(votingOpen({ state: 'scheduled', date: '2026-10-30T20:00Z' }, at + 1000), false);
  assert.equal(votingOpen({ state: 'live', date: '2026-10-30T20:00Z' }, at - 1000), false);
});

test('a vote stores only the match and the pick as 1/0, and totals add up to 100', () => {
  assert.deepEqual(voteData('2026-10-30-a-b', 'X'), { match: '2026-10-30-a-b', h: 0, d: 1, a: 0 });
  assert.throws(() => voteData('2026-10-30-a-b', '3'));
  assert.equal(voteId('A'.repeat(24), '2026-10-30-a-b'), `${'A'.repeat(24)}_2026-10-30-a-b`);
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
const base = { home: { name: 'Villarreal' }, away: { name: 'Espanyol' } };

test('the poll shows buttons before kick-off and results once voted or closed', () => {
  const picked = [];
  const open = votesCard(el, { ...base, votes: { open: true, pick: '', tally: { home: 50, draw: 0, away: 50, total: 2 }, choose: (p) => picked.push(p) } });
  const buttons = open.children[1].children;
  assert.deepEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false']);
  buttons[2].attrs.onclick();
  assert.deepEqual(picked, ['2']);
  assert.ok(!texts(open).includes('50%'), 'results stay hidden until voting');
  const voted = votesCard(el, { ...base, votes: { open: true, pick: '1', tally: { home: 50, draw: 0, away: 50, total: 2 }, choose() {} } });
  assert.equal(voted.children[1].children[0].attrs['aria-pressed'], 'true');
  assert.ok(texts(voted).includes('50%'));
  const closed = votesCard(el, { ...base, votes: { open: false, pick: '', tally: { home: 0, draw: 100, away: 0, total: 1 }, choose() {} } });
  assert.ok(texts(closed).join(' ').includes('Votación cerrada'));
  assert.equal(votesCard(el, { ...base, votes: { open: false, pick: '', tally: { home: 0, draw: 0, away: 0, total: 0 } } }), null);
});
