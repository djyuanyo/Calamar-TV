import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, episodeOf, confident, luluApi, scanLulu, libraryFromScan, matchUnmatched } from '../web/library-lulu.js';

const json = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

test('file and folder names give title, year, season and episode', () => {
  assert.deepEqual(cleanTitle('Torrente.Presidente.2025.1080p.WEB-DL.mkv'), { title: 'Torrente Presidente', year: 2025 });
  assert.deepEqual(cleanTitle('Avatar (2009) [Castellano].mp4'), { title: 'Avatar', year: 2009 });
  assert.deepEqual(cleanTitle('Los hombres de Paco'), { title: 'Los hombres de Paco', year: null });
  assert.deepEqual(episodeOf('Los hombres de Paco 1x05.mp4'), [1, 5]);
  assert.deepEqual(episodeOf('Paco.S02E10.720p.mkv'), [2, 10]);
  assert.deepEqual(episodeOf('Capitulo 3.mp4', 'Temporada 2'), [2, 3]);
  assert.deepEqual(episodeOf('07.mp4', 'Temporada 4'), [4, 7]);
  assert.deepEqual(episodeOf('Cap.205.mp4'), [2, 5]);
  assert.equal(episodeOf('Making of.mp4'), null);
  assert.equal(confident('Torrente Presidente', 'Torrente presidente'), true);
  assert.equal(confident('Los hombres de Paco', 'Hombres de Paco'), true);
  assert.equal(confident('Avatar', 'El padrino'), false);
});

test('the API is called straight, and through the hosting when the browser is not allowed', async () => {
  const calls = [];
  const direct = async (url) => { calls.push(url); return json({ status: 200, msg: 'OK', result: { folders: [] } }); };
  assert.deepEqual(await luluApi('folder/list', { fld_id: '0' }, 'clave123456', direct), { folders: [] });
  assert.match(calls[0], /^https:\/\/api\.lulustream\.com\/api\/folder\/list\?fld_id=0&key=clave123456$/);
  const relayed = [];
  const blocked = async (url, options) => {
    if (url.startsWith('https://api.lulustream.com')) throw new TypeError('Failed to fetch');
    relayed.push([url, String(options.body), options.method]);
    return json({ status: 200, result: { files: [] } });
  };
  assert.deepEqual(await luluApi('folder/list', { fld_id: '7' }, 'clave123456', blocked), { files: [] });
  assert.deepEqual(relayed, [['https://calamarmenciano.com/calamar-lulu.php', 'api=folder%2Flist&fld_id=7&key=clave123456', 'POST']]);
  await assert.rejects(luluApi('folder/list', {}, 'mala', async () => json({ status: 403, msg: 'Wrong auth' })), /no acepta la clave/);
});

// Peliculas/ (two films, one in a subfolder), Series/Los hombres de Paco/Temporada 1 + 2, Documentales/.
const folders = {
  0: { folders: [{ fld_id: 10, name: 'Peliculas' }, { fld_id: 20, name: 'Series' }, { fld_id: 30, name: 'Documentales' }, { fld_id: 40, name: 'Otros' }], files: [] },
  10: { folders: [{ fld_id: 11, name: 'Sagas' }], files: [{ file_code: 'torrente2025a', title: 'Torrente.Presidente.2025.1080p.mkv' }] },
  11: { folders: [], files: [{ file_code: 'avatar2009abc', title: 'Avatar (2009).mp4' }] },
  20: { folders: [{ fld_id: 21, name: 'Los hombres de Paco' }], files: [] },
  21: { folders: [{ fld_id: 22, name: 'Temporada 1' }, { fld_id: 23, name: 'Temporada 2' }], files: [] },
  22: { folders: [], files: [{ file_code: 'paco1x01aaaa', title: '1x01.mp4' }, { file_code: 'paco1x02aaaa', title: 'Capitulo 2.mp4' }, { file_code: 'pacoextraaaa', title: 'Making of.mp4' }] },
  23: { folders: [], files: [{ file_code: 'paco2x01bbbb', title: '01.mp4' }] },
  30: { folders: [], files: [{ file_code: 'planeta12345', title: 'Nuestro planeta.mp4' }] },
};
const lulu = async (url) => json({ status: 200, msg: 'OK', result: folders[new URL(url).searchParams.get('fld_id')] });

