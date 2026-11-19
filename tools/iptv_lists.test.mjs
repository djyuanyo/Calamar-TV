import test from 'node:test';
import assert from 'node:assert/strict';
import { iptvPassword, iptvLink, madridEndOfDay, madridDate, iptvState } from '../web/iptv-lists.js';

test('passwords are 32 random letters and digits, as the rules and the hosting expect', () => {
  const a = iptvPassword(), b = iptvPassword();
  assert.match(a, /^[A-Za-z0-9]{32}$/);
  assert.notEqual(a, b);
  assert.equal(iptvLink(a), `https://calamarmenciano.com/calamar-iptv.php?lista=${a}`);
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
test('the icon folders are the channel categories, then films, series and documentaries', () => {
  const channels = [{ group: 'Deportes' }, { group: 'Generalistas' }, { group: 'Deportes' }, { group: 'Series' }, { group: 'Web', playable: false }];
  assert.deepEqual(iptvFolders(channels), ['Deportes', 'Generalistas', 'Películas', 'Series', 'Documentales']);
  assert.deepEqual(cleanIcons({ Deportes: ' https://x.example/d.png ', Series: 'http://inseguro/s.png', Otra: 'https://x/o.png' }, ['Deportes', 'Series']),
    { Deportes: 'https://x.example/d.png' });
});
