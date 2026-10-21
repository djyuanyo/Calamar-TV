import assert from 'node:assert/strict';
import test from 'node:test';
import { audienceTarget, liveBeats, presence, visitKey, madridDay, liveCounts, summarize, eventLabel, nextStart, sessionId } from '../web/audience.js';
const now = Date.parse('2026-12-01T19:30:20Z');
test('presence documents name only what is watched and readers accept nearby minutes', () => {
  assert.equal(audienceTarget({ id: 'la-1' }), 'c:la-1');
  assert.equal(audienceTarget({ event: true, id: 'match', eventId: 'match' }), 'e:match');
  const p = presence('c:la-1', now);
  assert.deepEqual(Object.keys(p).sort(), ['beat', 'minute', 'target']);
  assert.ok(liveBeats('c:la-1', now).includes(p.beat));
  assert.ok(liveBeats('c:la-1', now + 120000).includes(p.beat));
  assert.ok(!liveBeats('c:la-1', now + 240000).includes(p.beat));
  assert.match(sessionId(), /^[A-Za-z0-9]{24}$/);
});
test('live counts group recent viewers and ignore stale ones', () => {
  const m = Math.floor(now / 60000);
  const counts = liveCounts([{ target: 'c:a', minute: m }, { target: 'c:a', minute: m - 1 }, { target: 'e:x', minute: m }, { target: 'c:a', minute: m - 5 }], now);
  assert.deepEqual([...counts], [['c:a', 2], ['e:x', 1]]);
});
test('visit keys are safe field names and days follow Madrid', () => {
  assert.equal(visitKey('channel', 'la-1'), 'c_la-1');
  assert.equal(visitKey('event', 'evento x/1'), 'e_evento_x_1');
  assert.equal(madridDay(Date.parse('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(madridDay(Date.parse('2026-07-01T21:59:00Z')), '2026-07-01');
});
test('visits add up by day, month and year and can follow one channel', () => {
  const days = [{ id: '2026-11-30', data: { 'c_la-1': 2, last: 'c_la-1' } }, { id: '2026-12-01', data: { 'c_la-1': 1, e_m: 4 } }, { id: '2027-01-01', data: { e_m: 1 } }];
  assert.deepEqual([...summarize(days).totals], [['c_la-1', 3], ['e_m', 5]]);
  assert.deepEqual([...summarize(days, 'month').buckets], [['2026-11', 2], ['2026-12', 5], ['2027-01', 1]]);
  assert.deepEqual([...summarize(days, 'year', 'e_m').buckets], [['2026', 4], ['2027', 1]]);
});
test('events show their date and time until they start', () => {
  const event = { startAt: '2026-12-01T20:00:00.000Z', status: 'scheduled' };
  const before = eventLabel(event, now);
  assert.equal(before.upcoming, true); assert.equal(before.live, false);
  assert.match(before.text, /1 dic/); assert.match(before.text, /21:00/);
  assert.deepEqual(eventLabel(event, Date.parse('2026-12-01T20:00:00Z')), { text: 'En directo', live: true });
  assert.equal(eventLabel({ ...event, status: 'finished' }, now).text, 'Finalizado');
  assert.equal(eventLabel({ status: 'live' }, now).text, 'En directo');
  assert.equal(eventLabel({}, now, { scheduled: 'Programado' }).text, 'Programado');
  assert.equal(nextStart([event, { startAt: '' }, { startAt: '2026-01-01T00:00:00Z' }], now), 29 * 60000 + 40000);
  assert.equal(nextStart([], now), null);
});
