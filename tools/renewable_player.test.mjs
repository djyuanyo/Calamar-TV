import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSources, renewalDelay, mountRenewable } from '../web/renewable-player.js';
import { renewablePage, webPlayback } from '../web/catalog.js';
const page = 'https://zicotv.cc/api/player/28';
const epoch = 1793040000000;
const media = (seconds, cdn = 'cdn4') => `https://${cdn}.zicotv.cc/live/index.m3u8?token=aaa-bbb-${seconds}-`;
const document = (...urls) => `var ZT_SOURCES = ${JSON.stringify(urls.map(url => ({ url })))};`;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(fetcher, NativeHls = true) {
  let clock = epoch, id = 0;
  const jobs = new Map(), listeners = new Map(), engines = [], statuses = [], fallbacks = [];
  const video = { paused: true, src: '', canPlayType: () => NativeHls ? '' : 'maybe',
    play() { this.paused = false; return Promise.resolve(); },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  class Hls {
    static Events = { ERROR: 'error' };
    static isSupported = () => true;
    constructor() { engines.push(this); }
    on(name, fn) { this[name] = fn; }
    loadSource(url) { this.url = url; }
    attachMedia() {}
    destroy() { this.destroyed = true; }
    emitError(code = 403) { this[Hls.Events.ERROR]('', { fatal: true, response: { code } }); }
  }
  const timers = { setTimeout(fn, delay) { jobs.set(++id, { fn, at: clock + delay }); return id; }, clearTimeout(key) { jobs.delete(key); } };
  const stop = mountRenewable({ page, video, Hls: NativeHls ? Hls : null, fetcher, timers, now: () => clock,
    onStatus: s => statuses.push(s), onFallback: () => fallbacks.push(true) });
  return { stop, engines, video, listeners, statuses, fallbacks, jobs,
    async tick(ms) { clock += ms; for (const [key, job] of [...jobs]) if (job.at <= clock && jobs.has(key)) { jobs.delete(key); job.fn(); } await flush(); } };
}
const response = html => ({ ok: true, url: page, text: async () => html });

test('only HTTPS public player endpoints resolve; direct video and other hosts do not', () => {
  for (const url of [page, 'https://bp.zicotv.cc/api/player/1?token=a']) assert.equal(renewablePage(url), true);
  for (const url of ['http://zicotv.cc/api/player/1', 'https://zicotv.cc.evil.example/api/player/1', 'https://zicotv.cc/channels/1', 'https://user:pass@zicotv.cc/api/player/1']) assert.equal(renewablePage(url), false);
  assert.equal(webPlayback(page, { pages: true }).renewable, true);
});
test('JSON parsing handles escaped slashes, quotes and brackets; excludes locked, non-media and credentials', () => {
  const html = `var ZT_SOURCES = ${JSON.stringify([{ label: 'CDN ] "', url: media(1793041200) }, { url: media(1793041200), locked: true },
    { url: 'https://user:pass@cdn.example/v.m3u8' }, { url: 'javascript:bad' }, { url: 'https://x/v.mp4' }]).replaceAll('/', '\\/')}; throw Error('never executed')`;
  assert.deepEqual(pageSources(html, page), [media(1793041200)]);
  assert.deepEqual(pageSources('var ZT_SOURCES=[]; var secret="https://x/locked.m3u8"', page), []);
  assert.deepEqual(pageSources('var ZT_SOURCES=[{', page), []);
});
test('renewal is before expiry, with bounded polling for same or unknown token', () => {
  assert.equal(renewalDelay(media(1793041200), epoch), 1170000);
  assert.equal(renewalDelay(media(1793040001), epoch), 15000);
  assert.equal(renewalDelay('https://x/live.m3u8', epoch), 300000);
});
test('rereads the fixed page, replaces expired token and cleans old engines and timers', async () => {
  let calls = 0;
  const f = fixture(async (url, opts) => { assert.equal(url, page); assert.equal(opts.cache, 'no-store'); return response(document(media(++calls === 1 ? 1793040120 : 1793041320))); });
  await flush();
  assert.equal(f.engines[0].url, media(1793040120));
  await f.tick(90000);
  assert.equal(calls, 2);
  assert.equal(f.engines[0].destroyed, true);
  assert.equal(f.engines[1].url, media(1793041320));
  f.stop();
  assert.equal(f.engines[1].destroyed, true);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.listeners.size, 0);
});
test('403 causes one fresh page request and selects next CDN; concurrent errors coalesce', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response(document(media(1793041200), media(1793041200, 'cdn3'))); });
  await flush();
  f.engines[0].emitError(); f.engines[0].emitError();
  await f.tick(2000);
  assert.equal(calls, 2);
  assert.equal(f.engines[1].url, media(1793041200, 'cdn3'));
  f.stop();
});
test('native HLS also renews and reconnects after a stalled stream', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response(document(media(1793041200))); }, false);
  await flush();
  assert.equal(f.video.src, media(1793041200));
  f.listeners.get('stalled')();
  await f.tick(20000); await f.tick(2000);
  assert.equal(calls, 2);
  f.stop();
});
test('stale requests cannot start playback after closing/changing the channel', async () => {
  let finish, signal;
  const f = fixture((_url, opts) => { signal = opts.signal; return new Promise(resolve => { finish = resolve; }); });
  f.stop();
  assert.equal(signal.aborted, true);
  finish(response(document(media(1793041200)))); await flush();
  assert.equal(f.engines.length, 0);
  assert.equal(f.jobs.size, 0);
});
test('CORS rejection, locked sources and invalid data use provider player, without relay', async () => {
  for (const fetcher of [async () => { throw Error('CORS'); }, async () => response('var ZT_SOURCES=[];'), async () => response('var ZT_SOURCES=[bad];')]) {
    const f = fixture(fetcher); await flush();
    assert.equal(f.fallbacks.length, 1); assert.equal(f.engines.length, 0); assert.equal(f.jobs.size, 0);
  }
});
test('temporary renewal outage retries while existing playback remains available', async () => {
  let calls = 0;
  const f = fixture(async () => { if (++calls === 2) throw Error('offline'); return response(document(media(calls === 1 ? 1793040120 : 1793041320))); });
  await flush(); await f.tick(90000);
  assert.equal(f.engines.length, 1);
  await f.tick(2000);
  assert.equal(f.engines.length, 2);
  f.stop();
});
