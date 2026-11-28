import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createIptvHls, createPressureGate } from '../hosting/iptv-vps/hls.mjs';
import { openUpstream } from '../hosting/iptv-vps/upstream.mjs';
import { iptvOverflow } from '../web/iptv-vps.js';
import { webPlayback } from '../web/catalog.js';

test('IPTV pressure requires sustained load and has a lower recovery threshold', () => {
  const observe = createPressureGate();
  assert.deepEqual([0.9, 0.9, 0.50, 0.80, 0.81, 0.75].map(observe), [false, false, false, false, false, true]);
  assert.equal(observe(0.70), true);
  assert.deepEqual(Array.from({ length: 8 }, () => observe(0.60)), [true, true, true, true, true, true, true, false]);
});

test('only a configured hosting decision becomes a local MPEG-TS playback address', async () => {
  const key = '0'.repeat(32);
  const origin = `https://video.calamarmenciano.com/iptv-hls/${key}/index.m3u8`;
  const result = await iptvOverflow(origin, async (url, options) => {
    assert.equal(url, `https://calamarmenciano.com/calamar-tv-relay.php?admission=${key}`);
    assert.equal(options.redirect, 'error');
    return Response.json({ hosting: true, url: 'https://invalid.example/live.ts' });
  });
  assert.equal(result, `https://calamarmenciano.com/calamar-tv-relay.php?stream=1&backup=${key}`);
  assert.deepEqual(webPlayback(result, { pages: true }), { ok: true, kind: 'ts', relay: false });
  assert.equal(await iptvOverflow(origin, async () => Response.json({ hosting: 'true' })), null);
  assert.equal(await iptvOverflow(origin, async () => new Response('', { status: 503 })), null);
  assert.equal(await iptvOverflow('https://example.com/live.m3u8', async () => assert.fail('unexpected request')), null);
});

test('the provider connection rejects private destinations', async () => {
  await assert.rejects(openUpstream('http://127.0.0.1:8080/test', AbortSignal.timeout(1000)), /dirección pública/);
});

test('three HLS channels play concurrently and viewers of the same channel share its input', { timeout: 15000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'calamar-iptv-test-'));
  const [first, second, third, unknown] = ['a', 'b', 'c', 'd'].map(value => value.repeat(32));
  const keys = [first, second, third];
  const channels = Object.fromEntries(keys.map((key, i) => [key, `http://example.com/private/account/${i + 1}`]));
  const inputs = [];
  let busy = false;
  let service;
  try {
    function sample(video, audio) {
      return execFileSync('/usr/bin/ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '7', '-c:v', video, '-g', '50',
        '-c:a', audio, '-f', 'mpegts', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 });
    }
    const samples = new Map([
      [channels[first], sample('mpeg2video', 'mp2')], [channels[second], sample('libx264', 'aac')],
      [channels[third], sample('libx264', 'mp2')],
    ]);
    service = await createIptvHls({ root: temp, channels, underPressure: () => busy,
      input: async source => { inputs.push(source); return Readable.from([samples.get(source)]); } });
    const { server } = service;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${server.address().port}/iptv-hls`;
    const head = await fetch(`${endpoint}/${first}/index.m3u8`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'application/vnd.apple.mpegurl');
    assert.equal(head.headers.get('x-calamar-admission'), null);
    assert.equal((await fetch(`${endpoint}/${first}/index.m3u8?admission=1`, { method: 'HEAD' }))
      .headers.get('x-calamar-admission'), 'normal');
    assert.deepEqual(inputs, []);
    const origin = 'https://djyuanyo.github.io';
    const viewers = [first, first, second, third];
    const manifests = await Promise.all(viewers.map(key => fetch(`${endpoint}/${key}/index.m3u8`, { headers: { Origin: origin } })));
    const segments = await Promise.all(manifests.map(async response => {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      const text = await response.text();
      assert.match(text, /^#EXTM3U/m);
      assert.doesNotMatch(text, /example\.com|private/);
      return text.match(/^seg\d+\.ts$/m)[0];
    }));
    assert.deepEqual(inputs.sort(), Object.values(channels).sort());
    const mediaFiles = await Promise.all(segments.map(async (segment, index) => {
      const file = await fetch(`${endpoint}/${viewers[index]}/${segment}`);
      assert.equal(file.status, 200);
      return Buffer.from(await file.arrayBuffer());
    }));
    for (const [index, media] of mediaFiles.entries()) {
      const probe = execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-of', 'json', '-show_entries', 'stream=codec_name,r_frame_rate', 'pipe:0'], { input: media });
      const streams = JSON.parse(probe).streams;
      assert.deepEqual(streams.map(stream => stream.codec_name), ['h264', 'aac']);
      assert.equal(streams[0].r_frame_rate, viewers[index] === first ? '30/1' : '25/1');
    }
    // Only the later viewer requests another segment after all original responses have finished.
    busy = true;
    assert.equal((await fetch(`${endpoint}/${first}/index.m3u8?admission=1`, { method: 'HEAD' }))
      .headers.get('x-calamar-admission'), 'busy');
    const stillWatching = await fetch(`${endpoint}/${first}/${segments[1]}`);
    assert.equal(stillWatching.status, 200);
    assert.deepEqual(Buffer.from(await stillWatching.arrayBuffer()), mediaFiles[1]);
    assert.equal(inputs.filter(source => source === channels[first]).length, 1);
    assert.equal((await fetch(`${endpoint}/${unknown}/index.m3u8`)).status, 404);
  } finally {
    if (service) await service.close();
    await rm(temp, { recursive: true, force: true });
  }
});
