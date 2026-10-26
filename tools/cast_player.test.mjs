import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSource, initCast } from '../web/cast-player.js';
import { prepareCastSource, needsCastBridge } from '../web/cast-adapter.js';

test('Cast preserves signed source URLs and reports their real MIME type', () => {
  const url = 'https://example.com/live.M3U8?token=A%2Bb&exp=0';
  assert.deepEqual(castSource(url), { url, type: 'application/x-mpegURL', live: true });
  assert.equal(castSource('https://example.com/a.mpd').type, 'application/dash+xml');
  assert.equal(castSource('http://example.com/a.mp4').live, false);
  assert.equal(castSource('https://example.com/a.webm').type, 'video/webm');
});

test('raw TS, page URLs, unsafe schemes and header-only relay URLs are not sent', () => {
  for (const url of ['https://example.com/a.ts', 'http://192.0.2.1:8080/User/Pass/244',
    'blob:https://example.com/a', 'https://example.com/embed/player',
    'https://calamarmenciano.com/calamar-tv-relay.php?stream=1',
    'https://user:pass@example.com/a.m3u8', null]) assert.equal(castSource(url), null);
});

function fixture(options = {}) {
  const node = () => ({ hidden: true, textContent: '', handlers: {},
    addEventListener(name, callback) { this.handlers[name] = callback; }, setAttribute() {} });
  const button = node(), toggle = node(), disconnect = node(), logs = [], loads = [];
  let selected = { url: 'https://example.com/a.m3u8?token=A%2Bb', title: 'Canal' };
  let sent = 0, closed = 0, connected = false, paused = 0, ended = 0;
  const session = { loadMedia: async request => { loads.push(request); } };
  const context = { setOptions() {}, getCurrentSession: () => connected ? session : null,
    requestSession: async () => { connected = true; }, addEventListener() {},
    endCurrentSession: () => { ended++; connected = false; } };
  const win = { document: { createElement: () => ({}), head: { append() {} } },
    chrome: { cast: { isAvailable: true, AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' },
      media: { DEFAULT_MEDIA_RECEIVER_APP_ID: 'default', StreamType: { LIVE: 'live', BUFFERED: 'buffered' },
        MediaInfo: class { constructor(url, type) { this.contentId = url; this.contentType = type; } },
        GenericMediaMetadata: class {}, LoadRequest: class { constructor(media) { this.media = media; } } } } },
    cast: { framework: { CastContext: { getInstance: () => context },
      CastContextEventType: { SESSION_STATE_CHANGED: 'session' },
      RemotePlayerEventType: { IS_PAUSED_CHANGED: 'pause' }, RemotePlayer: class { isPaused = false; },
      RemotePlayerController: class { addEventListener() {} playOrPause() { paused++; } } } } };
  initCast({ ...options, button, toggle, disconnect, win, getSource: () => selected,
    onSent: () => sent++, onDisconnect: () => closed++, onStatus: text => logs.push(text) });
  return { button, toggle, disconnect, loads, logs, select: s => selected = s,
    state: () => ({ sent, closed, paused, ended }) };
}

test('local playback stops only after the receiver accepts the source; TV controls are wired', async () => {
  const f = fixture();
  await f.button.handlers.click();
  assert.equal(f.loads[0].media.contentId, 'https://example.com/a.m3u8?token=A%2Bb');
  assert.equal(f.loads[0].media.streamType, 'live');
  assert.equal(f.state().sent, 1);
  f.toggle.handlers.click();
  f.disconnect.handlers.click();
  assert.deepEqual(f.state(), { sent: 1, closed: 1, paused: 1, ended: 1 });
});

test('unsupported TS keeps local playback running and does not start a receiver session', async () => {
  const f = fixture();
  f.select({ url: 'https://example.com/a.ts' });
  await f.button.handlers.click();
  assert.equal(f.loads.length, 0);
  assert.equal(f.state().sent, 0);
  assert.match(f.logs[0], /enlace de vídeo compatible/);
});

test('changing source while selecting a device cannot send the previous signed URL', async () => {
  const f = fixture();
  const click = f.button.handlers.click();
  f.select({ url: 'https://example.com/other.m3u8' });
  await click;
  assert.equal(f.loads.length, 0);
  assert.equal(f.state().sent, 0);
});


test('HTTP provider is adapted before sending; original path credentials stay off the TV URL', async () => {
  const original = 'http://31.43.191.125:8080/TestUser/TestPassword/123';
  let prepared = null;
  const url = 'https://calamarmenciano.com/calamar-cast.php?action=media&session=' + 'a'.repeat(64) + '&file=live.m3u8';
  const f = fixture({ prepareSource: async address => { prepared = address; return { url, type: 'application/x-mpegURL', live: true }; } });
  f.select({ url: original });
  await f.button.handlers.click();
  assert.equal(prepared, original);
  assert.equal(f.loads[0].media.contentId, url);
  assert.equal(f.state().sent, 1);
});

