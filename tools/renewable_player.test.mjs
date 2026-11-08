import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSources, renewalDelay, mountRenewable } from '../web/renewable-player.js';
import { renewablePage, webPlayback } from '../web/catalog.js';
import { watchPlaybackStall } from '../web/playback-stall.js';
const page = 'https://zicotv.cc/api/player/28';
const epoch = 1793040000000;
const media = (seconds, cdn = 'cdn4') => `https://${cdn}.zicotv.cc/live/index.m3u8?token=aaa-bbb-${seconds}-`;
const document = (...urls) => `var ZT_SOURCES = ${JSON.stringify(urls.map(url => ({ url })))};`;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(fetcher, NativeHls = true, options = {}) {
  let clock = epoch, id = 0;
  const jobs = new Map(), listeners = new Map(), engines = [], statuses = [], fallbacks = [];
  const video = { paused: true, currentTime: 0, src: '', canPlayType: () => NativeHls ? '' : 'maybe',
    play() { this.paused = false; return Promise.resolve(); },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      const group = listeners.get(name);
      group.delete(fn);
      if (!group.size) listeners.delete(name);
    } };
  class Hls {
    static Events = { ERROR: 'error', MANIFEST_LOADED: 'manifest', LEVEL_LOADED: 'level', FRAG_LOADED: 'fragment' };
    static isSupported = () => true;
    constructor() { engines.push(this); }
    on(name, fn) { this[name] = fn; }
    loadSource(url) { this.url = url; }
    attachMedia() {}
    destroy() { this.destroyed = true; }
    emitError(code = 403) { this[Hls.Events.ERROR]('', { fatal: true, response: { code } }); }
  }
  const timers = { setTimeout(fn, delay) { jobs.set(++id, { fn, at: clock + delay }); return id; }, clearTimeout(key) { jobs.delete(key); } };
  const stop = mountRenewable({ page, video, Hls: NativeHls ? Hls : null, fetcher, timers, now: () => clock, preferDirect: false,
    onStatus: s => statuses.push(s), onFallback: () => fallbacks.push(true), ...options });
  return { stop, engines, video, listeners, statuses, fallbacks, jobs,
    emit(name) { for (const listener of listeners.get(name) || []) listener(); },
    async tick(ms) { clock += ms; for (const [key, job] of [...jobs]) if (job.at <= clock && jobs.has(key)) { jobs.delete(key); job.fn(); } await flush(); } };
}
const signed = upstream => 'https://calamarmenciano.com/calamar-player.php?seg=' + Buffer.from(upstream).toString('base64url') + '&p=page&sig=signature&l=1';
const response = upstream => ({ ok: true, json: async () => ({ url: signed(upstream) }) });

test('only HTTPS public player endpoints resolve; direct video and other hosts do not', () => {
  for (const url of [page, 'https://bp.zicotv.cc/api/player/1?token=a', 'https://bp.zicotv.cc/channels/1']) assert.equal(renewablePage(url), true);
  for (const url of ['http://zicotv.cc/api/player/1', 'https://zicotv.cc.evil.example/api/player/1', 'https://user:pass@zicotv.cc/api/player/1']) assert.equal(renewablePage(url), false);
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

test('starts immediately through hosting and renews the signed video before its upstream token expires', async () => {
  let calls = 0;
  const f = fixture(async (url, opts) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'calamarmenciano.com'); assert.equal(u.searchParams.get('page'), page);
    assert.equal(u.searchParams.get('cast'), '1'); assert.equal(opts.cache, 'no-store');
    return response(media(++calls === 1 ? 1793040120 : 1793041320));
  });
  await flush();
  assert.equal(f.engines[0].url, signed(media(1793040120)), 'no 30-second startup timer');
  await f.tick(90000); assert.equal(calls, 2); assert.equal(f.engines[0].destroyed, true);
  assert.equal(f.engines[1].url, signed(media(1793041320)));
  f.stop(); assert.equal(f.jobs.size, 0); assert.equal(f.listeners.size, 0);
});

test('a media error promptly retries automatic selection and coalesces concurrent failures', async () => {
  const calls = [];
  const f = fixture(async url => { calls.push(new URL(url)); return response(media(1793041200, calls.length === 1 ? 'cdn4' : 'cdn3')); });
  await flush(); f.engines[0].emitError(); f.engines[0].emitError();
  await f.tick(250); assert.equal(calls.length, 2); assert.equal(calls[1].searchParams.get('intento'), '1');
  assert.equal(f.engines[1].url, signed(media(1793041200, 'cdn3')));
  assert.ok(calls.every(u => u.hostname === 'calamarmenciano.com')); f.stop();
});

