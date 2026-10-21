import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castSource, initCast } from '../web/cast-player.js';

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

function fixture() {
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
  initCast({ button, toggle, disconnect, win, getSource: () => selected,
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
  assert.match(f.logs[0], /adaptación/);
});

test('changing source while selecting a device cannot send the previous signed URL', async () => {
  const f = fixture();
  const click = f.button.handlers.click();
  f.select({ url: 'https://example.com/other.m3u8' });
  await click;
  assert.equal(f.loads.length, 0);
  assert.equal(f.state().sent, 0);
});
