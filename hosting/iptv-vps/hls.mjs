import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { openUpstream } from './upstream.mjs';
import { createRegistry } from './register.mjs';

const route = /^\/iptv-hls\/([a-f0-9]{32})\/(index\.m3u8|seg[0-9]{1,16}\.ts)$/;
const origins = new Set(['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com']);

export async function createIptvHls({ channels, root, register, input = openUpstream,
  idleMs = 45000, startupMs = 9000, ffmpeg = '/usr/bin/ffmpeg' }) {
  await mkdir(root, { recursive: true, mode: 0o750 });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[a-f0-9]{32}$/.test(entry.name)) await rm(join(root, entry.name), { recursive: true });
  }
  const running = new Map();

  async function transcode({ dir, source, stop }) {
    await mkdir(dir, { recursive: true, mode: 0o750 });
    const stream = await input(source, stop.signal);
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts+discardcorrupt',
      '-f', 'mpegts', '-protocol_whitelist', 'pipe', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-vf', "scale=-2:'min(720,trunc(ih/2)*2)',fps=30", '-c:v', 'libx264', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-threads:v', '2', '-crf', '22', '-maxrate', '2500k', '-bufsize', '5000k',
      '-force_key_frames', 'expr:gte(t,n_forced*2)', '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_delete_threshold', '4',
      '-hls_start_number_source', 'epoch', '-hls_flags', 'delete_segments+temp_file+omit_endlist+append_list+independent_segments',
      '-hls_segment_filename', 'seg%d.ts', 'index.m3u8',
    ], { cwd: dir, signal: stop.signal, killSignal: 'SIGKILL', stdio: ['pipe', 'ignore', 'ignore'] });
    const closed = new Promise(resolve => { child.on('error', () => {}); child.once('close', resolve); });
    const transfer = pipeline(stream, child.stdin, { signal: stop.signal }).catch(() => {});
    await closed;
    stream.destroy();
    await transfer;
  }

  function run(session) {
    session.work = transcode(session).catch(() => {}).finally(() => {
      session.work = null;
      session.retryAt = Date.now() + 2000;
    });
  }

  async function dispose(key, session) {
    if (session.stop.signal.aborted) return;
    session.stop.abort();
    await session.work;
    try { await rm(session.dir, { recursive: true, force: true }); }
    finally { running.delete(key); }
  }

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of running) {
      if (session.stop.signal.aborted) continue;
      if (now - session.used >= idleMs) void dispose(key, session).catch(() => {});
      else if (!session.work && now >= session.retryAt) run(session);
    }
  }, 1000);
  interval.unref();

  const reply = (res, status) => {
    if (status === 503) res.setHeader('Retry-After', '2');
    res.writeHead(status).end();
  };

  async function serve(req, res) {
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return reply(res, 403);
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.url === '/iptv-hls/register' && register) return register(req, res);
    const match = route.exec(req.url.split('?', 1)[0]);
    if (!match || !Object.hasOwn(channels, match[1])) return reply(res, 404);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      return reply(res, 204);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405);

    const [, key, name] = match;
    const manifest = name === 'index.m3u8';
    let session = running.get(key);
    if (!session) {
      if (!manifest) return reply(res, 404);
      session = { dir: join(root, key), source: channels[key], stop: new AbortController(), used: Date.now() };
      running.set(key, session);
      run(session);
    }
    if (session.stop.signal.aborted) return reply(res, 503);
    session.used = Date.now();

    const deadline = Date.now() + startupMs;
    while (!res.destroyed && !session.stop.signal.aborted) {
      let file;
      try { file = await open(join(session.dir, name), 'r'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (file) {
        try {
          const { size, mtimeMs } = await file.stat();
          if (res.destroyed) return;
          if (!manifest || Date.now() - mtimeMs < 12000) {
            res.writeHead(200, { 'Content-Type': manifest ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Content-Length': size });
            if (req.method === 'HEAD') res.end();
            else await pipeline(file.createReadStream({ autoClose: false }), res);
            return;
          }
        } finally { await file.close(); }
      }
      if (!manifest || Date.now() >= deadline) return reply(res, manifest ? 503 : 404);
      await sleep(200);
    }
    if (!res.destroyed) reply(res, 503);
  }

  const server = createServer({ headersTimeout: 10000, requestTimeout: 15000 }, (req, res) => {
    void serve(req, res).catch(() => {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else reply(res, 503);
    });
  });
  return { server, async close() {
    clearInterval(interval);
    server.close();
    server.closeAllConnections();
    await Promise.all([...running].map(([key, session]) => dispose(key, session)));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = await readFile(process.argv[2] || '/etc/calamar-iptv-vps/sources.json', 'utf8');
  const channels = JSON.parse(raw);
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)
      || Object.entries(channels).some(([key, value]) => !/^[a-f0-9]{32}$/.test(key) || typeof value !== 'string')) {
    throw new Error('Registro IPTV no válido');
  }
  const [{ verifyAdmin }, { vpsIptvSource }] = await Promise.all([
    import('file:///opt/calamar-acestream/registry.mjs'), import('./http-stream.mjs'),
  ]);
  const registry = await createRegistry({ seed: channels, authorize: verifyAdmin, accepts: vpsIptvSource,
    stateFile: join(process.env.STATE_DIRECTORY || '/var/lib/calamar-iptv-vps', 'registered.json') });
  const service = await createIptvHls({ ...registry,
    root: process.env.CACHE_DIRECTORY || '/var/cache/calamar-iptv-vps' });
  service.server.listen(6883, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void service.close());
}
