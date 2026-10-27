import test from 'node:test';
import assert from 'node:assert/strict';

// A browser's localStorage, for saveProgress and its removals.
const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
const { mergeProgress, progressToCloud, progressFromCloud, saveProgress, loadProgress, loadRemoved, onProgressSaved, PROGRESS_LIMIT } = await import('../web/library.js');

const NOW = Date.UTC(2026, 9, 27);
const entry = (key, at, extra = {}) => ({ key, section: 'series', item: 'show', episode: key, name: 'Serie', sub: '', image: '', position: 60, duration: 1500, at, ...extra });

test('the latest thing done on any device wins: watching again, or removing', () => {
  const phone = { entries: { e2: entry('e2', NOW - 1000) }, removed: {} };
  const web = { entries: {}, removed: { e2: NOW - 5000 } };
  assert.deepEqual(Object.keys(mergeProgress(phone, web, NOW).entries), ['e2']);
  const removedLater = { entries: {}, removed: { e2: NOW } };
  const merged = mergeProgress(phone, removedLater, NOW);
  assert.deepEqual(merged.entries, {});
  assert.equal(merged.removed.e2, NOW);
});

test('the newer position of the same episode is kept, and one entry per series', () => {
  const a = { entries: { e1: entry('e1', NOW - 9000, { position: 100 }) }, removed: {} };
  const b = { entries: { e1: entry('e1', NOW - 1000, { position: 900 }), e2: entry('e2', NOW - 500) }, removed: {} };
  const merged = mergeProgress(a, b, NOW);
  assert.deepEqual(Object.keys(merged.entries), ['e2']);
  const film = { entries: { f: { ...entry('f', NOW - 100), section: 'movies', item: 'film', episode: '' } }, removed: {} };
  assert.deepEqual(Object.keys(mergeProgress(a, film, NOW).entries).sort(), ['e1', 'f']);
  assert.equal(mergeProgress(a, b, NOW).entries.e2.position, 60);
});

test('at most the 20 most recent titles, and old removals are forgotten', () => {
  const many = { entries: {}, removed: { old: NOW - 61 * 86400000, recent: NOW - 86400000 } };
  for (let i = 0; i < 25; i++) many.entries[`k${i}`] = { ...entry(`k${i}`, NOW - i), item: `show${i}` };
  const merged = mergeProgress(many, {}, NOW);
  assert.equal(Object.keys(merged.entries).length, PROGRESS_LIMIT);
  assert.ok(merged.entries.k0 && !merged.entries.k24);
  assert.deepEqual(Object.keys(merged.removed), ['recent']);
});

test('the browser row and the shared form convert both ways (pages ↔ sections)', () => {
  const store = { e1: { key: 'e1', page: 'series', item: 'show', episode: 'e1', name: 'Serie', sub: 'T1 · Piloto', image: 'i.jpg', position: 61.7, duration: 1500, at: NOW },
    f1: { key: 'f1', page: 'peliculas', item: 'film', episode: '', name: 'Peli', sub: '2024', image: '', position: 30, duration: 6000, at: NOW - 1 } };
  const cloud = progressToCloud(store, { gone: NOW });
  assert.equal(cloud.entries.f1.section, 'movies');
  assert.equal(cloud.entries.e1.position, 61);
  const back = progressFromCloud(cloud);
  assert.equal(back.store.f1.page, 'peliculas');
  assert.deepEqual(back.removed, { gone: NOW });
});

test('what disappears from the row here is noted as removed, so other devices do not bring it back', () => {
  memory.clear();
  let calls = 0;
  const stop = onProgressSaved(() => calls++);
  const one = { key: 'f1', page: 'peliculas', item: 'film', episode: '', name: 'Peli', sub: '', image: '', position: 30, duration: 6000, at: NOW - 10 };
  saveProgress({ f1: one }, { now: NOW - 5 });
  saveProgress({}, { now: NOW });
  assert.deepEqual(loadProgress(), {});
  assert.equal(loadRemoved().f1, NOW);
  // Watching it again later clears the removal.
  saveProgress({ f1: { ...one, at: NOW + 10 } }, { now: NOW + 10 });
  assert.equal(loadRemoved().f1, undefined);
  saveProgress({}, { quiet: true, removed: {} });
  assert.equal(calls, 3);
  stop();
});
