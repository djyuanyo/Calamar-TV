import test from 'node:test';
import assert from 'node:assert/strict';
import { searchTmdb, tmdbDetails, seasonEpisodes, movieItem, seriesWithSeason, libraryParts } from '../web/library-tmdb.js';
import { lulustreamEmbed, webPlayback } from '../web/catalog.js';
import { validVideoLink } from '../web/library.js';

const fake = (bodies, calls = []) => async (url, init) => {
  calls.push([url, init?.headers?.Authorization]);
  const path = new URL(url).pathname;
  const body = Object.entries(bodies).find(([end]) => path.endsWith(end))?.[1];
  return body ? { status: 200, json: async () => body } : { status: 404, json: async () => ({}) };
};

test('search: films, series, or both for documentaries (people are left out)', async () => {
  const calls = [];
  const fetcher = fake({ '/search/multi': { results: [{ media_type: 'person', name: 'Alguien' }, { media_type: 'tv', id: 2, name: 'Planeta Tierra', first_air_date: '2006-03-05' },
    { media_type: 'movie', id: 3, title: 'Océanos', release_date: '2009-10-17', poster_path: '/o.jpg' }] },
    '/search/movie': { results: [{ id: 19995, title: 'Avatar', release_date: '2009-12-15' }] } }, calls);
  assert.deepEqual((await searchTmdb('planeta', 'any', 'abcdef0123456789abcdef0123456789', fetcher)).map((r) => [r.kind, r.title, r.year]), [['tv', 'Planeta Tierra', 2006], ['movie', 'Océanos', 2009]]);
  const [avatar] = await searchTmdb('Avatar', 'movie', 'abcdef0123456789abcdef0123456789', fetcher);
  assert.deepEqual([avatar.kind, avatar.id], ['movie', 19995]);
  assert.match(calls[0][0], /search\/multi.*api_key=abcdef/);
});

test('a series gives its seasons and the episodes of the chosen season', async () => {
  const calls = [];
  const fetcher = fake({ '/tv/4500': { name: 'Los hombres de Paco', first_air_date: '2005-10-09', vote_average: 7.14, genres: [{ name: 'Comedia' }],
      seasons: [{ season_number: 0, name: 'Especiales', episode_count: 2 }, { season_number: 2, name: 'Temporada 2', episode_count: 13 }, { season_number: 1, name: 'Temporada 1', episode_count: 8 }] },
    '/tv/4500/season/1': { episodes: [{ episode_number: 1, name: 'Piloto', overview: 'Empieza', still_path: '/s.jpg' }, { episode_number: 2, name: 'Dos' }] } }, calls);
  const { info, seasons } = await tmdbDetails(4500, 'tv', 'eyJ.v4.token', fetcher);
  assert.deepEqual([info.title, info.rating, info.genres], ['Los hombres de Paco', 7.1, ['Comedia']]);
  assert.deepEqual(seasons.map((s) => s.season), [1, 2, 0], 'specials last');
  assert.equal(calls[0][1], 'Bearer eyJ.v4.token');
  const episodes = await seasonEpisodes(4500, 1, 'eyJ.v4.token', fetcher);
  assert.deepEqual(episodes.map((e) => [e.episode, e.name, e.still]), [[1, 'Piloto', 'https://image.tmdb.org/t/p/w300/s.jpg'], [2, 'Dos', '']]);
  // Saving season 1 keeps season 2, replaces the links of season 1 and leaves out episodes without link.
  const before = { episodes: [{ id: 'e4500x2x1', season: 2, episode: 1, url: 'https://lulustream.com/aaaaaaaaaaaa' }, { id: 'e4500x1x2', season: 1, episode: 2, url: 'https://lulustream.com/old000000000' }] };
  const item = seriesWithSeason(before, info, 1, episodes, { 1: ' https://lulustream.com/bbbbbbbbbbbb ', 2: '' });
  assert.deepEqual(item.episodes.map((e) => [e.id, e.url]), [['e4500x1x1', 'https://lulustream.com/bbbbbbbbbbbb'], ['e4500x2x1', 'https://lulustream.com/aaaaaaaaaaaa']]);
  assert.deepEqual([item.id, item.kind, item.episodes[0].name], ['s4500', 'tv', 'Piloto']);
  const film = movieItem({ id: 19995, title: 'Avatar', year: 2009 }, 'https://lulustream.com/cccccccccccc');
  assert.deepEqual([film.id, film.kind, film.url, film.status], ['m19995', 'movie', 'https://lulustream.com/cccccccccccc', 'matched']);
});

