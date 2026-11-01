import test from 'node:test';
import assert from 'node:assert/strict';
import { MULTI_MAX, multiGrid, multiPlayable, multiKey } from '../web/multi-view.js';
import { availableMultiEvents, searchMultiEvents } from '../web/multi-picker.js';
const event = (id, name, streams = ['https://example.com/live.m3u8']) => ({ id, eventId:id, event:true, name, playable:true, streams });
test('all layouts and crafted oversized selections are bounded by four', () => {
  assert.equal(MULTI_MAX,4);
  for (const [n,rows,cols] of [[1,1,1],[2,2,1],[3,2,2],[4,2,2],[6,2,2],[100,2,2]]) assert.deepEqual(multiGrid(n),{rows,cols});
});
test('picker searches every event by name without case or accents, keeping event identity', () => {
  const rows=[event('a','Águilas vs Betis'),event('b','Real Madrid'),event('c','Otro partido')];
  assert.deepEqual(searchMultiEvents(rows,' AGUILAS ').map(e=>e.id),['a']);
  assert.deepEqual(searchMultiEvents(rows,'madrid').map(e=>e.id),['b']);
  assert.equal(searchMultiEvents(rows,'ninguno').length,0);
  assert.notEqual(multiKey(rows[0]),multiKey({...rows[0],event:false,eventId:undefined}));
});
test('available events include renewable Zico pages and event APIs and exclude pending/iframe-only sources', () => {
  const rows=[event('a','Canal', ['https://zicotv.cc/api/player/1']),event('b','Evento',['https://zicotv.cc/events/123']),
    {...event('c','Pendiente'),playable:false},event('d','Iframe',['https://anonmp4.art/embed/abcdefghijkl'])];
  assert.equal(multiPlayable(rows[0]),true);
  assert.deepEqual(availableMultiEvents(rows).map(e=>e.id),['a','b']);
});
