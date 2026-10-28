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

test('Google Drive videos play in the browser; other Google API links do not', async () => {
  const { webPlayback } = await import('../web/catalog.js');
  assert.deepEqual(webPlayback('https://www.googleapis.com/drive/v3/files/1AbC_d-9?alt=media&key=AIzaX'), { ok: true, kind: 'video' });
  assert.equal(webPlayback('https://www.googleapis.com/drive/v3/files/1AbC').ok, false);
  assert.equal(webPlayback('https://www.googleapis.com/youtube/v3/videos?alt=media').ok, false);
});

test('the library is read from Firestore: the index names the parts of each section', async () => {
  const { fetchLibrary, LIBRARY_DOCS } = await import('../web/library.js');
  const docs = { index: { sections: { movies: 2, series: 0 }, attribution: 'TMDB' }, 'movies-0': { items: [{ id: 'm1' }] }, 'movies-1': { items: [{ id: 'm2' }] } };
  const asked = [];
  const library = await fetchLibrary({ fresh: true, fetcher: async (url) => {
    asked.push(url);
    const name = url.slice(LIBRARY_DOCS.length).split('?')[0];
    return docs[name] ? { ok: true, status: 200, json: async () => ({ fields: { json: { stringValue: JSON.stringify(docs[name]) } } }) } : { ok: false, status: 404 };
  } });
  assert.deepEqual(library.sections.movies.map((m) => m.id), ['m1', 'm2']);
  assert.deepEqual(library.sections.series, []);
  assert.equal(library.attribution, 'TMDB');
  assert.match(asked[0], /databases\/\(default\)\/documents\/calamarLibrary\/index\?key=AIza/);
  const empty = await fetchLibrary({ fresh: true, fetcher: async () => ({ ok: false, status: 404 }) });
  assert.deepEqual(empty.sections, {});
});

test('filters: name, category, year, platform, releases and new arrivals, and the order', async () => {
  const { filterLibrary, isNewArrival, isRecentRelease } = await import('../web/library.js');
  const now = Date.parse('2026-10-28T12:00:00Z');
  const item = (id, year, extra = {}) => ({ id, title: id, kind: 'movie', ...extra, tmdb: { title: id, year, genres: ['Drama'], providers: [], rating: 5, ...(extra.tmdb || {}) } });
  const items = [
    item('nueva', 2026, { addedAt: '2026-10-20', tmdb: { providers: ['Netflix'], released: '2026-09-01', rating: 7 } }),
    item('vieja-anadida', 2019, { addedAt: '2026-10-25', tmdb: { genres: ['Comedia'], rating: 8 } }),
    item('estreno-antiguo', 2026, { addedAt: '2026-08-01', tmdb: { released: '2026-02-01', providers: ['Prime Video'] } }),
    item('clasica', 1998),
  ];
  assert.deepEqual(items.filter((i) => isNewArrival(i, now)).map((i) => i.id), ['nueva']);
  assert.deepEqual(items.filter((i) => isRecentRelease(i, now)).map((i) => i.id), ['nueva', 'estreno-antiguo']);
  const ids = (f) => filterLibrary(items, f, now).map((i) => i.id);
  assert.deepEqual(ids({ only: 'nuevas' }), ['nueva']);
  assert.deepEqual(ids({ only: 'estrenos' }), ['nueva', 'estreno-antiguo']);
  assert.deepEqual(ids({ platform: 'Netflix' }), ['nueva']);
  assert.deepEqual(ids({ year: '1998' }), ['clasica']);
  assert.deepEqual(ids({ genre: 'Comedia' }), ['vieja-anadida']);
  assert.deepEqual(ids({ q: 'clas' }), ['clasica']);
  assert.deepEqual(ids({ order: 'added' }), ['vieja-anadida', 'nueva', 'estreno-antiguo', 'clasica']);
  assert.deepEqual(ids({ order: 'rating' }).slice(0, 2), ['vieja-anadida', 'nueva']);
});

test('each title keeps the day it arrived, new ones get today, and TMDB platforms are read for Spain', async () => {
  const { stampAdded, providersOf } = await import('../web/library-tmdb.js');
  const before = { movies: [{ id: 'old' }, { id: 'dated', addedAt: '2026-01-02' }] };
  const next = stampAdded({ movies: [{ id: 'old' }, { id: 'dated' }, { id: 'fresh' }] }, before, '2026-10-28');
  assert.deepEqual(next.movies.map((i) => i.addedAt), [undefined, '2026-01-02', '2026-10-28']);
  assert.deepEqual(providersOf({ 'watch/providers': { results: { ES: { flatrate: [{ provider_name: 'Netflix' }], ads: [{ provider_name: 'Pluto TV' }], buy: [{ provider_name: 'Apple TV' }] }, US: { flatrate: [{ provider_name: 'Hulu' }] } } } }), ['Netflix', 'Pluto TV']);
  assert.deepEqual(providersOf({}), []);
});
