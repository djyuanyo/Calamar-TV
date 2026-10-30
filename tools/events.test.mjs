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
  assert.equal(event.id, match.id); assert.equal(event.slug, 'local-vs-visitante'); assert.equal(event.channelId, channel.id);
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
test('a finished match leaves the home page but its own link still opens it', async () => {
  const { rememberMatch } = await import('../web/match-scores.js');
  const { FINISHED } = await import('../web/catalog.js');
  const data = catalog();
  data.events[0] = { ...data.events[0], matchUrl: 'https://www.google.com/search?q=Local%20vs%20visitante', matchId: '90000077' };
  const all = merge(null, data), now = Date.parse('2026-10-26T20:00:00Z');
  rememberMatch('90000077', { state: 'finished', finishedAt: now - 3600000 }, now);
  assert.deepEqual(events(all, data, now), []);
  const [kept] = events(all, data, now, { finished: true });
  assert.equal(kept.slug, 'local-vs-visitante'); assert.equal(kept.playable, true);
  // Without its channel any more: the match alone, said as finished.
  data.events[0].channelId = 'gone';
  const [alone] = events(all, data, now, { finished: true });
  assert.equal(alone.pending, true); assert.equal(alone.channelName, FINISHED); assert.match(alone.meta, /Partido finalizado$/);
  assert.deepEqual(events(all, data, now), []);
});

test('manual links combine with the channel, deduplicate, and work without a channel', () => {
  const data = catalog(), link = 'https://bp.zicotv.cc/events/98019';
  data.events[0].streams = [channel.streams[0], link];
  validateCatalog(data);
  assert.deepEqual(events(merge(null, data), data)[0].streams, [channel.streams[0], link]);
  data.events[0].channelId = '';
  validateCatalog(data);
  assert.deepEqual(events([], data)[0].streams, [channel.streams[0], link]);
  for (const streams of [['javascript:alert(1)'], ['https://u:p@example.com/'], {}, [42]]) {
    data.events[0].streams = streams;
    assert.throws(() => validateCatalog(data));
  }
});

test('«Eventos En Directo»: only today\'s events with video, in kick-off order', async () => {
  const { liveEvents } = await import('../web/catalog.js');
  const now = Date.parse('2026-10-27T20:30:00Z');
  const e = (id, startAt, streams = ['https://x/a.m3u8']) => ({ id, event: true, playable: streams.length > 0, streams, startAt });
  const list = [e('late', '2026-10-27T21:00:00Z'), e('early', '2026-10-27T18:00:00Z'), e('noVideo', '2026-10-27T19:00:00Z', []),
    e('tomorrow', '2026-10-28T19:00:00Z'), e('yesterday', '2026-10-26T19:00:00Z'), { id: 'channel', playable: true, streams: ['https://x'] }];
  assert.deepEqual(liveEvents(list, now).map((x) => x.id), ['early', 'late']);
  // Past midnight in Madrid, a match that started before it is still on air.
  assert.deepEqual(liveEvents([e('night', '2026-10-27T22:30:00Z')], Date.parse('2026-10-27T23:30:00Z')).map((x) => x.id), ['night']);
});

test('league rows show only this week\'s events (Monday to Sunday, Madrid)', async () => {
  const { thisWeekEvents } = await import('../web/catalog.js');
  const now = Date.parse('2026-10-28T10:00:00Z'); // Wednesday
  const e = (id, startAt, leagueId = 'laliga') => ({ id, startAt, leagueId });
  const list = [e('monday', '2026-10-26T19:00:00Z'), e('sunday', '2026-11-01T20:00:00Z'), e('next-week', '2026-11-03T19:00:00Z'),
    e('in-two-weeks', '2026-11-10T19:00:00Z'), e('no-league', '2026-11-10T19:00:00Z', ''), e('no-date', '', 'laliga')];
  assert.deepEqual(thisWeekEvents(list, now).map((x) => x.id), ['monday', 'sunday', 'no-league', 'no-date']);
  // Sunday night in Madrid is still this week; a match of last Sunday still on air stays on Monday at 00:30.
  assert.deepEqual(thisWeekEvents([e('late', '2026-11-01T22:30:00Z')], Date.parse('2026-11-01T23:30:00Z')).map((x) => x.id), ['late']);
});

