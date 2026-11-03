import test from 'node:test';
import assert from 'node:assert/strict';
import { dailymotionEmbed, vidaraPlayback } from '../web/provider-players.js';
import { webPlayback } from '../web/catalog.js';
import { scanFolders } from '../web/library-folders.js';
import { libraryFromScan } from '../web/library-lulu.js';
import { vidaraVideos, VIDARA_ENDPOINT } from '../web/library-vidara.js';
import { videoKey } from '../web/library-sync.js';

const daily = 'https://geo.dailymotion.com/player/x1k3pa.html?video=k5cyQ3rl70nCl7Fhb5W';
const video = 'https://vidara.to/v/KILxn38HjQjsv';
test('Dailymotion and Vidara resolve to their own players inside Calamar', () => {
  assert.deepEqual(webPlayback(daily, { pages: true }), { ok: true, kind: 'frame', page: true, address: daily });
  assert.equal(dailymotionEmbed('https://geo.dailymotion.com/player.html?video=x84sh87'), 'https://geo.dailymotion.com/player.html?video=x84sh87');
  assert.equal(dailymotionEmbed('https://dai.ly/x84sh87'), 'https://www.dailymotion.com/embed/video/x84sh87');
  assert.equal(dailymotionEmbed('https://geo.dailymotion.com.evil.test/player/x1k3pa.html?video=x84sh87'), null);
  assert.equal(dailymotionEmbed('https://geo.dailymotion.com/player/x1k3pa.html?video=x%2Fz'), null);
  assert.deepEqual(webPlayback(video), { ok: true, kind: 'hls', address: 'https://calamarmenciano.com/calamar-vidara.php?code=KILxn38HjQjsv&hls=1' });
  assert.equal(vidaraPlayback('https://vidara.to.evil.test/v/KILxn38HjQjsv'), null);
  assert.equal(videoKey('https://vidara.so/e/KILxn38HjQjsv'), videoKey(video));
  assert.notEqual(videoKey('https://luluvido.com/e/KILxn38HjQjsv'), videoKey(video));
});

const key = 'private-test-key';
function response(data) { return new Response(JSON.stringify(data), { status: 200 }); }
test('scans paginated Vidara folders and groups separate series in a flat folder', async () => {
  const requests = [];
  const folders = [{ fld_id: 12, name: 'Cine' }, { fld_id: 13, name: 'Series' }, { fld_id: 14, name: 'Documentales' }];
  const fetcher = (url, options) => {
    assert.equal(url, VIDARA_ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('key'), key);
    const page = Number(options.body.get('page'));
    const id = options.body.get('id');
    requests.push([options.body.get('action'), id, page]);
    if (options.body.get('action') === 'folders') return response({ folders });
    const movie = { filecode: 'VIDMOVIE1234', title: 'Mi película 2024.mp4', uploaded: '2026-11-03 12:00:00' };
    const show = { filecode: page === 1 ? 'VIDSERIE1234' : 'VIDSERIE5678', title: page === 1 ? 'Primera serie S02E03.mp4' : 'Segunda serie 1x02.mp4' };
    const doc = { filecode: 'VIDDOCUM1234', title: '11M (2022).mp4' };
    return response({ complete_inventory: true, page, total_pages: id === '13' ? 2 : 1, total: id === '13' ? 2 : 1, videos: [id === '12' ? movie : id === '13' ? show : doc] });
  };
  const scan = await scanFolders(folders.map((f, i) => ({ provider: 'vidara', id: String(f.fld_id), section: ['movies','series','documentaries'][i] })), { vidara: key }, { fetcher });
  assert.deepEqual(requests, [['folders', null, 0], ['videos', '12', 1], ['videos', '13', 1], ['videos', '13', 2], ['videos', '14', 1]]);
  assert.equal(scan.films[0].uploaded, '2026-11-03');
  assert.equal(scan.films[1].section, 'documentaries');
  assert.deepEqual(scan.series.map(show => [show.title, show.episodes[0].season, show.episodes[0].episode]), [['Primera serie', 2, 3], ['Segunda serie', 1, 2]]);
  assert.deepEqual(scan.inventory.map(folder => folder.id), ['vidara:12', 'vidara:13', 'vidara:14']);
  assert.ok(!JSON.stringify(scan).includes(key));
});

test('a failed, partial or repeated Vidara page cannot publish a shortened inventory', async () => {
  const file = { filecode: 'VIDMOVIE1234', title: 'Película.mp4' };
  await assert.rejects(vidaraVideos('12', key, (_, { body }) => response({
    complete_inventory: true, page: Number(body.get('page')), total_pages: 2, total: 2, videos: [file],
  })), /duplicado/);
  await assert.rejects(vidaraVideos('12', key, () => response({ complete_inventory: true, page: 1, total_pages: 1, total: 2, videos: [file] })), /Faltan vídeos/);
  await assert.rejects(vidaraVideos('12', key, () => response({ page: 1, total_pages: 0, total: 0, videos: [] })), /Sustituye calamar-vidara.php/);
  await assert.rejects(vidaraVideos('12', key, () => new Response('{}', { status: 401 })), /no acepta la clave/);
});