test('the folders are read as films, series with seasons and documentaries', async () => {
  const seen = [];
  const scan = await scanLulu('clave123456', { fetcher: lulu, onFolder: (name) => seen.push(name) });
  assert.deepEqual(scan.films.map((f) => [f.section, f.title, f.year, f.link]), [
    ['movies', 'Torrente Presidente', 2025, 'https://lulustream.com/torrente2025a'],
    ['movies', 'Avatar', 2009, 'https://lulustream.com/avatar2009abc'],
    ['documentaries', 'Nuestro planeta', null, 'https://lulustream.com/planeta12345']]);
  assert.deepEqual(scan.series.map((s) => [s.section, s.title, s.episodes.map((e) => [e.season, e.episode, e.link])]), [
    ['series', 'Los hombres de Paco', [[1, 1, 'https://lulustream.com/paco1x01aaaa'], [1, 2, 'https://lulustream.com/paco1x02aaaa'], [2, 1, 'https://lulustream.com/paco2x01bbbb']]]]);
  assert.equal(scan.unknown.length, 1);
  assert.match(scan.unknown[0], /Making of/);
  assert.ok(!seen.includes('Otros'));
});

test('the scan is matched in TMDB and merged with the titles added by hand', async () => {
  const scan = await scanLulu('clave123456', { fetcher: lulu });
  const tmdb = async (url) => {
    const u = new URL(url), path = u.pathname.replace('/3', ''), q = u.searchParams.get('query');
    if (path === '/search/movie') return json({ results: q === 'Torrente Presidente' ? [{ id: 1, title: 'Torrente Presidente', release_date: '2025-03-01' }] : q === 'Avatar' ? [{ id: 19995, title: 'Avatar', release_date: '2009-12-18' }] : [] });
    if (path === '/search/multi') return json({ results: [] });
    if (path === '/search/tv') return json({ results: [{ id: 4500, name: 'Los hombres de Paco', first_air_date: '2005-10-09' }] });
    if (path === '/movie/1') return json({ id: 1, title: 'Torrente Presidente', release_date: '2025-03-01', genres: [{ name: 'Comedia' }] });
    if (path === '/movie/19995') return json({ id: 19995, title: 'Avatar', release_date: '2009-12-18' });
    if (path === '/tv/4500') return json({ id: 4500, name: 'Los hombres de Paco', first_air_date: '2005-10-09', seasons: [{ season_number: 1 }, { season_number: 2 }] });
    if (path === '/tv/4500/season/1') return json({ episodes: [{ episode_number: 1, name: 'Piloto' }, { episode_number: 2, name: 'Segundo' }] });
    if (path === '/tv/4500/season/2') return json({ episodes: [] });
    return json({}, 404);
  };
  const byHand = { id: 'm999', kind: 'movie', title: 'A mano', url: 'https://lulustream.com/amano123456', tmdb: { title: 'A mano' } };
  const oldPaco = { id: 's4500', kind: 'tv', title: 'Los hombres de Paco', tmdb: { id: 4500 }, episodes: [
    { id: 'e4500x1x1', season: 1, episode: 1, url: 'https://lulustream.com/manual1x01xx' }, { id: 'e4500x1x3', season: 1, episode: 3, url: 'https://lulustream.com/manual1x03xx' },
    { id: 'e4500x3x1', season: 3, episode: 1, url: 'https://lulustream.com/paco3x01cccc' }] };
  const progress = [];
  const result = await libraryFromScan(scan, { movies: [byHand], series: [oldPaco], documentaries: [] }, 'abcdef0123456789abcdef0123456789',
    { fetcher: tmdb, onProgress: (n, total) => progress.push(`${n}/${total}`) });
  assert.deepEqual(result.sections.movies.map((m) => [m.id, m.url]), [['m999', 'https://lulustream.com/amano123456'], ['m19995', 'https://lulustream.com/avatar2009abc'], ['m1', 'https://lulustream.com/torrente2025a']]);
  assert.deepEqual(result.sections.series[0].episodes.map((e) => [e.season, e.episode, e.name, e.url]), [
    [1, 1, 'Piloto', 'https://lulustream.com/paco1x01aaaa'], [1, 2, 'Segundo', 'https://lulustream.com/paco1x02aaaa'], [1, 3, '', 'https://lulustream.com/manual1x03xx'],
    [2, 1, '', 'https://lulustream.com/paco2x01bbbb'], [3, 1, undefined, 'https://lulustream.com/paco3x01cccc']]);
  assert.deepEqual(result.added, { films: 2, shows: 1, episodes: 3, pending: 1 });
  // Not in TMDB: added anyway with the file's name, to be matched in the admin page.
  assert.deepEqual(result.sections.documentaries, [{ id: 'uplaneta12345', kind: 'movie', title: 'Nuestro planeta', year: null, file: 'Nuestro planeta.mp4', url: 'https://lulustream.com/planeta12345', status: 'unmatched' }]);
  assert.ok(result.unknown.some((line) => /Nuestro planeta.*sin ficha de TMDB/.test(line)));
  assert.deepEqual(progress, ['1/4', '2/4', '3/4', '4/4']);
});

