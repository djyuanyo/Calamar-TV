import test from 'node:test';
import assert from 'node:assert/strict';
import { iptvPassword, iptvLink, madridEndOfDay, madridDate, iptvState } from '../web/iptv-lists.js';

test('codes are 10 easy letters and digits, as the rules and the hosting expect', () => {
  const a = iptvPassword(), b = iptvPassword();
  assert.match(a, /^[a-hjkmnp-z2-9]{10}$/);
  assert.notEqual(a, b);
  assert.equal(iptvLink(a), `https://calamarmenciano.com/i/?${a}`);
});

test('the chosen day is the last one the list works, in Spanish time', () => {
  assert.equal(madridEndOfDay('2026-12-31').toISOString(), '2026-12-31T22:59:59.000Z');
  assert.equal(madridEndOfDay('2026-07-15').toISOString(), '2026-07-15T21:59:59.000Z');
  assert.equal(madridDate(madridEndOfDay('2026-12-31')), '2026-12-31');
});

test('the state says whether the list works', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.match(iptvState(null, now), /no tiene/);
  assert.match(iptvState({ expires: null }, now), /sin fecha/);
  assert.match(iptvState({ expires: new Date(now + 1000) }, now), /activa hasta/);
  assert.match(iptvState({ expires: new Date(now - 1000) }, now), /caducada/);
});

import { iptvFolders, cleanIcons } from '../web/iptv-lists.js';
test('the icon folders include a separate live events folder', () => {
  const channels = [{ group: 'Deportes' }, { group: 'Generalistas' }, { group: 'Deportes' }, { group: 'Series' },
    { group: 'Eventos En Directo' }, { group: 'Web', playable: false }];
  assert.deepEqual(iptvFolders(channels), ['Canales', 'Deportes', 'Generalistas', 'Series (canales)', 'Eventos En Directo (canales)',
    'Eventos En Directo', 'Películas', 'Series', 'Documentales']);
  assert.deepEqual(cleanIcons({ Deportes: ' https://x.example/d.png ', Series: 'http://inseguro/s.png', Otra: 'https://x/o.png' }, ['Deportes', 'Series']),
    { Deportes: 'https://x.example/d.png' });
});

import { madridMoment, madridTime } from '../web/iptv-lists.js';
test('a list can expire at a chosen hour, in Spanish time', () => {
  assert.equal(madridMoment('2026-12-31', '18:30').toISOString(), '2026-12-31T17:30:00.000Z');
  assert.equal(madridMoment('2026-07-15', '00:05').toISOString(), '2026-07-14T22:05:00.000Z');
  assert.equal(madridMoment('2026-12-31', '').toISOString(), '2026-12-31T22:59:59.000Z');
  assert.equal(madridTime(madridMoment('2026-12-31', '18:30')), '18:30');
  assert.match(iptvState({ expires: madridMoment('2030-01-02', '09:15') }, Date.parse('2026-11-19T12:00:00Z')), /a las 09:15/);
});
