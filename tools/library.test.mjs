import test from 'node:test';
import assert from 'node:assert/strict';
import { episodeLabel, episodeTitle, nextEpisode, playable, recordProgress, removeProgress, progressList, progressPath, finished, clock, PROGRESS_LIMIT } from '../web/library.js';

const section = { key: 'series', page: 'series', label: 'Series' };
const paco = { id: 'spaco', kind: 'tv', title: 'Los hombres de Paco', tmdb: { title: 'Los hombres de Paco', backdrop: 'https://image.tmdb.org/b.jpg' },
  episodes: [{ id: 'e1', season: 1, episode: 1, url: 'https://calamarmenciano.com/S/1x01.mkv', name: 'Piloto' }, { id: 'e2', season: 1, episode: 2, url: 'https://calamarmenciano.com/S/1x02.mkv' }] };

test('1x01 is shown as Capítulo 1 and the next episode follows', () => {
  assert.equal(episodeLabel(paco.episodes[0]), 'Capítulo 1');
  assert.equal(episodeTitle(paco.episodes[0]), 'Piloto', 'the TMDB name replaces «Capítulo 1»');
  assert.equal(episodeTitle(paco.episodes[1]), 'Capítulo 2');
  const first = playable(section, paco, paco.episodes[0]);
  assert.equal(first.name, 'Los hombres de Paco · T1 · Piloto');
  assert.equal(first.progress.sub, 'Temporada 1 · Piloto');
  assert.equal(playable(section, paco, paco.episodes[1]).name, 'Los hombres de Paco · T1 · Capítulo 2');
  assert.equal(first.next().id, 'e2');
  assert.equal(nextEpisode(paco, paco.episodes[1]), null);
  assert.equal(playable(section, paco, paco.episodes[1]).next(), null);
});

test('progress keeps one entry per series and drops what was watched', () => {
  const one = playable(section, paco, paco.episodes[0]).progress, two = playable(section, paco, paco.episodes[1]).progress;
  let store = recordProgress({}, one, 5, 1500, 1);
  assert.deepEqual(store, {}, 'the first seconds are not saved');
  store = recordProgress(store, one, 600, 1500, 2);
  assert.equal(store.e1.position, 600);
  assert.equal(progressPath(store.e1), '#/series/spaco/ver/e1');
  store = recordProgress(store, two, 60, 1500, 3);
  assert.deepEqual(Object.keys(store), ['e2']);
  assert.ok(finished(1450, 1500));
  assert.ok(!finished(50, 60), 'a short part converted so far is not the end of the film');
  assert.deepEqual(recordProgress(store, two, 1450, 1500, 4), {});
  assert.deepEqual(removeProgress(store, 'e2'), {});
});

test('the 20 most recent are kept, newest first', () => {
  let store = {};
  for (let i = 0; i < PROGRESS_LIMIT + 3; i++) store = recordProgress(store, { key: `m${i}`, page: 'peliculas', item: `m${i}`, name: `P${i}` }, 100, 3000, i);
  const list = progressList(store);
  assert.equal(list.length, PROGRESS_LIMIT);
  assert.equal(list[0].key, `m${PROGRESS_LIMIT + 2}`);
  assert.equal(clock(3725), '1:02:05');
  assert.equal(clock(75), '1:15');
});
