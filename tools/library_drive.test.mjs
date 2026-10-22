import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, episodeNumber, driveFolderId, driveVideos, sectionItems, mergeScan, confident, applyMatch, libraryParts, searchTmdb, tmdbDetails } from '../web/library-drive.js';

const FOLDER = 'application/vnd.google-apps.folder';
const tree = {
  PELIS: [{ id: 'dAvatar', name: 'Avatar (2009)', mimeType: FOLDER }, { id: 'fRaro', name: 'Raro.Desconocido.2001.720p.mkv', mimeType: 'video/x-matroska' }, { id: 'fNota', name: 'leeme.txt', mimeType: 'text/plain' }],
  dAvatar: [{ id: 'fAvatar', name: 'Avatar.mp4', mimeType: 'video/mp4' }],
  SERIES: [{ id: 'dPaco', name: 'Los Hombres de Paco (Temporada 10)', mimeType: FOLDER }, { id: 'fSuelto', name: 'suelto.mkv', mimeType: 'video/x-matroska' }],
  dPaco: [{ id: 'fE2', name: 'Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1002][AC3 5.1 Castellano].mkv', mimeType: 'video/x-matroska' },
    { id: 'fE1', name: 'Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1001][AC3 5.1 Castellano].mkv', mimeType: 'video/x-matroska' }],
};
const drive = async (url) => {
  const q = new URL(url).searchParams;
  const folder = q.get('q').match(/^'([^']+)' in parents/)[1];
  assert.equal(q.get('key'), 'AIzaTEST');
  return tree[folder] ? { status: 200, json: async () => ({ files: tree[folder] }) } : { status: 404, json: async () => ({}) };
};

