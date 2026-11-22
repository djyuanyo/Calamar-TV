import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createIptvHls } from '../hosting/iptv-vps/hls.mjs';
import { openUpstream } from '../hosting/iptv-vps/upstream.mjs';

test('the provider connection rejects private destinations', async () => {
  await assert.rejects(openUpstream('http://127.0.0.1:8080/test', AbortSignal.timeout(1000)), /dirección pública/);
});

test('three HLS channels play concurrently and viewers of the same channel share its input', { timeout: 15000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'calamar-iptv-test-'));
  const [first, second, third, unknown] = ['a', 'b', 'c', 'd'].map(value => value.repeat(32));
  const keys = [first, second, third];
  const channels = Object.fromEntries(keys.map((key, i) => [key, `http://example.com/private/account/${i + 1}`]));
  const inputs = [];
  let service;
  try {
    const sample = execFileSync('/usr/bin/ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '7', '-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpegts', 'pipe:1'],
    { maxBuffer: 4 * 1024 * 1024 });
    service = await createIptvHls({ root: temp, channels,
      input: async source => { inputs.push(source); return Readable.from([sample]); } });
    const { server } = service;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const endpoint = `http://127.0.0.1:${server.address().port}/iptv-hls`;
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
    for (const media of mediaFiles) {
      const probe = execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-of', 'json', '-show_entries', 'stream=codec_name', 'pipe:0'], { input: media });
      assert.deepEqual(JSON.parse(probe).streams.map(stream => stream.codec_name), ['h264', 'aac']);
    }
    assert.equal((await fetch(`${endpoint}/${unknown}/index.m3u8`)).status, 404);
  } finally {
    if (service) await service.close();
    await rm(temp, { recursive: true, force: true });
  }
});
