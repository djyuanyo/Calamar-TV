import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { chownSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startVpsMetrics } from './vps-metrics.mjs';

const project = 'menciamedia';
const adminEmail = 'juanjocarrillo7@gmail.com';
const apiKey = 'AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk'; // Public Firebase client key.
const origins = new Set(['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com']);
const validId = /^[a-f0-9]{40}$/;
const validKey = /^[a-f0-9]{32}$/;

export function addChannel(file, id) {
  if (typeof id !== 'string' || !validId.test(id)) throw new Error('Content ID inválido');
  const lock = `${file}.lock`;
  mkdirSync(lock, { mode: 0o700 });
  let temp;
  try {
    const channels = JSON.parse(readFileSync(file, 'utf8'));
    const found = Object.keys(channels).find(key => validKey.test(key) && channels[key] === id);
    if (found) return found;
    const key = randomBytes(16).toString('hex');
    channels[key] = id;
    const { uid, gid } = statSync(file);
    const path = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(path, JSON.stringify(channels, null, 2) + '\n', { mode: 0o640, flag: 'wx' });
    temp = path;
    if (process.getuid() !== uid || process.getgid() !== gid) chownSync(temp, uid, gid);
    renameSync(temp, file);
    temp = undefined;
    return key;
  } finally {
    if (temp) unlinkSync(temp);
    rmdirSync(lock);
  }
}

function tokenClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

export async function verifyAdmin(token, request = fetch) {
  const claims = tokenClaims(token);
  if (!claims || claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`
    || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 || !claims.sub
    || claims.email !== adminEmail || claims.email_verified !== true
    || claims.firebase?.sign_in_provider !== 'google.com') return false;

  const response = await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
    redirect: 'error',
    signal: AbortSignal.timeout(5500),
  });
  if (response.status >= 500 || response.status === 429) throw new Error('Firebase no disponible');
  if (!response.ok) return false;
  const user = (await response.json()).users?.[0];
  return user?.localId === claims.sub && user.email === adminEmail && user.emailVerified === true
    && !user.disabled && user.providerUserInfo?.some(provider => provider.providerId === 'google.com');
}

export function registryServer(file, authorize = verifyAdmin, metrics = startVpsMetrics()) {
  let verifiedDigest, validUntil = 0;
  async function metricsAdministrator(token) {
    const digest = createHash('sha256').update(token).digest('hex');
    if (digest === verifiedDigest && Date.now() < validUntil) return true;
    if (!await authorize(token)) return false;
    verifiedDigest = digest;
    validUntil = Math.min(Date.now() + 30000, tokenClaims(token)?.exp * 1000);
    return true;
  }
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body ? JSON.stringify(body) : undefined);
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return reply(res, 403);
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    const readsMetrics = req.url === '/ace-metrics';
    if (!readsMetrics && req.url !== '/ace-register') return reply(res, 404);
    const method = readsMetrics ? 'GET' : 'POST';
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', method + ', OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (readsMetrics) res.setHeader('Access-Control-Max-Age', '300');
      return reply(res, 204);
    }
    if (req.method !== method) return reply(res, 405);
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token || token.length > 8192) return reply(res, 401);
    let body = '';
    try {
      if (readsMetrics) {
        if (!await metricsAdministrator(token)) return reply(res, 401);
        return reply(res, 200, metrics());
      }
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) { reply(res, 413); return; }
      }
      let id;
      try { id = JSON.parse(body)?.contentId; } catch { return reply(res, 400); }
      if (typeof id !== 'string' || !validId.test(id)) return reply(res, 400);
      if (!await authorize(token)) return reply(res, 401);
      const key = addChannel(file, id);
      return reply(res, 200, { url: `https://video.calamarmenciano.com/ace-hls/${key}/index.m3u8` });
    } catch (error) {
      if (res.destroyed) return;
      console.error(readsMetrics ? 'Métricas VPS:' : 'Registro Ace Stream:', error.code || error.name);
      if (!res.headersSent) return reply(res, 503);
      res.destroy();
    }
  });
  server.maxConnections = 16;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  registryServer(join(process.env.STATE_DIRECTORY, 'channels.json')).listen(6881, '127.0.0.1');
}
