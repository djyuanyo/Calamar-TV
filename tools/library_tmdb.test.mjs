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

test('LuluStream links play in its own embedded player; direct videos in ours', () => {
  assert.equal(lulustreamEmbed('https://lulustream.com/abc123def456'), 'https://lulustream.com/e/abc123def456');
  assert.equal(lulustreamEmbed('https://www.lulustream.com/d/abc123def456.html'), 'https://lulustream.com/e/abc123def456');
  assert.equal(lulustreamEmbed('https://lulustream.com/fld/h9vd4z179z'), null, 'a folder is not a video');
  assert.equal(lulustreamEmbed('https://evil.example/abc123def456'), null);
  assert.equal(webPlayback('https://lulustream.com/e/abc123def456').kind, 'embed');
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
