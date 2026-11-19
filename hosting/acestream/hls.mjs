import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = process.env.CACHE_DIRECTORY || '/var/cache/calamar-ace-hls';
const channelFile = '/etc/calamar-acestream/channels.json';
const idleMs = 35000;
const sessions = new Map();
const origins = new Set([
  'https://djyuanyo.github.io',
  'https://calamarmenciano.com',
  'https://www.calamarmenciano.com',
]);
const route = /^\/ace-hls\/([a-f0-9]{32})\/(index\.m3u8|s[0-9]{1,16}\.ts)$/;

function start(session) {
  session.child = spawn('/usr/bin/ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-rw_timeout', '22000000',
    '-i', `http://127.0.0.1:6882/ace-live/${session.key}.ts`,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8',
    '-hls_delete_threshold', '3', '-hls_start_number_source', 'epoch',
    '-hls_flags', 'delete_segments+temp_file+omit_endlist+append_list',
    '-hls_segment_filename', 's%d.ts', 'index.m3u8',
  ], { cwd: session.dir, stdio: ['ignore', 'ignore', 'inherit'] });
  session.child.once('error', error => console.error('FFmpeg:', error.message));
  session.child.once('close', () => {
    session.child = null;
    session.retryAt = Date.now() + 2000;
  });
}

const timer = setInterval(() => {
  for (const [key, session] of sessions) {
    if (Date.now() - session.lastUse < idleMs) {
      if (!session.child && Date.now() >= session.retryAt) start(session);
      continue;
    }
    if (session.child) {
      session.child.kill('SIGKILL');
      continue;
    }
    sessions.delete(key);
    rmSync(session.dir, { recursive: true, force: true });
  }
}, 2000);
timer.unref();

function respond(res, status) {
  if (status === 503) res.setHeader('Retry-After', '2');
  res.writeHead(status).end();
}

async function serve(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const match = route.exec(req.url.split('?', 1)[0]);
  if (!match) return respond(res, 404);
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) return respond(res, 403);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    return respond(res, 204);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405);

  const [, key, name] = match;
  const channels = JSON.parse(readFileSync(channelFile, 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(channels[key])) return respond(res, 404);
  const playlist = name === 'index.m3u8';
  let session = sessions.get(key);
  if (!session) {
    if (!playlist) return respond(res, 404);
    const dir = join(root, key);
    mkdirSync(dir, { recursive: true });
    session = { dir, key, lastUse: Date.now(), retryAt: 0, child: null };
    sessions.set(key, session);
    start(session);
  }
  session.lastUse = Date.now();

  const deadline = Date.now() + 25000;
  let file;
  while (!res.destroyed) {
    try {
      file = await open(join(session.dir, name), 'r');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!playlist) return respond(res, 404);
      if (Date.now() >= deadline) return respond(res, 503);
      await sleep(250);
    }
  }
  if (!file) return;
  try {
    const { size } = await file.stat();
    if (res.destroyed) return;
    res.writeHead(200, {
      'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Content-Length': size,
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream({ autoClose: false }), res);
  } finally {
    await file.close();
  }
}

const server = http.createServer((req, res) => {
  void serve(req, res).catch(error => {
    if (res.destroyed) return;
    console.error('HLS:', error.message);
    if (res.headersSent) res.destroy();
    else respond(res, 503);
  });
});
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (dir.isDirectory() && /^[a-f0-9]{32}$/.test(dir.name)) rmSync(join(root, dir.name), { recursive: true });
}
server.listen(6880, '127.0.0.1');