test('LuluStream links play in our player through the hosting; direct videos straight', () => {
  assert.equal(lulustreamEmbed('https://lulustream.com/abc123def456'), 'https://luluvido.com/e/abc123def456');
  assert.equal(lulustreamEmbed('https://luluvido.com/d/duj5ak4x5waa'), 'https://luluvido.com/e/duj5ak4x5waa');
  assert.equal(lulustreamEmbed('https://lulu.st/e/duj5ak4x5waa'), 'https://luluvido.com/e/duj5ak4x5waa');
  assert.equal(lulustreamEmbed('https://luluvido.com.evil.net/d/duj5ak4x5waa'), null);
  assert.deepEqual(webPlayback('https://luluvido.com/d/duj5ak4x5waa'), { ok: true, kind: 'hls', address: 'https://calamarmenciano.com/calamar-lulu.php?code=duj5ak4x5waa&hls=1' });
  assert.equal(lulustreamEmbed('https://www.lulustream.com/d/abc123def456.html'), 'https://luluvido.com/e/abc123def456');
  assert.equal(lulustreamEmbed('https://lulustream.com/fld/h9vd4z179z'), null, 'a folder is not a video');
  assert.equal(lulustreamEmbed('https://evil.example/abc123def456'), null);
  assert.equal(webPlayback('https://luluvido.com/e/abc123def456').kind, 'hls');
  assert.ok(validVideoLink('https://lulustream.com/abc123def456'));
  assert.ok(validVideoLink('https://example.com/pelicula.mp4'));
  assert.ok(!validVideoLink('https://lulustream.com/fld/h9vd4z179z'));
  assert.ok(!validVideoLink('http://example.com/pelicula.mp4'));
});

test('the library is split in Firestore parts below the size limit', () => {
  const big = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, overview: 'x'.repeat(40000) }));
  const { index, parts } = libraryParts({ movies: big, series: [] }, '2026-01-01');
  assert.ok(index.sections.movies > 1);
  assert.equal(index.sections.series, 1);
  for (const part of Object.values(parts)) assert.ok(new TextEncoder().encode(JSON.stringify(part)).length <= 850000);
});

test('skip intro and next episode: times per series or season, and when each button shows', async () => {
  const { skipMarks, skipButton, parseClock, formatClock } = await import('../web/library.js');
  const item = { skip: { intro: [30, 105], credits: 45, seasons: { 2: { intro: [10, 70] } } } };
  assert.deepEqual(skipMarks(item, { season: 1 }), { intro: [30, 105], credits: 45, creditsAt: null, manualIntro: true, manualCredits: true });
  assert.deepEqual(skipMarks(item, { season: 2 }), { intro: [10, 70], credits: 45, creditsAt: null, manualIntro: true, manualCredits: true });
  assert.deepEqual(skipMarks({}, { season: 1 }), { intro: null, credits: 30, creditsAt: null, manualIntro: false, manualCredits: false });
  const marks = skipMarks(item, { season: 1 });
  assert.equal(skipButton(marks, 29, 2400, true), null);
  assert.equal(skipButton(marks, 30, 2400, true), 'intro');
  assert.equal(skipButton(marks, 104.5, 2400, true), null, 'not in the last second of the intro');
  assert.equal(skipButton(marks, 2356, 2400, true), 'next');
  assert.equal(skipButton(marks, 2356, 2400, false), null, 'no next episode after the last one');
  assert.equal(skipButton(marks, 2356, NaN, true), null);
  assert.equal(skipButton(null, 50, 2400, true), null);
  assert.deepEqual(['1:45', '1:02:03', '90', '', '1:75', 'abc'].map(parseClock), [105, 3723, 90, null, NaN, NaN]);
  assert.deepEqual([105, 3723, 0, 59.6].map(formatClock), ['1:45', '1:02:03', '0:00', '1:00']);
});