test('league rows follow the order set in the admin page, then the rest by their next event', async () => {
  const { eventRows } = await import('../web/catalog.js');
  const leagues = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const list = [{ id: 1, leagueId: 'a' }, { id: 2, leagueId: 'b' }, { id: 3, leagueId: '' }, { id: 4, leagueId: 'c' }];
  assert.deepEqual(eventRows(list, { leagues }).map((r) => r.name), ['A', 'B', 'C', 'Otros eventos']);
  assert.deepEqual(eventRows(list, { leagues, leagueOrder: ['c', 'a'] }).map((r) => r.name), ['C', 'A', 'B', 'Otros eventos']);
});

import { leagueSlugs, leagueEvents } from '../web/catalog.js';
test('each league has its link and a page with its matches that have a channel', () => {
  const custom = { channels: [{ id: 'c1', name: 'Canal', streams: ['https://x.example/a.m3u8'] }], featured: [], hidden: [],
    leagues: [{ id: 'l1', name: 'LaLiga' }, { id: 'l2', name: 'Premier League' }, { id: 'l3', name: 'LaLiga' }],
    teams: [{ id: 'h', name: 'Local' }, { id: 'a', name: 'Visitante' }],
    events: [{ id: 'e1', name: 'Con canal', leagueId: 'l1', channelId: 'c1', startAt: '2026-12-01T20:00:00Z', cover: 'https://x.example/c.jpg' },
      { id: 'e2', name: 'De otra liga', leagueId: 'l2', channelId: 'c1', startAt: '2026-12-01T20:00:00Z', cover: 'https://x.example/c.jpg' }],
    fixtures: [{ id: 'partido-9', leagueId: 'l1', homeTeamId: 'h', awayTeamId: 'a', startAt: '2026-12-20T20:00:00Z', matchId: '9' }] };
  assert.deepEqual([...leagueSlugs(custom)], [['l1', 'laliga'], ['l2', 'premier-league'], ['l3', 'laliga-2']]);
  const channels = [{ id: 'c1', name: 'Canal', streams: ['https://x.example/a.m3u8'], playable: true }];
  // The imported match without a channel («Canal por confirmar») is left out.
  assert.deepEqual(leagueEvents(channels, custom, 'l1', Date.parse('2026-11-30T12:00:00Z')).map((e) => e.id), ['e1']);
});

test('league pages show only linked matches of the current Madrid week, including earlier days', async () => {
  const { rememberMatch } = await import('../web/match-scores.js');
  const now = Date.parse('2026-10-30T12:00:00Z');
  const base = { leagueId: 'l', cover: 'https://x.example/c.jpg', channelId: 'c', name: 'Partido' };
  const custom = { leagues: [{ id: 'l', name: 'Liga' }], events: [
    { ...base, id: 'previous', startAt: '2026-10-25T22:59:59Z' },
    { ...base, id: 'monday', startAt: '2026-10-25T23:00:00Z', matchId: 'weekly-ended', matchUrl: 'https://www.google.com/search?q=Local+Visitante' },
    { ...base, id: 'tomorrow', startAt: '2026-10-31T19:00:00Z', channelId: '', streams: ['https://x.example/manual.m3u8'] },
    { ...base, id: 'sunday', startAt: '2026-11-01T22:59:59Z' },
    { ...base, id: 'next', startAt: '2026-11-01T23:00:00Z' },
    { ...base, id: 'undated', startAt: '' },
    { ...base, id: 'without-link', startAt: '2026-10-31T19:00:00Z', channelId: '' },
  ] };
  const channels = [{ id: 'c', playable: true, streams: ['https://x.example/live.m3u8'] }];
  rememberMatch('weekly-ended', { state: 'finished', finishedAt: now - 3600000 }, now);
  assert.deepEqual(leagueEvents(channels, custom, 'l', now).map(e => e.id), ['monday', 'tomorrow', 'sunday']);
  assert.deepEqual(leagueEvents(channels, custom, 'l', Date.parse('2026-11-01T23:00:00Z')).map(e => e.id), ['next']);
});

test('the app updates go to everyone or only to the administrator, nothing else', async () => {
  const { validateCatalog } = await import('../web/shared-catalog.js');
  const base = { channels: [], featured: [], hidden: [] };
  assert.equal(validateCatalog({ ...base, appUpdates: 'admin' }).appUpdates, 'admin');
  assert.equal(validateCatalog({ ...base, appUpdates: 'all' }).appUpdates, 'all');
  assert.throws(() => validateCatalog({ ...base, appUpdates: 'yes' }), /actualizaciones/);
});