test('titles TMDB does not find are added, matched by hand, and recognised by the next scan', async () => {
  const rare = {
    0: { folders: [{ fld_id: 1, name: 'Peliculas' }, { fld_id: 2, name: 'Series' }] },
    1: { folders: [], files: [{ file_code: 'rara12345678', title: 'Rarisima.2020.mp4' }] },
    2: { folders: [{ fld_id: 3, name: 'Serie rara' }] }, 3: { folders: [{ fld_id: 4, name: 'Temporada 1' }] },
    4: { folders: [], files: [{ file_code: 'serie1x01aaa', title: '1x01.mp4' }, { file_code: 'serie1x02aaa', title: '1x02.mp4' }] },
  };
  const fetchLulu = async (url) => json({ status: 200, result: rare[new URL(url).searchParams.get('fld_id')] });
  const asked = [];
  const tmdb = async (url) => {
    const path = new URL(url).pathname.replace('/3', '');
    asked.push(path);
    if (path.startsWith('/search/')) return json({ results: [] });
    if (path === '/movie/77') return json({ id: 77, title: 'La rarísima', release_date: '2020-01-01' });
    if (path === '/tv/88') return json({ id: 88, name: 'La serie rara', seasons: [{ season_number: 1 }] });
    if (path === '/tv/88/season/1') return json({ episodes: [{ episode_number: 1, name: 'Uno' }, { episode_number: 2, name: 'Dos' }] });
    return json({}, 404);
  };
  const key = 'abcdef0123456789abcdef0123456789';
  const first = await libraryFromScan(await scanLulu('clave123456', { fetcher: fetchLulu }), { movies: [], series: [], documentaries: [] }, key, { fetcher: tmdb });
  assert.deepEqual(first.added, { films: 0, shows: 0, episodes: 0, pending: 2 });
  const [film] = first.sections.movies, [show] = first.sections.series;
  assert.deepEqual([film.id, film.status, film.title, film.url], ['urara12345678', 'unmatched', 'Rarisima', 'https://lulustream.com/rara12345678']);
  assert.deepEqual([show.id, show.status, show.folder, show.episodes.map((e) => [e.season, e.episode, e.url])],
    ['userie-rara', 'unmatched', 'Serie rara', [[1, 1, 'https://lulustream.com/serie1x01aaa'], [1, 2, 'https://lulustream.com/serie1x02aaa']]]);

  // In the admin page the right TMDB record is chosen: the links go with it.
  const movie = await matchUnmatched(film, 77, null, key, tmdb);
  assert.deepEqual([movie.id, movie.tmdb.title, movie.url], ['m77', 'La rarísima', 'https://lulustream.com/rara12345678']);
  const series = await matchUnmatched(show, 88, null, key, tmdb);
  assert.deepEqual([series.id, series.folder, series.episodes.map((e) => [e.episode, e.name, e.url])],
    ['s88', 'Serie rara', [[1, 'Uno', 'https://lulustream.com/serie1x01aaa'], [2, 'Dos', 'https://lulustream.com/serie1x02aaa']]]);

  // Reading the folders again keeps those records (by link and by folder) instead of adding them again.
  rare[4].files.push({ file_code: 'serie1x03aaa', title: '1x03.mp4' });
  asked.length = 0;
  const again = await libraryFromScan(await scanLulu('clave123456', { fetcher: fetchLulu }), { movies: [movie], series: [series], documentaries: [] }, key, { fetcher: tmdb });
  assert.deepEqual(again.added, { films: 1, shows: 1, episodes: 3, pending: 0 });
  assert.deepEqual(again.sections.movies.map((m) => m.id), ['m77']);
  assert.deepEqual(again.sections.series.map((s) => [s.id, s.episodes.map((e) => e.episode)]), [['s88', [1, 2, 3]]]);
  assert.ok(!asked.some((path) => path.startsWith('/search/')), 'no new search for titles already matched');
});
