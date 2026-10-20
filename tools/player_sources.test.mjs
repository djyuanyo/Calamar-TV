import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOptions, selectedSource } from '../web/player-sources.js';

test('Liga Campeones retains both sources when the second signed URL has expired', () => {
  const sources = sourceOptions([
    'https://one.example/channel.m3u8',
    'https://two.example/mono.m3u8?token=abc-def-1792498835-',
  ], Date.parse('2026-10-20T12:24:50Z'));
  assert.equal(sources.length, 2);
  assert.equal(sources[0].available, true);
  assert.equal(sources[1].label, 'Fuente 2');
  assert.equal(sources[1].reason, 'Caducada');
  assert.equal(selectedSource(sources, 1).index, 0);
});

test('source numbering stays stable when earlier links cannot play', () => {
  const sources = sourceOptions(['http://one.example/a.m3u8', 'https://two.example/a.m3u8', 'https://three.example/b.m3u8']);
  assert.equal(sources[0].available, false);
  assert.equal(selectedSource(sources, 0).label, 'Fuente 2');
  assert.equal(selectedSource(sources, 2).label, 'Fuente 3');
  assert.equal(sources[0].index, 0);
});

test('one configured source remains visible and empty catalogs have no selection', () => {
  assert.equal(sourceOptions(['https://one.example/a.m3u8']).length, 1);
  assert.equal(selectedSource([], 0), null);
  assert.equal(selectedSource(sourceOptions(['https://one.example/a.m3u8?e=1000000000']), 0), null);
});