test('saving a season keeps the series folder and its intro times', () => {
  const before = { id: 's4500', folder: 'Los Hombres de Paco', skip: { intro: [30, 90] }, episodes: [] };
  const after = seriesWithSeason(before, { id: 4500, title: 'Los hombres de Paco', year: 2005 }, 1, [{ episode: 1, name: 'Piloto' }], { 1: 'https://lulustream.com/paco1x01aaaa' });
  assert.deepEqual([after.folder, after.skip, after.episodes.length], ['Los Hombres de Paco', { intro: [30, 90] }, 1]);
});

test('TheIntroDB gives each episode its intro and credits, unless times were typed', async () => {
  const { skipMarks, skipButton, introDbMarks, withIntroDb } = await import('../web/library.js');
  // Breaking Bad 1x01, as TheIntroDB answers it.
  const answer = { tvdb_id: 81189, type: 'tv', season: 1, episode: 1, intro: [{ start_ms: 228664, end_ms: 246143 }], credits: [{ start_ms: 3431000, end_ms: null }] };
  assert.deepEqual(introDbMarks(answer), { intro: [228.664, 246.143], creditsAt: 3431 });
  assert.deepEqual(introDbMarks({ intro: [], credits: [] }), { intro: null, creditsAt: null });
  const asked = [];
  const ok = async (url) => { asked.push(url); return { ok: true, json: async () => answer }; };
  const source = { tmdb: 1396, season: 1, episode: 1 };
  const auto = await withIntroDb(skipMarks({}, { season: 1 }), source, ok);
  assert.deepEqual(asked, ['https://api.theintrodb.org/v4/media?tmdb_id=1396&season=1&episode=1']);
  assert.deepEqual([auto.intro, auto.creditsAt], [[228.664, 246.143], 3431]);
  assert.equal(skipButton(auto, 230, 3480, true), 'intro');
  assert.equal(skipButton(auto, 3430, 3480, true), null);
  assert.equal(skipButton(auto, 3431, 3480, true), 'next');
  // Typed times win: TheIntroDB only fills what is missing (here the credits).
  const typed = await withIntroDb(skipMarks({ skip: { intro: [20, 80] } }, { season: 1 }), source, ok);
  assert.deepEqual([typed.intro, typed.creditsAt], [[20, 80], 3431]);
  const allTyped = skipMarks({ skip: { intro: [20, 80], credits: 60 } }, { season: 1 });
  asked.length = 0;
  assert.equal(await withIntroDb(allTyped, source, ok), allTyped);
  assert.deepEqual(asked, [], 'nothing to ask when everything was typed');
  // When the browser may not ask TheIntroDB, the hosting does; with no answer the marks stay as they were.
  const relayed = [];
  const blocked = async (url) => { relayed.push(url); if (url.startsWith('https://api.theintrodb.org')) throw new TypeError('CORS'); return { ok: true, json: async () => answer }; };
  assert.equal((await withIntroDb(skipMarks({}, { season: 1 }), source, blocked)).creditsAt, 3431);
  assert.equal(relayed[1], 'https://calamarmenciano.com/calamar-lulu.php?introdb=1&tmdb_id=1396&season=1&episode=1');
  const none = skipMarks({}, { season: 1 });
  assert.equal(await withIntroDb(none, source, async () => ({ ok: false, status: 404 })), none);
  assert.equal(await withIntroDb(none, null, ok), none);
});

