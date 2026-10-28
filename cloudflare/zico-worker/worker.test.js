import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, mediaURL, publicSources, rewrite } from './src/worker.js';

const env = { ADMIN_TOKEN: 'a'.repeat(40), RELAY_SECRET: 's'.repeat(40), MEDIA_HOSTS: 'zicotv.cc,bp.zicotv.cc,cdn.zicotv.cc' };
const page = 'https://zicotv.cc/api/player/4';
const origin = 'https://calamar.example';
const request = path => new Request(origin + path, { headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN } });
const path = '/diagnose?page=' + encodeURIComponent(page);
const setup = 'var ZT_SOURCES = [{"url":"https://cdn.zicotv.cc/live/master.m3u8?t=token"}];';

test('public extractor preserves signed URL and ignores locked/premium entries', () => {
  assert.deepEqual(publicSources('var ZT_SOURCES = [{"url":"/a.m3u8?t=1&x=2"},{"url":"/locked.m3u8","locked":true},{"url":"/paid.m3u8","is_premium":true}];', page), ['https://zicotv.cc/a.m3u8?t=1&x=2']);
  assert.deepEqual(publicSources('var ZT_SOURCES = [];<video src="https://cdn.zicotv.cc/locked.m3u8">', page), []);
  assert.deepEqual(publicSources('var ZT_SOURCES = [alert(1)];', page), []);
});
test('all HLS references are signed, including keys, initialization, audio and variants', async () => {
  const list = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=123\n../video.m3u8?t=a&b=c\n';
  const result = await rewrite(list, 'https://cdn.zicotv.cc/live/master.m3u8', page, env, origin);
  const links = [...result.matchAll(/https:\/\/calamar\.example\/media\?[^"\n]+/g)].map(m => m[0]);
  assert.equal(links.length, 4);
  assert.deepEqual(links.map(l => JSON.parse(new URL(l).searchParams.get('data'))[0]), ['https://cdn.zicotv.cc/live/key.bin', 'https://cdn.zicotv.cc/live/init.mp4', 'https://cdn.zicotv.cc/live/audio.m3u8', 'https://cdn.zicotv.cc/video.m3u8?t=a&b=c']);
});
test('missing configuration or authentication never calls provider', async () => {
  let calls = 0;
  const worker = createWorker(async () => { calls++; throw Error(); });
  assert.equal((await worker.fetch(request(path), {})).status, 503);
  assert.equal((await worker.fetch(new Request(origin + path), env)).status, 401);
  assert.equal(calls, 0);
});
test('unsigned, expired and changed media URLs are rejected', async () => {
  let calls = 0;
  const worker = createWorker(async () => { calls++; throw Error(); });
  assert.equal((await worker.fetch(request('/media?data=bad&sig=bad'), env)).status, 403);
  const expired = await mediaURL('https://cdn.zicotv.cc/a.m3u8', page, env, origin, Math.floor(Date.now() / 1000) - 1);
  assert.equal((await worker.fetch(new Request(expired), env)).status, 403);
  const valid = new URL(await mediaURL('https://cdn.zicotv.cc/a.m3u8', page, env, origin));
  valid.searchParams.set('data', valid.searchParams.get('data').replace('cdn.zicotv.cc', 'other.example'));
  assert.equal((await worker.fetch(new Request(valid), env)).status, 403);
  assert.equal(calls, 0);
});
test('redirects cannot leave allowlist or access an internal IP', async () => {
  let calls = 0;
  const worker = createWorker(async () => { calls++; return new Response('', { status: 302, headers: { Location: 'https://127.0.0.1/secrets' } }); });
  const data = await (await worker.fetch(request(path), env)).json();
  assert.equal(data.ok, false);
  assert.equal(data.checks[0].reason, 'host');
  assert.equal(calls, 1);
});
test('provider 403 is reported at page stage, without retries or leaking source tokens', async () => {
  let calls = 0;
  const worker = createWorker(async () => { calls++; return new Response('Forbidden', { status: 403 }); });
  const data = await (await worker.fetch(request(path), env)).json();
  assert.equal(data.checks[0].stage, 'page');
  assert.equal(data.checks[0].status, 403);
  assert.equal(calls, 1);
});
test('diagnostic follows master and media list, then samples the segment', async () => {
  const seen = [];
  const worker = createWorker(async (url, options) => {
    seen.push({ url, options });
    if (url === page) return new Response(setup);
    if (url.includes('master.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=123\nvideo.m3u8\n');
    if (url.includes('video.m3u8')) return new Response('#EXTM3U\n#EXTINF:10,\nsegment.ts\n');
    return new Response(new Uint8Array([0x47, 0x40, 0, 0]), { status: 206, headers: { 'Content-Type': 'video/mp2t' } });
  });
  const data = await (await worker.fetch(request(path), env)).json();
  assert.equal(data.ok, true);
  assert.equal(seen.length, 4);
  assert.equal(seen.at(-1).options.headers.Range, 'bytes=0-4095');
  assert.equal(seen.at(-1).options.headers.Referer, page);
  assert.ok(!JSON.stringify(data).includes('t=token'));
});
test('segments returning HTML fail diagnostic instead of declaring playback success', async () => {
  const worker = createWorker(async url => {
    if (url === page) return new Response(setup);
    if (url.includes('.m3u8')) return new Response('#EXTM3U\n#EXTINF:10,\ns.ts\n');
    return new Response('<html>Denied</html>', { headers: { 'Content-Type': 'text/html' } });
  });
  const data = await (await worker.fetch(request(path), env)).json();
  assert.equal(data.ok, false);
  assert.equal(data.checks.at(-1).stage, 'segment');
});
test('relay preserves partial segment status and range headers', async () => {
  const worker = createWorker(async () => new Response(new Uint8Array([1,2]), { status: 206, headers: { 'Content-Type': 'video/mp2t', 'Content-Range': 'bytes 0-1/100' } }));
  const url = await mediaURL('https://cdn.zicotv.cc/s.ts', page, env, origin);
  const response = await worker.fetch(new Request(url, { headers: { Range: 'bytes=0-1' } }), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-1/100');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1,2]));
});
test('external CDN must be explicitly allowed', async () => {
  const worker = createWorker(async () => new Response('var ZT_SOURCES = [{"url":"https://cdn.other.example/live.m3u8"}];'));
  const data = await (await worker.fetch(request(path), env)).json();
  assert.equal(data.ok, false);
  assert.match(data.checks[0].detail, /cdn.other.example/);
});
