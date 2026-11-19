import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engine = new URL('http://127.0.0.1:6878');
const packetSize = 188;
const syncWindow = 3 * packetSize;
const origins = new Set([
  'https://djyuanyo.github.io',
  'https://calamarmenciano.com',
  'https://www.calamarmenciano.com',
]);

// New viewers start at a TS packet boundary. The input is checked before sending a 200.
function packetReader() {
  let pending = Buffer.alloc(0);
  let synced = false;
  let inspected = 0;
  return chunk => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    if (!synced) {
      const offset = pending.findIndex((value, i) => value === 0x47
        && pending[i + packetSize] === 0x47 && pending[i + packetSize * 2] === 0x47);
      if (offset === -1) {
        inspected += Math.max(0, pending.length - syncWindow);
        if (inspected > 65536) throw new Error('El origen no entregó MPEG-TS');
        pending = pending.subarray(-syncWindow);
        return null;
      }
      pending = pending.subarray(offset);
      synced = true;
    }
    const length = pending.length - pending.length % packetSize;
    const packets = pending.subarray(0, length);
    pending = pending.subarray(length);
    return packets.length ? packets : null;
  };
}

async function openEngine(id, signal) {
  const url = new URL('/ace/getstream', engine);
  url.searchParams.set('content_id', id);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await new Promise((accept, reject) => {
      const request = http.get(url, { signal, agent: false }, accept);
      request.on('error', reject);
      request.setTimeout(20000, () => request.destroy(new Error('Tiempo de espera del motor')));
    });
    if (response.statusCode === 200) return response;
    response.destroy();
    if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location) {
      throw new Error('El motor de Ace Stream rechazó la señal');
    }
    const next = new URL(response.headers.location, url);
    if (next.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(next.hostname)
        || next.port !== engine.port || next.username || next.password) {
      throw new Error('Redirección fuera del motor local');
    }
    url.pathname = next.pathname;
    url.search = next.search;
  }
  throw new Error('Demasiadas redirecciones del motor');
}

export function createRelay({
  loadChannels, openSource = openEngine, idleMs = 15000, startupMs = 35000,
  retryMs = 2000, maxViewers = 20, maxQueue = 512 * 1024,
}) {
  const sessions = new Map();
  let viewers = 0;
  let closing = false;

  function stop(session) {
    clearTimeout(session.idle);
    clearTimeout(session.retry);
    session.abort.abort();
    sessions.delete(session.id);
  }

  async function pump(session) {
    try {
      const source = await openSource(session.id, session.abort.signal);
      const readPackets = packetReader();
      for await (const chunk of source) {
        const packets = readPackets(chunk);
        if (!packets) continue;
        for (const viewer of session.viewers) {
          if (viewer.destroyed) continue;
          if (viewer.writableLength + packets.length > maxQueue) {
            viewer.destroy();
            continue;
          }
          if (!viewer.headersSent) {
            viewer.writeHead(200, { 'Content-Type': 'video/mp2t', 'Accept-Ranges': 'none' });
          }
          viewer.write(packets);
        }
      }
    } catch {
      // Each input failure has the same recovery path, independent of viewer connections.
    }
    if (!session.abort.signal.aborted) {
      session.retry = setTimeout(() => void pump(session), retryMs);
    }
  }

  function attach(response, id, internal) {
    let session = sessions.get(id);
    if (!internal && viewers >= maxViewers) {
      response.writeHead(503, { 'Retry-After': '5' }).end('Capacidad de directos alcanzada');
      return;
    }
    const first = !session;
    if (first) {
      session = { id, viewers: new Set(), abort: new AbortController(), idle: null, retry: null };
      sessions.set(id, session);
    }
    clearTimeout(session.idle);
    session.viewers.add(response);
    if (!internal) viewers++;
    const timeout = setTimeout(() => {
      if (!response.headersSent) response.writeHead(503, { 'Retry-After': '5' }).end('Señal aún no disponible');
    }, startupMs);
    response.once('close', () => {
      clearTimeout(timeout);
      if (!session.viewers.delete(response)) return;
      if (!internal) viewers--;
      if (!session.viewers.size && !session.abort.signal.aborted) {
        session.idle = setTimeout(() => stop(session), idleMs);
      }
    });
    if (first) void pump(session);
  }

  async function request(req, res, internal) {
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return res.writeHead(403).end();
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    const match = /^\/ace-live\/([a-f0-9]{32})\.ts$/.exec(req.url);
    if (!match) return res.writeHead(404).end();
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      return res.writeHead(204).end();
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      return res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }).end();
    }
    const channels = await loadChannels();
    if (res.destroyed) return;
    if (closing) return res.writeHead(503).end();
    const id = channels[match[1]];
    if (typeof id !== 'string' || !/^[a-f0-9]{40}$/.test(id)) return res.writeHead(404).end();
    if (req.method === 'HEAD') return res.writeHead(200, { 'Content-Type': 'video/mp2t' }).end();
    attach(res, id, internal);
  }

  const createServer = internal => http.createServer({ headersTimeout: 10000, requestTimeout: 15000 }, (req, res) => {
    void request(req, res, internal).catch(() => {
      if (!res.headersSent) res.writeHead(503).end('Configuración del servicio no disponible');
      else res.destroy();
    });
  });
  const server = createServer(false);
  const internalServer = createServer(true);
  server.maxConnections = maxViewers + 32;
  return {
    server, internalServer,
    shutdown() {
      closing = true;
      for (const session of sessions.values()) {
        stop(session);
        for (const viewer of session.viewers) viewer.destroy();
      }
      for (const listener of [server, internalServer]) {
        listener.close();
        listener.closeAllConnections?.();
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const readLimit = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1) throw new Error(`Valor no válido para ${name}`);
    return Number(raw);
  };
  const relay = createRelay({
    maxViewers: readLimit('CALAMAR_ACE_VIEWERS', 20),
    idleMs: readLimit('CALAMAR_ACE_IDLE_SECONDS', 15) * 1000,
    loadChannels: async () => JSON.parse(await readFile('/etc/calamar-acestream/channels.json', 'utf8')),
  });
  relay.server.listen(6879, '127.0.0.1');
  relay.internalServer.listen(6882, '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => relay.shutdown());
}