test('a TMDB request that fails or is limited is tried once more, then reports an error instead of hanging', async () => {
  const { searchTmdb } = await import('../web/library-tmdb.js');
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); return { status: 200, json: async () => ({ results: [{ id: 1, media_type: 'movie', title: 'Avatar', release_date: '2009-12-18' }] }) }; };
  assert.equal((await searchTmdb('Avatar', 'movie', 'abcdef0123456789abcdef0123456789', flaky))[0].title, 'Avatar');
  assert.equal(calls, 2);
  const dead = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(searchTmdb('Avatar', 'movie', 'abcdef0123456789abcdef0123456789', dead), /TMDB no responde/);
  let limited = 0;
  const busy = async () => { limited++; return limited === 1 ? { status: 429, json: async () => ({}) } : { status: 200, json: async () => ({ results: [] }) }; };
  assert.deepEqual(await searchTmdb('x', 'movie', 'abcdef0123456789abcdef0123456789', busy), []);
});

test('TMDB record links resolve directly even when title search has no results', async () => {
  const { tmdbReference } = await import('../web/library-tmdb.js');
  for (const link of ['https://www.themoviedb.org/movie/76600-avatar?language=es-ES', 'themoviedb.org/movie/76600', 'https://themoviedb.org/es/movie/76600-avatar/'])
    assert.deepEqual(tmdbReference(link), { id: 76600, kind: 'movie' });
  assert.deepEqual(tmdbReference('https://www.themoviedb.org/tv/4500-los-hombres-de-paco'), { id: 4500, kind: 'tv' });
  for (const link of ['Avatar', 'https://themoviedb.org.evil.test/movie/1', 'https://user@www.themoviedb.org/movie/1', 'https://www.themoviedb.org/movie/0', 'https://www.themoviedb.org/tv/4500/season/1', 'https://www.themoviedb.org/person/1', 'https://www.themoviedb.org/movie/9007199254740992'])
    assert.equal(tmdbReference(link), null);
  const calls = [], fetcher = fake({ '/search/movie': { results: [] }, '/movie/76600': { title: 'Avatar: El sentido del agua', release_date: '2022-12-14' },
    '/tv/4500': { name: 'Los hombres de Paco', first_air_date: '2005-10-09' } }, calls);
  assert.deepEqual(await searchTmdb('Nombre no encontrado', 'movie', 'key', fetcher), []);
  assert.equal((await searchTmdb('https://www.themoviedb.org/movie/76600-avatar?language=es-ES', 'movie', 'key', fetcher))[0].title, 'Avatar: El sentido del agua');
  assert.equal(new URL(calls.at(-1)[0]).pathname, '/3/movie/76600');
  assert.equal((await searchTmdb('https://www.themoviedb.org/tv/4500', 'any', 'key', fetcher))[0].kind, 'tv');
  const before = calls.length;
  await assert.rejects(searchTmdb('https://www.themoviedb.org/tv/4500', 'movie', 'key', fetcher), /corresponde a una serie/);
  await assert.rejects(searchTmdb('https://evil.test/movie/1', 'movie', 'key', fetcher), /Pega el enlace de una ficha/);
  assert.equal(calls.length, before, 'invalid links and mismatched types make no network requests');
});

test('unidentified includes records without a usable TMDB id as well as imported unmatched titles', async () => {
  const { unidentifiedItem } = await import('../web/library.js');
  assert.equal(unidentifiedItem({ status: 'unmatched', tmdb: { id: 4 } }), true);
  for (const tmdb of [undefined, {}, { id: 0 }, { id: -1 }, { id: 'wrong' }]) assert.equal(unidentifiedItem({ status: 'matched', tmdb }), true);
  for (const id of [4500, '76600']) assert.equal(unidentifiedItem({ tmdb: { id } }), false);
});