test('failed conversion preserves local playback and shows the installation error', async () => {
  const f = fixture({ prepareSource: async () => { throw new Error('Falta instalar el adaptador.'); } });
  f.select({ url: 'http://31.43.191.125:8080/Test/Pass/123.ts' });
  await f.button.handlers.click();
  assert.equal(f.loads.length, 0);
  assert.equal(f.state().sent, 0);
  assert.match(f.logs.at(-1), /Falta instalar/);
});


test('adapter polls until HLS is ready, keeping original credentials exclusively in a header', async () => {
  const original = 'http://31.43.191.125:8080/Test/Pass/123';
  const url = 'https://calamarmenciano.com/calamar-cast.php?action=media&session=' + 'b'.repeat(64) + '&file=live.m3u8';
  let calls = 0;
  const result = await prepareCastSource(original, { sleep: async () => {}, fetcher: async (address, options) => {
    assert.equal(address, 'https://calamarmenciano.com/calamar-cast.php?action=start');
    assert.equal(atob(options.headers['X-Calamar-Source']), original);
    return { ok: true, status: ++calls === 1 ? 202 : 200,
      headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ url: calls === 1 ? null : url }) };
  }});
  assert.equal(calls, 2);
  assert.deepEqual(result, { url, type: 'application/x-mpegURL', live: true });
  assert.equal(needsCastBridge('http://127.0.0.1:8080/Test/Pass/123'), false);
});

test('adapter rejects untrusted result URLs and does not mask installation errors', async () => {
  const address = 'http://31.43.191.125:8080/Test/Pass/123';
  const response = data => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data });
  await assert.rejects(prepareCastSource(address, { fetcher: async () => response({ url: 'https://example.com/live.m3u8' }) }), /Respuesta no válida/);
  await assert.rejects(prepareCastSource(address, { fetcher: async () => ({ ...response({ error: 'Instala FFmpeg.' }), ok: false }) }), /Instala FFmpeg/);
});


test('other public IPTV hosts use the same Cast adapter without per-domain setup', () => {
  assert.equal(needsCastBridge('http://neospaxy.top:8080/Test/Pass/57476'), true);
  assert.equal(needsCastBridge('http://another.example/live/User/Pass/42.ts?token=A%2Bb'), true);
  for (const host of ['localhost', '127.0.0.1', '10.0.0.2', '172.20.1.1', '192.168.1.2', '100.64.1.1']) {
    assert.equal(needsCastBridge(`http://${host}/User/Pass/42`), false);
  }
});


test('closing the channel cancels compatibility preparation without another hosting request', async () => {
  let calls = 0;
  const result = await prepareCastSource('http://public.example/User/Pass/123', {
    isCurrent: () => false, fetcher: async () => { calls++; },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('player pages go to the TV as the signed list relayed by calamar-player.php', async () => {
  const page = 'https://player.example/api/canal/42';
  const asked = [];
  const fetcher = async (url) => { asked.push(url); return { ok: true, json: async () => ({ url: 'calamar-player.php?seg=aHR0cHM6Ly9jZG4&p=aHR0cHM6Ly96&sig=' + 'b'.repeat(32) + '&l=1' }) }; };
  const f = fixture({ prepareSource: (address, options) => prepareCastSource(address, { ...options, fetcher }) });
  f.select({ url: page, title: 'DAZN' });
  await f.button.handlers.click();
  assert.equal(asked[0], 'https://calamarmenciano.com/calamar-player.php?page=' + encodeURIComponent(page) + '&cast=1');
  assert.equal(f.loads[0].media.contentId, 'https://calamarmenciano.com/calamar-player.php?seg=aHR0cHM6Ly9jZG4&p=aHR0cHM6Ly96&sig=' + 'b'.repeat(32) + '&l=1');
  assert.equal(f.loads[0].media.contentType, 'application/x-mpegURL');
  assert.equal(f.state().sent, 1);
});

test('a player page answer from another site or an old hosting file is not sent', async () => {
  const page = 'https://player.example/api/canal/42';
  for (const [answer, message] of [[{ url: 'https://evil.example/calamar-player.php?seg=a&sig=' + 'b'.repeat(32) }, /no válida/],
    [{ error: 'x' }, /última versión de calamar-player\.php/]]) {
    await assert.rejects(prepareCastSource(page, { fetcher: async () => ({ ok: true, json: async () => answer }) }), message);
  }
  await assert.rejects(prepareCastSource(page, { fetcher: async () => ({ ok: false, json: async () => ({ error: 'No se encontró ningún vídeo' }) }) }), /ningún vídeo/);
});
