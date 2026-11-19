import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLimits, expiredAt, otherScreens, overLimit, FRESH_MS, DEFAULT_SCREENS } from '../web/screen-limit.js';

const now = Date.parse('2026-11-19T12:00:00Z');
const at = ms => ({ toDate: () => new Date(now - ms) });

test('accounts without settings get one screen and no expiry', () => {
  assert.deepEqual(accountLimits(null), { expires: null, screens: DEFAULT_SCREENS });
  assert.equal(accountLimits({ screens: 4 }).screens, 4);
  assert.equal(accountLimits({ screens: 0 }).screens, 1);
  assert.equal(accountLimits({ screens: 2.5 }).screens, 1);
});

test('access ends when the date arrives, never without a date', () => {
  assert.equal(expiredAt(accountLimits({}), now), false);
  assert.equal(expiredAt(accountLimits({ expires: { toDate: () => new Date(now + 1000) } }), now), false);
  assert.equal(expiredAt(accountLimits({ expires: { toDate: () => new Date(now) } }), now), true);
});

test('screens count once per tab or app, without this one or stale ones', () => {
  const entries = [
    { id: 'a', screen: 'tabA', updatedAt: at(1000) },
    { id: 'b', screen: 'tabA', updatedAt: at(2000) },
    { id: 'c', screen: 'mine', updatedAt: at(1000) },
    { id: 'd', screen: 'tabOld', updatedAt: at(FRESH_MS + 1) },
    { id: 'olderApp', updatedAt: at(1000) },
  ];
  assert.equal(otherScreens(entries, 'mine', now), 2);
  assert.equal(overLimit(entries, 'mine', { screens: 2 }, now), true);
  assert.equal(overLimit(entries, 'mine', { screens: 3 }, now), false);
  assert.equal(overLimit([], 'mine', null, now), false);
  assert.equal(overLimit([{ id: 'x', screen: 'tv', updatedAt: at(5) }], 'mine', null, now), true);
});