test('reports unavailable uploads, preserves them in the inventory and imports playable files without a TMDB match', async () => {
  const sources = [{ provider: 'vidara', id: '12', section: 'movies' }];
  const settings = { vidara: key };
  const files = [
    { filecode: 'VIDMOVIE1234', title: 'Película lista.mp4', status: 'active', file_active: 1 },
    { filecode: 'VIDQUEUE1234', title: 'Película en cola.mp4', status: 'active', file_active: '0' },
    { filecode: 'VIDERROR1234', title: 'Película con error.mp4', status: 'error', file_active: 1 },
  ];
  const folders = response({ folders: [{ fld_id: 12, name: 'Películas', videos: 3 }] });
  const fetcher = (_, { body }) => body.get('action') === 'folders'
    ? folders.clone()
    : response({ complete_inventory: true, page: 1, total_pages: 1, total: 3, videos: files });
  const scan = await scanFolders(sources, settings, { fetcher });
  assert.deepEqual(scan.vidaraReport, [{ name: 'Películas', count: 3, unavailable: 2 }]);
  assert.deepEqual(scan.films.map(f => f.link), ['https://vidara.to/v/VIDMOVIE1234']);
  assert.equal(scan.inventory[0].links.length, 3);
  const old = { id: 'm1', kind: 'movie', title: 'En cola', fromFolder: true, url: 'https://vidara.to/v/VIDQUEUE1234' };
  const result = await libraryFromScan(scan, { movies: [old] }, 'tmdb', {
    skipDuplicates: true, fetcher: () => response({ results: [] }),
  });
  assert.equal(result.removed.films, 0);
  assert.equal(result.added.pending, 1);
  assert.ok(result.sections.movies.some(movie => movie.url === old.url));

  const empty = (_, { body }) => body.get('action') === 'folders' ? folders.clone()
    : response({ complete_inventory: true, page: 1, total_pages: 0, total: 0, videos: [] });
  const partial = await scanFolders(sources, settings, { fetcher: empty });
  assert.equal(partial.partialVidara, true);
  assert.match(partial.vidaraReport[0].error, /tiene 3 archivos, pero su lista está vacía/);
  assert.deepEqual(partial.inventory, []);
});

test('an upstream error in the first Vidara folder does not block movies or remove unverified links', async () => {
  const sources = [
    { provider: 'vidara', id: '11', name: 'Documentales', section: 'documentaries' },
    { provider: 'vidara', id: '12', name: 'Películas', section: 'movies' },
  ];
  const scan = await scanFolders(sources, { vidara: key }, { fetcher: (_, { body }) => {
    if (body.get('action') === 'folders') return response({ folders: [
      { fld_id: 11, name: 'Documentales' }, { fld_id: 12, name: 'Películas', videos: 1 },
    ] });
    if (body.get('id') === '11') return new Response(JSON.stringify({
      bridge: 3, error: 'vidara_upstream', upstream_http: 500, upstream_status: 0, msg: key,
    }), { status: 502 });
    return response({ complete_inventory: true, page: 1, total_pages: 1, total: 1,
      videos: [{ filecode: 'VIDMOVIE1234', title: 'Película nueva.mp4' }] });
  } });
  assert.equal(scan.partialVidara, true);
  assert.match(scan.vidaraReport[0].error, /Vidara HTTP 500/);
  assert.ok(!JSON.stringify(scan).includes(key));
  assert.equal(scan.films.length, 1);
  const old = { id: 'm1', kind: 'movie', title: 'Anterior', fromFolder: true, url: 'https://vidara.to/v/VIDOLDER1234',
    folderSources: { vidara_VIDOLDER1234: ['vidara:12'] } };
  const legacy = { id: 'm2', kind: 'movie', title: 'Antigua', fromFolder: true, url: 'https://vidara.to/v/VIDOTHER1234' };
  const result = await libraryFromScan(scan, { movies: [old, legacy], documentaries: [] }, 'tmdb', {
    skipDuplicates: true, fetcher: () => response({ results: [] }),
  });
  assert.equal(result.added.pending, 1);
  assert.equal(result.removed.films, 0);
  assert.deepEqual(result.sections.movies.find(movie => movie.id === old.id).folderSources, old.folderSources);
  assert.ok(result.sections.movies.some(movie => movie.id === legacy.id));
});
