import assert from 'node:assert/strict';
import test from 'node:test';
import { merge, events } from '../web/catalog.js';
import { validateCatalog, validCover } from '../web/shared-catalog.js';
const channel = { id: 'sports', name: 'Deportes', streams: ['https://example.com/live.m3u8'] };
const match = { id: 'match', name: 'Local vs visitante', cover: 'https://example.com/cover.jpg', channelId: 'sports' };
const catalog = () => ({ channels: [structuredClone(channel)], featured: [], hidden: [], events: [structuredClone(match)] });
test('old catalogs without events still work', () => {
  const data = catalog(); delete data.events;
  assert.equal(validateCatalog(data), data);
  assert.deepEqual(events(merge(null, data), data), []);
});
test('event resolves its selected channel and keeps its playable link', () => {
  const data = catalog(), all = merge(null, data);
  const [event] = events(all, data);
  assert.equal(event.name, match.name); assert.equal(event.cover, match.cover);
  assert.equal(event.id, channel.id); assert.equal(event.slug, all[0].slug);
  assert.deepEqual(event.streams, channel.streams); assert.equal(event.event, true);
  assert.equal(all.length, 1); assert.equal(all[0].name, channel.name);
});
test('events pick up new sources and skip removed or unplayable channels', () => {
  const data = catalog(); data.channels[0].streams = ['http://example.com/live/test/pass/2.ts'];
  assert.deepEqual(events(merge(null, data), data)[0].streams, data.channels[0].streams);
  assert.deepEqual(events([], data), []);
  assert.deepEqual(events([{ id: 'sports', playable: false }], data), []);
});
test('rejects missing channel, cover, name, repeated event ids and malformed lists', () => {
  for (const update of [{ channelId: 'missing' }, { name: ' ' }, { id: '' }, { cover: 'http://example.com/x.jpg' }, { cover: 'javascript:alert(1)' }, { cover: 'data:image/svg+xml;base64,AAAA' }]) {
    const data = catalog(); Object.assign(data.events[0], update); assert.throws(() => validateCatalog(data));
  }
  const data = catalog(); data.events.push(match); assert.throws(() => validateCatalog(data));
  data.events = {}; assert.throws(() => validateCatalog(data));
});
test('supports compressed uploads and enforces image and catalog sizes', () => {
  assert.equal(validCover('data:image/jpeg;base64,/9j/AAAA'), true);
  assert.equal(validCover('https://user:pass@example.com/x.jpg'), false);
  assert.equal(validCover('data:image/png;base64,' + 'A'.repeat(180001)), false);
  const data = catalog(); data.events[0].cover = 'data:image/jpeg;base64,' + 'A'.repeat(125000);
  validateCatalog(data);
  data.events = Array.from({ length: 5 }, (_, i) => ({ ...data.events[0], id: `match-${i}` }));
  assert.throws(() => validateCatalog(data), /tamaño/);
});
