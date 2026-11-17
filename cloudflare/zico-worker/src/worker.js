const LIMIT = 1024 * 1024;
const TTL = 600;
const encoder = new TextEncoder();

class Failure extends Error {
  constructor(stage, status, detail) { super(detail); this.stage = stage; this.status = status; }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const hosts = env => new Set(String(env.MEDIA_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
function target(address, allowed) {
  let u;
  try { u = new URL(address); } catch { throw new Failure('url', 400, 'URL inválida'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !allowed.has(u.hostname)
      || !/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.')
      || /^[\d.]+$/.test(u.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname))
    throw new Failure('host', 400, `Destino no permitido: ${u.hostname}`);
  u.hash = '';
  return u;
}
function pageURL(address) {
  const u = target(address, new Set(['zicotv.cc', 'bp.zicotv.cc']));
  if (!/^\/(?:api\/player|events|api\/v1\/events)\/\d+\/?$/.test(u.pathname) || u.search)
    throw new Failure('page', 400, 'Usa un enlace público /api/player/ID o /events/ID');
  return u;
}
async function upstream(address, page, env, fetcher, range) {
  let u = target(address, hosts(env));
  for (let hop = 0; hop < 4; hop++) {
    const headers = { Accept: '*/*', 'User-Agent': 'CalamarTV-Worker/1.0' };
    if (page) { headers.Referer = page; headers.Origin = new URL(page).origin; }
    if (range) headers.Range = range;
    let response;
    try { response = await fetcher(u.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(12000), cache: 'no-store' }); }
    catch { throw new Failure('connection', 502, `No se pudo conectar con ${u.hostname}`); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (!response.headers.get('Location')) throw new Failure('redirect', 502, 'Redirección sin destino');
      u = target(new URL(response.headers.get('Location'), u).href, hosts(env));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Failure('upstream', response.status, `${u.hostname} responde HTTP ${response.status}`);
    }
    return { response, url: u.href };
  }
  throw new Failure('redirect', 502, 'Demasiadas redirecciones');
}
async function readText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.length;
      if (size > LIMIT) throw new Failure('body', 502, 'Respuesta demasiado grande');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel(); }
}
// Parse only the public JSON list. Never execute provider JavaScript or select locked sources.
export function publicSources(html, base) {
  const start = /\b(?:var|let|const)\s+ZT_SOURCES\s*=\s*\[/.exec(html);
  if (!start) return [];
  const offset = start.index + start[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let i = offset; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      let list;
      try { list = JSON.parse(html.slice(offset, i + 1)); } catch { return []; }
      return [...new Set(list.filter(s => s && !s.locked && !s.is_premium && typeof s.url === 'string').flatMap(s => {
        try { const u = new URL(s.url, base); return /\.m3u8$/i.test(u.pathname) ? [u.href] : []; } catch { return []; }
      }))].slice(0, 16);
    }
  }
  return [];
}
function references(list, base) {
  const result = [];
  for (const line of list.split(/\r?\n/)) {
    const value = line.trim();
    if (value && !value.startsWith('#')) result.push(new URL(value, base).href);
  }
  return result;
}
async function signature(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function mediaURL(address, page, env, origin, expires = Math.floor(Date.now() / 1000) + TTL) {
  target(address, hosts(env));
  const u = new URL('/media', origin);
  const payload = JSON.stringify([address, page, expires]);
  u.searchParams.set('data', payload);
  u.searchParams.set('sig', await signature(payload, env.RELAY_SECRET));
  return u.href;
}
export async function rewrite(list, base, page, env, origin) {
  const lines = [];
  for (const line of list.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) lines.push(await mediaURL(new URL(trimmed, base).href, page, env, origin));
    else {
      let result = '', last = 0;
      for (const match of line.matchAll(/URI="([^"]+)"/g)) {
        result += line.slice(last, match.index) + 'URI="' + await mediaURL(new URL(match[1], base).href, page, env, origin) + '"';
        last = match.index + match[0].length;
      }
      lines.push(result + line.slice(last));
    }
  }
  return lines.join('\n');
}
async function resolve(address, env, fetcher, origin) {
  const page = pageURL(address);
  if (page.pathname.includes('/events/')) {
    page.pathname = page.pathname.replace(/^\/events\//, '/api/v1/events/');
    const { response } = await upstream(page.href, '', env, fetcher);
    const data = JSON.parse(await readText(response));
    const players = (data?.data?.sources || []).filter(s => !s.locked && !s.is_premium)
      .map(s => s.player_url || s.url).filter(Boolean).slice(0, 16);
    return { kind: 'event', players: players.map(p => pageURL(p).href) };
  }
  const { response, url } = await upstream(page.href, page.href, env, fetcher);
  const sources = publicSources(await readText(response), url);
  if (!sources.length) throw new Failure('extract', 422, 'La página no publica ningún M3U8 disponible en ZT_SOURCES');
  return { kind: 'player', sources: await Promise.all(sources.map(async source => ({
    host: new URL(source).hostname,
    url: await mediaURL(source, page.href, env, origin)
  }))) };
}
async function diagnose(address, env, fetcher, origin) {
  const report = { checks: [] };
  let stage = 'page';
  try {
    let result = await resolve(address, env, fetcher, origin);
    report.checks.push({ stage, ok: true, kind: result.kind });
    if (result.kind === 'event') {
      if (!result.players.length) throw new Failure('event', 422, 'El evento no tiene fuentes públicas');
      stage = 'player';
      result = await resolve(result.players[0], env, fetcher, origin);
      report.checks.push({ stage, ok: true });
    }
    const [source, page] = JSON.parse(new URL(result.sources[0].url).searchParams.get('data'));
    let next = source;
    for (let depth = 0; depth < 4; depth++) {
      stage = 'playlist';
      const { response, url } = await upstream(next, page, env, fetcher);
      const list = await readText(response);
      if (!list.trimStart().startsWith('#EXTM3U')) throw new Failure(stage, 422, 'La respuesta no es una lista HLS');
      const refs = references(list, url);
      await rewrite(list, url, page, env, origin); // Validate keys, maps, variants and segments too.
      report.checks.push({ stage, ok: true, host: new URL(url).hostname });
      if (!refs.length) throw new Failure(stage, 422, 'Lista HLS vacía');
      if (/#EXT-X-STREAM-INF:/.test(list)) { next = refs[0]; continue; }
      stage = 'segment';
      const segment = await upstream(refs[0], page, env, fetcher, 'bytes=0-4095');
      const reader = segment.response.body?.getReader();
      let size = 0;
      try { const chunk = await reader?.read(); size = chunk?.value?.length || 0; }
      finally { await reader?.cancel(); }
      if (!size || /text\/html|application\/json/i.test(segment.response.headers.get('Content-Type') || ''))
        throw new Failure(stage, 422, 'El fragmento está vacío o devuelve HTML/JSON');
      report.checks.push({ stage, ok: true, status: segment.response.status, bytes: size });
      return { ...report, ok: true, note: 'Lectura de lista y fragmento confirmada; falta reproducción real en Android.' };
    }
    throw new Failure(stage, 422, 'Demasiadas listas anidadas');
  } catch (error) {
    report.checks.push({ stage, ok: false, reason: error.stage || 'internal', status: error.status || 502, detail: error instanceof Failure ? error.message : 'Respuesta no válida del proveedor' });
    return { ...report, ok: false };
  }
}
const UI = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Calamar · Prueba Cloudflare</title>
<style>body{font:17px system-ui;background:#101827;color:#eee;max-width:760px;margin:50px auto;padding:20px}input,button{box-sizing:border-box;width:100%;padding:14px;margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{cursor:pointer}</style>
<h1>Calamar · Prueba de Zico</h1><p>Comprueba la página, la lista HLS y el primer fragmento desde Cloudflare. No reproduce ni descarga el vídeo completo.</p>
<form><label>Clave de diagnóstico<input id="token" type="password" required autocomplete="off"></label><label>Enlace de Zico<input id="page" type="url" value="https://zicotv.cc/api/player/4" required></label><button>Comprobar</button></form><pre id="result" role="status"></pre>
<script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('button');b.disabled=true;const out=document.querySelector('#result');out.textContent='Comprobando…';try{const r=await fetch('/diagnose?page='+encodeURIComponent(document.querySelector('#page').value),{headers:{Authorization:'Bearer '+document.querySelector('#token').value}});out.textContent=JSON.stringify(await r.json(),null,2)}catch{out.textContent='No se pudo consultar el Worker'}finally{b.disabled=false}};</script></html>`;

export function createWorker(fetcher = globalThis.fetch) {
  return { async fetch(request, env) {
    const u = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'Método no permitido' }, 405);
    if (u.pathname === '/') return new Response(UI, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'" } });
    if (u.pathname === '/health') return json({ service: 'calamar-zico', configured: !!(env.ADMIN_TOKEN?.length >= 32 && env.RELAY_SECRET?.length >= 32) });
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || !env.RELAY_SECRET || env.RELAY_SECRET.length < 32)
      return json({ error: 'Configura ADMIN_TOKEN y RELAY_SECRET (mínimo 32 caracteres cada uno)' }, 503);
    try {
      if (u.pathname === '/media') {
        const data = u.searchParams.get('data') || '';
        if (data.length > 8192 || u.searchParams.get('sig') !== await signature(data, env.RELAY_SECRET)) return json({ error: 'Firma no válida' }, 403);
        const [address, page, expires] = JSON.parse(data);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isInteger(expires) || expires < now || expires > now + TTL) return json({ error: 'Enlace caducado' }, 403);
        pageURL(page);
        const range = request.headers.get('Range');
        if (range && !/^bytes=\d+-\d*$/.test(range)) return json({ error: 'Range no válido' }, 400);
        const { response, url } = await upstream(address, page, env, fetcher, range);
        const type = response.headers.get('Content-Type') || '';
        if (/\.m3u8$/i.test(new URL(url).pathname) || /mpegurl/i.test(type)) {
          const list = await readText(response);
          if (!list.trimStart().startsWith('#EXTM3U')) throw new Failure('playlist', 422, 'Respuesta HLS no válida');
          return new Response(await rewrite(list, url, page, env, u.origin), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
        }
        if (/text\/html|application\/json/i.test(type)) { await response.body?.cancel(); throw new Failure('segment', 422, 'El proveedor devuelve HTML/JSON'); }
        const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': type || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
        for (const h of ['Content-Length', 'Content-Range', 'Accept-Ranges']) if (response.headers.has(h)) headers.set(h, response.headers.get(h));
        return new Response(response.body, { status: response.status, headers });
      }
      if (u.pathname !== '/resolve' && u.pathname !== '/diagnose') return json({ error: 'Ruta no encontrada' }, 404);
      if (request.headers.get('Authorization') !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'Clave de diagnóstico no válida' }, 401);
      const page = pageURL(u.searchParams.get('page')).href;
      if (u.pathname === '/diagnose') return json(await diagnose(page, env, fetcher, u.origin));
      return json(await resolve(page, env, fetcher, u.origin));
    } catch (error) {
      return json({ error: error instanceof Failure ? error.message : 'Respuesta no válida', stage: error.stage || 'internal', upstreamStatus: error.status || null }, error instanceof Failure && error.status < 500 ? error.status : 502);
    }
  }};
}
export default createWorker();