test('names and episode numbers as in Plex', () => {
  assert.deepEqual(cleanTitle('Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1001][AC3 5.1 Castellano].mkv'), { title: 'Los Hombres De Paco', year: null });
  assert.deepEqual(cleanTitle('Avatar (2009)'), { title: 'Avatar', year: 2009 });
  assert.deepEqual(cleanTitle('Raro.Desconocido.2001.720p.mkv'), { title: 'Raro Desconocido', year: 2001 });
  assert.equal(cleanTitle('Planeta Tierra II - Capitulo 1.mp4').title, 'Planeta Tierra II');
  assert.deepEqual(episodeNumber('Serie 1x05.mkv'), [1, 5]);
  assert.deepEqual(episodeNumber('Serie S02E10.mkv'), [2, 10]);
  assert.deepEqual(episodeNumber('[Cap.1001]'), [10, 1]);
  assert.deepEqual(episodeNumber('Capitulo 7.mp4', 'Temporada 3'), [3, 7]);
  assert.equal(episodeNumber('Sin numero.mkv'), null);
  assert.equal(driveFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp?usp=sharing'), '1AbCdEfGhIjKlMnOp');
  assert.equal(driveFolderId('MENCIA MEDIA/PELICULAS'), null);
});

test('Drive folders become titles and series with episodes that play from Drive', async () => {
  const movies = await sectionItems('movies', 'PELIS', await driveVideos('PELIS', 'AIzaTEST', drive));
  assert.deepEqual(movies.map((m) => [m.title, m.year]), [['Avatar', 2009], ['Raro Desconocido', 2001]]);
  assert.equal(movies[0].url, 'https://www.googleapis.com/drive/v3/files/fAvatar?alt=media&key=AIzaTEST');
  assert.match(movies[0].id, /^m[0-9a-f]{16}$/);
  const [paco, ...rest] = await sectionItems('series', 'SERIES', await driveVideos('SERIES', 'AIzaTEST', drive));
  assert.equal(rest.length, 0, 'files loose in Series are not a series');
  assert.equal(paco.title, 'Los Hombres de Paco');
  assert.deepEqual(paco.episodes.map((e) => [e.season, e.episode, e.url.match(/files\/(\w+)/)[1]]), [[10, 1, 'fE1'], [10, 2, 'fE2']]);
  await assert.rejects(driveVideos('NOPE', 'AIzaTEST', drive), /Cualquier persona con el enlace/);
  await assert.rejects(driveVideos('X', 'AIzaTEST', async () => ({ status: 403, json: async () => ({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }) })), /Google Drive API/);
});

test('a new scan keeps TMDB data and choices, new episodes ask TMDB again, removed titles go', () => {
  const previous = { sections: { series: [{ id: 's1', status: 'matched', tmdb: { id: 9 }, episodes: [{ id: 'e1', name: 'Uno', overview: '', still: '' }] }], movies: [{ id: 'gone', status: 'matched' }] } };
  const merged = mergeScan({ series: [{ id: 's1', kind: 'tv', episodes: [{ id: 'e1' }, { id: 'e2' }] }], movies: [{ id: 'new', kind: 'movie' }] }, previous);
  assert.equal(merged.series[0].status, 'refresh');
  assert.equal(merged.series[0].episodes[0].name, 'Uno');
  assert.deepEqual(merged.movies.map((m) => [m.id, m.status]), [['new', 'pending']]);
});

test('TMDB search, details and confident automatic matches', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init?.headers?.Authorization]);
    const path = new URL(url).pathname;
    const body = path.endsWith('/search/movie') ? { results: [{ id: 19995, title: 'Avatar', release_date: '2009-12-15', poster_path: '/a.jpg' }] }
      : path.endsWith('/tv/4500') ? { name: 'Los hombres de Paco', first_air_date: '2005-10-09', vote_average: 7.14, genres: [{ name: 'Comedia' }], credits: { cast: [{ name: 'Paco Tous', character: 'Paco' }] },
        'season/10': { episodes: [{ episode_number: 1, name: 'Vuelta a empezar', overview: 'Reabre', still_path: '/s.jpg' }] } } : {};
    return { status: 200, json: async () => body };
  };
  const [avatar] = await searchTmdb('Avatar', 2009, 'movie', 'abcdef0123456789abcdef0123456789', fetcher);
  assert.deepEqual([avatar.id, avatar.year, avatar.poster], [19995, 2009, 'https://image.tmdb.org/t/p/w185/a.jpg']);
  assert.match(calls[0][0], /api_key=abcdef/);
  const paco = await tmdbDetails(4500, 'tv', 'eyJ.header.token', [10], fetcher);
  assert.equal(calls[1][1], 'Bearer eyJ.header.token');
  assert.deepEqual([paco.info.rating, paco.info.genres, paco.episodes['10x1'].name], [7.1, ['Comedia'], 'Vuelta a empezar']);
  const item = applyMatch({ id: 's', kind: 'tv', episodes: [{ id: 'e', season: 10, episode: 1 }] }, paco);
  assert.deepEqual([item.status, item.tmdb.title, item.episodes[0].name, item.episodes[0].still], ['matched', 'Los hombres de Paco', 'Vuelta a empezar', 'https://image.tmdb.org/t/p/w300/s.jpg']);
  assert.equal(applyMatch(item, null).status, 'none');
  assert.equal(applyMatch(item, null).tmdb, undefined);
  assert.ok(confident('Los Hombres de Paco', 'Los hombres de Paco'));
  assert.ok(confident('Avatar', 'Avatar: The Way of Water'));
  assert.ok(!confident('Raro Desconocido', 'Algo totalmente distinto'));
});

test('the library is split in Firestore parts below the size limit', () => {
  const big = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, overview: 'x'.repeat(40000) }));
  const { index, parts } = libraryParts({ movies: big, series: [] }, '2026-01-01');
  assert.ok(index.sections.movies > 1);
  assert.equal(index.sections.series, 1);
  for (const part of Object.values(parts)) assert.ok(new TextEncoder().encode(JSON.stringify(part)).length <= 850000);
  assert.equal(Object.keys(parts).filter((k) => k.startsWith('movies-')).reduce((n, k) => n + parts[k].items.length, 0), 30);
});
