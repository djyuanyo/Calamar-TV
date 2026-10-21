import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedVideo, prepareHostedVideo, VIDEO_BRIDGE } from '../web/video-bridge.js';
import { webPlayback } from '../web/catalog.js';
const episode = 'https://calamarmenciano.com/MENCIA%20MEDIA/SERIES/Los%20Hombres%20de%20Paco%20(Temporada%2010)/Cap%201001%20%5BAC3%205.1%5D.mkv';
const session = 'a'.repeat(64);
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body });

test('video files of the hosting go through the converter; others are explained', () => {
  assert.equal(hostedVideo(episode), true);
  assert.equal(hostedVideo('https://www.calamarmenciano.com/pelis/a.AVI'), true);
  for (const other of ['https://example.com/a.mkv', 'http://calamarmenciano.com/a.mkv', 'https://calamarmenciano.com/a.mp4', 'https://user:p@calamarmenciano.com/a.mkv', 'nada']) assert.equal(hostedVideo(other), false);
  assert.deepEqual(webPlayback(episode), { ok: true, kind: 'file', bridge: true });
  assert.equal(webPlayback('https://example.com/a.mkv').ok, false);
  assert.match(webPlayback('https://example.com/a.mkv').reason, /hosting de Calamar/);
  assert.deepEqual(webPlayback('https://calamarmenciano.com/a.mp4'), { ok: true, kind: 'video' });
});

test('waits while the hosting prepares the first fragments, then returns the playlist', async () => {
  const asked = [];
  const answers = [reply(202, { state: 'preparing', url: null }), reply(200, { state: 'converting', url: `${VIDEO_BRIDGE}?action=media&session=${session}&file=index.m3u8` })];
  const ready = await prepareHostedVideo(episode, { fetcher: async (url) => { asked.push(url); return answers.shift(); }, sleep: async () => {} });
  assert.deepEqual(ready, { url: `${VIDEO_BRIDGE}?action=media&session=${session}&file=index.m3u8`, complete: false });
  assert.equal(new URL(asked[0]).searchParams.get('src'), episode);
});

test('hosting errors and foreign playlists are reported, not played', async () => {
  await assert.rejects(prepareHostedVideo(episode, { fetcher: async () => reply(503, { error: 'El hosting ya está preparando otros vídeos.' }) }), /otros vídeos/);
  await assert.rejects(prepareHostedVideo(episode, { fetcher: async () => reply(200, { url: 'https://evil.example/x.m3u8' }) }), /no válida/);
  await assert.rejects(prepareHostedVideo(episode, { fetcher: async () => ({ status: 404, ok: false, headers: { get: () => 'text/html' } }) }), /calamar-video.php/);
  assert.equal(await prepareHostedVideo('https://example.com/a.mkv'), null);
});

test('multi-screen layout: two top and bottom, more in a grid', async () => {
  const { multiGrid } = await import('../web/multi-view.js');
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => multiGrid(n)), [
    { rows: 1, cols: 1 }, { rows: 2, cols: 1 }, { rows: 2, cols: 2 }, { rows: 2, cols: 2 }, { rows: 2, cols: 3 }, { rows: 2, cols: 3 }]);
});
