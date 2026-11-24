import assert from 'node:assert/strict';
import test from 'node:test';
import { byChannelName, findChannel, groups, merge, slugify } from '../web/catalog.js';

const tdt = {
  channels: [
    { id: 'la-1', name: 'La 1', group: 'Generalistas', streams: ['https://example.com/la1.m3u8'] },
    { id: 'canal-sur', name: 'Canal Sur Andalucía', group: 'Autonómicos', streams: ['https://example.com/cs.m3u8'] },
  ],
};
const own = (id, name) => ({ id, name, streams: ['https://example.com/x.m3u8'] });

test('slugs come from the name, without accents or symbols', () => {
  assert.equal(slugify('Canal Sur Andalucía'), 'canal-sur-andalucia');
  assert.equal(slugify('  ¡¡Ñu!!  '), 'nu');
  assert.equal(slugify('***'), 'canal');
});

test('own channels get a slug from their name, not from the generated id', () => {
  const channels = merge(tdt, { channels: [own('mio-movistar-laliga-tv-mv9ucqg7', 'Movistar LaLiga TV')] });
  assert.equal(channels[0].slug, 'movistar-laliga-tv');
});

test('repeated names get -2, -3 and every slug is unique', () => {
  const channels = merge(tdt, { channels: [own('a', 'La 1'), own('b', 'La 1')] });
  const slugs = channels.map((c) => c.slug);
  assert.deepEqual(slugs.slice(0, 3), ['la-1', 'la-1-2', 'la-1-3']);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('links made with the old internal id still find the channel', () => {
  const channels = merge(tdt, { channels: [own('mio-xyz-1', 'Canal Menciana')] });
  assert.equal(findChannel(channels, 'canal-menciana').id, 'mio-xyz-1');
  assert.equal(findChannel(channels, 'mio-xyz-1').slug, 'canal-menciana');
  assert.equal(findChannel(channels, 'no-existe'), null);
});

test('logos with a copy on this web show the copy', async () => {
  const { merge, setLogoCopies } = await import('../web/catalog.js');
  const custom = { channels: [{ id: 'd', name: 'DAZN 1', logo: 'https://docdog.top/DAZN_1.png', streams: ['https://x.example/a.m3u8'] },
    { id: 'e', name: 'Otro', logo: 'https://other.example/e.png', streams: ['https://x.example/b.m3u8'] }], featured: [], hidden: [] };
  setLogoCopies({ 'https://docdog.top/DAZN_1.png': 'logos/d1d2ae4b65ac88a49c29625c.png', 'https://other.example/e.png': 'javascript:alert(1)' });
  const [dazn, other] = merge({ channels: [] }, custom);
  assert.equal(dazn.logo, 'logos/d1d2ae4b65ac88a49c29625c.png');
  assert.equal(other.logo, 'https://other.example/e.png');
  setLogoCopies({});
});

test('channel displays sort accents and numbers naturally without changing shared slugs', () => {
  const names = ['Liga de Campeones 10', 'Liga de Campeones 2', 'Liga de Campeones 9', 'Ágora', 'Zeta'];
  const channels = merge(null, { channels: names.map((name, i) => own(String(i), name)) });
  const expected = ['Ágora', 'Liga de Campeones 2', 'Liga de Campeones 9', 'Liga de Campeones 10', 'Zeta'];
  assert.deepEqual(groups(channels).get('Calamar TV').map(c => c.name), expected);
  assert.deepEqual([...channels].sort(byChannelName).map(c => c.name), expected);
  assert.equal(findChannel(channels, 'liga-de-campeones-10').id, '0');
  assert.deepEqual(channels.map(c => c.name), names);
});
