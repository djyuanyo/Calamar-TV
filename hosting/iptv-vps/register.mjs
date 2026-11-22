import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

const maxBody = 8192;
const keyPattern = /^[a-f0-9]{32}$/;
const hlsOrigin = 'https://video.calamarmenciano.com';

export async function createRegistry({ seed, stateFile, accepts, authorize, authorizeViewer }) {
  let saved = {};
  try { saved = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)
      || Object.entries(saved).some(([key, value]) => !keyPattern.test(key) || typeof value !== 'string')) {
    throw new Error('Archivo de canales registrados no válido');
  }
  const channels = Object.assign(Object.create(null), saved, seed);
  let bySource;
  try { bySource = new Map(Object.entries(channels).map(([key, source]) => [new URL(source).href, key])); }
  catch { throw new Error('El registro IPTV contiene un enlace no válido'); }
  let queue = Promise.resolve();

  function add(source) {
    const write = queue.then(async () => {
      const previous = bySource.get(source);
      if (previous) return previous;
      let key;
      do { key = randomBytes(16).toString('hex'); } while (Object.hasOwn(channels, key));
      const next = { ...saved, [key]: source };
      const temp = `${stateFile}.${key}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        await rename(temp, stateFile);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      saved = next;
      channels[key] = source;
      bySource.set(source, key);
      return key;
    });
    queue = write.catch(() => {});
    return write;
  }

  const reply = (response, code, body) => {
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(body ? JSON.stringify(body) : undefined);
  };

  async function register(req, res) {
    const lookup = req.url === '/iptv-hls/original';
    if (lookup && !authorizeViewer) return reply(res, 404);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return reply(res, 204);
    }
    if (req.method !== 'POST') return reply(res, 405);
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token || token.length > 8192 || !await (lookup ? authorizeViewer : authorize)(token)) return reply(res, 401);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBody) return reply(res, 413);
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); }
    catch { return reply(res, 400); }
    if (lookup) {
      if (typeof body?.key !== 'string' || !keyPattern.test(body.key)) return reply(res, 400);
      if (!Object.hasOwn(channels, body.key)) return reply(res, 404);
      return reply(res, 200, { url: channels[body.key] });
    }
    const source = body?.url;
    if (typeof source !== 'string' || /[\s\u0000-\u001f\u007f]/.test(source) || !accepts(source)) return reply(res, 400);
    const key = await add(new URL(source).href);
    return reply(res, 200, { url: `${hlsOrigin}/iptv-hls/${key}/index.m3u8` });
  }

  return { channels, register };
}
