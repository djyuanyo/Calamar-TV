import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, toggleList, rate, toggleFavorite, listEntries, lastLiked, newerData, emptyData, MAX_PROFILES } from '../web/profiles.js';

test('profiles: the first is «main», the others get short ids the rules accept, up to five, names not repeated', () => {
  const first = newProfile([], 'Juan', '#e50914');
  assert.deepEqual(first, { id: 'main', name: 'Juan', color: '#e50914' });
  const second = newProfile([first], ' Ana ', 'no-es-un-color', () => 0.5);
  assert.match(second.id, /^p[a-z0-9]{1,6}$/);
  assert.equal(second.name, 'Ana');
  assert.equal(second.color.startsWith('#'), true);
  assert.throws(() => newProfile([first], 'juan'), /Ya hay un perfil/);
  assert.throws(() => newProfile([first], '  '), /nombre/);
  const full = Array.from({ length: MAX_PROFILES }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  assert.throws(() => newProfile(full, 'Otro'), /hasta 5/);
});

test('«Mi lista», likes and favourite channels toggle, and the newer copy wins', () => {
  let data = emptyData();
  data = toggleList(data, 'peliculas', 'm1', 10);
  data = toggleList(data, 'series', 's1', 20);
  assert.deepEqual(listEntries(data).map((e) => e.item), ['s1', 'm1']);
  data = toggleList(data, 'peliculas', 'm1', 30);
  assert.deepEqual(listEntries(data).map((e) => e.item), ['s1']);
  data = rate(data, 'peliculas', 'm2', 1, 40);
  data = rate(data, 'peliculas', 'm3', -1, 50);
  assert.equal(lastLiked(data).item, 'm2');
  data = rate(data, 'peliculas', 'm2', 1, 60);
  assert.equal(lastLiked(data), null);
  data = toggleFavorite(data, 'la-1', 70);
  assert.ok(data.favorites['la-1']);
  assert.equal(toggleFavorite(data, 'la-1', 80).favorites['la-1'], undefined);
  assert.equal(newerData({ updatedAt: 5 }, { updatedAt: 9 }).updatedAt, 9);
  assert.equal(newerData({ updatedAt: 9 }, null).updatedAt, 9);
});

test('each profile remembers what it played, the latest 200', async () => {
  const { markWatched, watchedEntries, WATCHED_LIMIT } = await import('../web/profiles.js');
  let data = emptyData();
  for (let i = 0; i < WATCHED_LIMIT + 5; i++) data = markWatched(data, 'peliculas', `m${i}`, i);
  assert.equal(Object.keys(data.watched).length, WATCHED_LIMIT);
  assert.equal(watchedEntries(data)[0].item, `m${WATCHED_LIMIT + 4}`);
  assert.equal(data.watched['peliculas/m0'], undefined);
});
