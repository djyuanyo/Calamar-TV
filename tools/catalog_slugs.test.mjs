import assert from 'node:assert/strict';
import test from 'node:test';
import { findChannel, merge, slugify } from '../web/catalog.js';

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