test('native HLS allows slow hosting startup and retries a real 30-second stall', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response(media(1793041200)); }, false);
  await flush(); assert.equal(f.video.src, signed(media(1793041200)));
  f.video.currentTime = 900;
  f.emit('playing');
  f.emit('waiting'); await f.tick(8000); assert.equal(calls, 1);
  f.emit('progress'); f.emit('timeupdate'); f.emit('waiting');
  await f.tick(22000); await f.tick(250);
  assert.equal(calls, 2); f.stop();
});

test('closing a channel aborts resolution and ignores a late response', async () => {
  let finish, signal;
  const f = fixture((_url, opts) => { signal = opts.signal; return new Promise(resolve => { finish = resolve; }); });
  f.stop(); assert.equal(signal.aborted, true);
  finish(response(media(1793041200))); await flush(); assert.equal(f.engines.length, 0); assert.equal(f.jobs.size, 0);
});

test('invalid or unsigned relay destinations are rejected without contacting the provider', async () => {
  for (const url of ['https://cdn.example/live.m3u8', 'https://calamarmenciano.com.evil.test/calamar-player.php?seg=x&sig=y', '/other.php?seg=x&sig=y']) {
    const f = fixture(async request => {
      assert.equal(new URL(request).hostname, 'calamarmenciano.com');
      return { ok: true, json: async () => ({ url }) };
    });
    await flush(); assert.equal(f.engines.length, 0); assert.equal(f.fallbacks.length, 0); f.stop();
  }
});

test('a temporary lookup failure preserves existing playback and keeps retries bounded', async () => {
  let calls = 0;
  const f = fixture(async () => { if (++calls === 2) throw Error('offline'); return response(media(calls === 1 ? 1793040120 : 1793041320)); });
  await flush(); await f.tick(90000); assert.equal(f.engines.length, 1);
  await f.tick(250); assert.equal(f.engines.length, 2);
  for (let i = 0; i < 8; i++) { f.engines.at(-1).emitError(); await f.tick(10000); }
  assert.equal(f.fallbacks.length, 0); assert.equal(f.jobs.size, 1); f.stop();
});

test('renewal preserves pause and does not restart an unchanged video', async () => {
  let calls = 0;
  const f = fixture(async () => response(media(++calls <= 2 ? 1793040120 : 1793041320)));
  await flush(); f.video.paused = true; await f.tick(90000);
  assert.equal(f.engines.length, 1); assert.equal(f.video.paused, true);
  await f.tick(15000); assert.equal(f.engines.length, 2); assert.equal(f.video.paused, true); f.stop();
});

test('the source menu is loaded after the first picture and never blocks the automatic video', async () => {
  const calls = [], menus = [];
  let finishMenu;
  const f = fixture(async url => {
    calls.push(url);
    if (new URL(url).searchParams.has('list')) return new Promise(resolve => { finishMenu = resolve; });
    return response(media(1793041200));
  }, true, { onSources: rows => menus.push(rows) });
  await flush(); assert.equal(f.engines.length, 1); assert.equal(calls.length, 1);
  f.emit('playing'); await flush(); assert.equal(calls.length, 2);
  finishMenu({ ok: true, json: async () => ({ sources: 3 }) }); await flush();
  assert.equal(menus[0].length, 3); assert.equal(f.engines.length, 1); f.stop(); assert.equal(f.jobs.size, 0);
});

test('an explicitly chosen hosted signal is preserved on renewal and error retry', async () => {
  const calls = [];
  const chosen = 'https://calamarmenciano.com/calamar-player.php?page=' + encodeURIComponent(page) + '&cast=1&src=1';
  const f = fixture(async url => { calls.push(new URL(url)); return response(media(1793041200)); }, true, { page: chosen });
  await flush(); f.engines[0].emitError(); await f.tick(250);
  assert.equal(calls.length, 2); assert.ok(calls.every(u => u.searchParams.get('src') === '1' && !u.searchParams.has('intento')));
  assert.equal(webPlayback(chosen, { pages: true }).renewable, true); f.stop();
});


test('2.20.67 direct lookup starts without contacting the hosting and renews its token', async () => {
  const calls = [];
  const f = fixture(async (url, options) => {
    calls.push(url); assert.equal(url, page); assert.equal(options.credentials, 'omit');
    return {ok:true, url:page, text:async()=>document(media(calls.length === 1 ? 1793040120 : 1793041320))};
  }, true, {preferDirect:true});
  await flush(); assert.equal(f.engines[0].url, media(1793040120));
  await f.tick(90000); assert.equal(f.engines[1].url, media(1793041320));
  assert.equal(calls.length, 2); f.stop();
});

