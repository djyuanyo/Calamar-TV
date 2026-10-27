import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, events, syncTdtCopies } from '../web/catalog.js';
import { validateCatalog } from '../web/shared-catalog.js';

const tdt = { channels: [{ id: 'la1', name: 'La 1', group: 'Generalistas', logo: 'https://example.com/la1.png', streams: ['https://example.com/la1-new.m3u8'] }] };
const own = { id: 'mio', name: 'Mi canal', streams: ['https://example.com/mio.m3u8'] };

test('an event on a TDT channel keeps a copy of it among the catalog channels, for older apps', () => {
  const data = { channels: [own], featured: [], hidden: [], events: [{ id: 'e1', name: 'Partido', cover: 'https://example.com/p.jpg', channelId: 'la1', startAt: '2026-12-01T20:00:00.000Z' }] };
  const channels = syncTdtCopies(data, tdt);
  assert.deepEqual(channels.map((c) => [c.id, !!c.tdt]), [['mio', false], ['la1', true]]);
  assert.deepEqual(channels[1].streams, ['https://example.com/la1-new.m3u8']);
  // Older apps validate events against the catalog's own channels: the copy makes it valid.
  assert.doesNotThrow(() => validateCatalog({ ...data, channels }));
  assert.throws(() => validateCatalog(data), /canal creado/);
});

test('copies nothing uses go away, and a copy stays when TDT no longer has that channel', () => {
  const stale = { id: 'la1', name: 'La 1', streams: ['https://example.com/la1-old.m3u8'], tdt: true };
  assert.deepEqual(syncTdtCopies({ channels: [own, stale], events: [] }, tdt).map((c) => c.id), ['mio']);
  const kept = syncTdtCopies({ channels: [own, stale], events: [{ channelId: 'la1' }] }, { channels: [] });
  assert.equal(kept[1].streams[0], 'https://example.com/la1-old.m3u8');
  assert.deepEqual(syncTdtCopies({ channels: [own], events: [], fixtures: [{ channelId: 'la1' }] }, tdt).map((c) => c.id), ['mio', 'la1']);
});

test('the current TDT channel wins over its copy, shown as a TDT channel, and the event plays it', () => {
  const custom = { channels: [own, { id: 'la1', name: 'La 1', streams: ['https://example.com/la1-old.m3u8'], tdt: true }], featured: [], hidden: [],
    events: [{ id: 'e1', name: 'Partido', cover: 'https://example.com/p.jpg', channelId: 'la1', startAt: '2099-12-01T20:00:00.000Z' }] };
  const channels = merge(tdt, custom);
  const la1 = channels.filter((c) => c.id === 'la1');
  assert.equal(la1.length, 1);
  assert.equal(la1[0].own, false);
  assert.deepEqual(la1[0].streams, ['https://example.com/la1-new.m3u8']);
  assert.equal(events(channels, custom)[0].channelName, 'La 1');
  // Without the TDT list (or once TDT drops it) the copy plays, still not as a channel of yours.
  const alone = merge({ channels: [] }, custom).find((c) => c.id === 'la1');
  assert.equal(alone.own, false);
  assert.deepEqual(alone.streams, ['https://example.com/la1-old.m3u8']);
});
