import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOptions, selectedSource, renderSourcePicker } from '../web/player-sources.js';

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

test('single sources stay in the catalog and empty catalogs have no selection', () => {
  assert.equal(sourceOptions(['https://one.example/a.m3u8']).length, 1);
  assert.equal(selectedSource([], 0), null);
  assert.equal(selectedSource(sourceOptions(['https://one.example/a.m3u8?e=1000000000']), 0), null);
});


test('source selector appears only for multiple sources and disappears when returning to one', () => {
  const doc = { createElement: () => ({ children: [], setAttribute() {}, addEventListener() {},
    append(...items) { this.children.push(...items); } }) };
  const container = { ownerDocument: doc, children: [], hidden: false,
    replaceChildren(...items) { this.children = items; } };
  const sources = sourceOptions(['https://one.example/a.m3u8', 'https://two.example/a.m3u8']);
  renderSourcePicker(container, sources, 0, () => {});
  assert.equal(container.hidden, false);
  assert.equal(container.children[0].children[1].children.length, 2);
  renderSourcePicker(container, sources.slice(0, 1), 0, () => {});
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
  renderSourcePicker(container, [], 0, () => {});
  assert.equal(container.hidden, true);
});