test('a blocked provider falls back to signed hosting without replacing our player', async () => {
  const calls = [];
  const f = fixture(async url => {
    calls.push(url);
    if (url === page) throw new TypeError('Failed to fetch');
    return response(media(1793041200));
  }, true, {preferDirect:true});
  await flush(); await f.tick(250);
  assert.equal(calls[0], page); assert.equal(new URL(calls[1]).hostname, 'calamarmenciano.com');
  assert.equal(f.engines[0].url, signed(media(1793041200))); assert.equal(f.fallbacks.length, 0); f.stop();
});

test('an unreachable hosting falls back to the public provider with fresh renewal', async () => {
  let direct = 0;
  const f = fixture(async url => {
    if (url !== page) throw new TypeError('Failed to fetch');
    direct++; return {ok:true,url:page,text:async()=>document(media(direct === 1 ? 1793040120 : 1793041320))};
  });
  await flush(); await f.tick(250); assert.equal(f.engines.length, 0);
  await f.tick(250); assert.equal(f.engines[0].url, media(1793040120));
  await f.tick(90000); assert.equal(f.engines[1].url, media(1793041320)); f.stop();
});

test('direct lookup never plays locked sources or expired tokens', async () => {
  const f = fixture(async url => {
    if (url !== page) return response(media(1793041200));
    return {ok:true,url:page,text:async()=>`var ZT_SOURCES = ${JSON.stringify([{url:media(1793041200),locked:true},{url:media(1793039999)}])};`};
  }, true, {preferDirect:true});
  await flush(); assert.equal(f.engines.length, 0); await f.tick(250);
  assert.equal(f.engines[0].url, signed(media(1793041200))); f.stop();
});


test('slow master and fragment progress restart the startup deadline', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response(media(1793041200)); });
  await flush(); f.emit('waiting'); await f.tick(25000);
  f.engines[0].manifest(); await f.tick(25000); assert.equal(calls, 1);
  f.engines[0].fragment(); await f.tick(25000); assert.equal(calls, 1);
  f.video.currentTime = 1; f.emit('timeupdate'); await f.tick(25000); assert.equal(calls, 1); f.stop();
});

test('watchdog ignores background time, user pause, and downloads without playback progress', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const video = Object.assign(new EventTarget(), { paused: false, currentTime: 899 });
  const document = Object.assign(new EventTarget(), { hidden: false });
  let stalls = 0;
  const watch = watchPlaybackStall(video, () => stalls++, { document });
  const emit = name => video.dispatchEvent(new Event(name));
  emit('playing');
  t.mock.timers.tick(29000);
  video.currentTime = 900; emit('timeupdate');
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(31000); assert.equal(stalls, 0);
  document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(20000);
  video.paused = true; emit('pause');
  t.mock.timers.tick(31000); assert.equal(stalls, 0);
  video.paused = false; emit('play');
  t.mock.timers.tick(20000); emit('progress'); emit('timeupdate');
  t.mock.timers.tick(10000); assert.equal(stalls, 1);
  watch.stop(); emit('play');
  t.mock.timers.tick(30000); assert.equal(stalls, 1);
});

test('a failed hosting hostname uses its own www alias and preserves manual selection on renewal', async () => {
  const calls = [];
  const chosen = 'https://calamarmenciano.com/calamar-player.php?page=' + encodeURIComponent(page) + '&source_id=0123456789abcdef';
  const f = fixture(async url => {
    const u = new URL(url); calls.push(u);
    assert.equal(u.searchParams.get('source_id'), '0123456789abcdef');
    assert.equal(u.searchParams.get('page'), page);
    if (u.hostname === 'calamarmenciano.com') throw new TypeError('network reset');
    assert.equal(u.hostname, 'www.calamarmenciano.com');
    return {ok:true,json:async()=>({url:'calamar-player.php?seg='+Buffer.from(media(1793040120)).toString('base64url')+'&sig=ok'})};
  }, true, {page:chosen});
  await flush(); await f.tick(250);
  assert.equal(new URL(f.engines[0].url).hostname,'www.calamarmenciano.com');
  await f.tick(90000); assert.equal(calls.length,3);
  assert.equal(calls[2].hostname,'www.calamarmenciano.com'); assert.equal(f.fallbacks.length,0); f.stop();
});

test('a media network reset tries the owned www relay before the direct provider', async () => {
  const calls = [];
  const f = fixture(async url => {
    const u = new URL(url); calls.push(u);
    return {ok:true,json:async()=>({url:'calamar-player.php?seg=playlist&sig=ok'})};
  });
  await flush(); f.engines[0].emitError(0); await f.tick(250);
  assert.deepEqual(calls.map(u=>u.hostname), ['calamarmenciano.com','www.calamarmenciano.com']);
  assert.equal(new URL(f.engines[1].url).hostname,'www.calamarmenciano.com'); f.stop();
});
