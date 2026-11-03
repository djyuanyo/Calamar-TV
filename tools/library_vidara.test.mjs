import test from 'node:test';
import assert from 'node:assert/strict';
import { dailymotionEmbed, vidaraEmbed } from '../web/provider-players.js';
import { webPlayback } from '../web/catalog.js';
import { scanFolders } from '../web/library-folders.js';
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
  assert.deepEqual(webPlayback(video), { ok: true, kind: 'frame', address: 'https://vidara.to/e/KILxn38HjQjsv' });
  assert.equal(vidaraEmbed('https://vidara.to.evil.test/v/KILxn38HjQjsv'), null);
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
    return response({ page, total_pages: id === '13' ? 2 : 1, total: id === '13' ? 2 : 1, videos: [id === '12' ? movie : id === '13' ? show : doc] });
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
    page: Number(body.get('page')), total_pages: 2, total: 2, videos: [file],
  })), /duplicado/);
  await assert.rejects(vidaraVideos('12', key, () => response({ page: 1, total_pages: 1, total: 2, videos: [file] })), /Faltan vídeos/);
  await assert.rejects(vidaraVideos('12', key, () => new Response('{}', { status: 401 })), /no acepta la clave/);
});
