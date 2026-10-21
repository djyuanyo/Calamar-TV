import { httpTsSource } from './http-stream.js';
// Same rules as app/src/main/java/es/yuanyo/calamartv/Catalog.java so web and app match.
export const OWN_GROUP = 'Calamar TV';
export const GROUP_ORDER = [OWN_GROUP, 'Generalistas', 'Deportes', 'Informativos', 'Infantiles', 'Música', 'Autonómicos'];

function validUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

const https = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : '');

/** Readable, URL-safe form of a name: "Canal Sur Andalucía" -> "canal-sur-andalucia". */
export function slugify(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'canal';
}

function channel(o, own) {
  const streams = [];
  for (const s of Array.isArray(o.streams) ? o.streams : []) {
    const url = validUrl(s);
    if (url && !streams.includes(url)) streams.push(url);
  }
  const group = String(o.group || '').trim() || (own ? OWN_GROUP : 'Otros');
  return {
    id: String(o.id || ''),
    slug: '',
    name: String(o.name || 'Canal'),
    group,
    region: String(o.region || ''),
    logo: https(o.logo),
    web: https(o.web),
    streams,
    geo: !!o.geo,
    own,
    get playable() {
      return this.streams.length > 0;
    },
  };
}

export function merge(tdt, custom) {
  const hidden = new Set((custom && custom.hidden) || []);
  const out = [];
  const ids = new Set();
  for (const o of (custom && custom.channels) || []) {
    if (!o || o.hidden) continue;
    const c = channel(o, true);
    if (c.id && c.playable && !ids.has(c.id)) {
      ids.add(c.id);
      out.push(c);
    }
  }
  for (const o of (tdt && tdt.channels) || []) {
    if (!o) continue;
    const c = channel(o, false);
    if (!c.id || hidden.has(c.id) || ids.has(c.id)) continue;
    ids.add(c.id);
    if (c.playable || c.web) out.push(c);
  }
  // The link of every channel comes from its name; repeated names get -2, -3…
  const used = new Set();
  for (const c of out) {
    const base = slugify(c.name);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    c.slug = slug;
  }
  return out;
}

/** Finds a channel by the slug of its link; old links that used the internal id still work. */
export function findChannel(channels, key) {
  return channels.find((c) => c.slug === key) || channels.find((c) => c.id === key) || null;
}

export function featured(channels, custom, limit) {
  const out = [];
  for (const id of (custom && custom.featured) || []) {
    if (out.length >= limit) break;
    const c = channels.find((x) => x.id === id && x.playable);
    if (c && !out.includes(c)) out.push(c);
  }
  for (const c of channels) {
    if (out.length >= limit) break;
    if (c.playable && !out.includes(c)) out.push(c);
  }
  return out;
}

export function groups(channels) {
  const map = new Map(GROUP_ORDER.map((g) => [g, []]));
  const extra = new Map();
  for (const c of channels) (map.get(c.group) || extra.get(c.group) || extra.set(c.group, []).get(c.group)).push(c);
  for (const g of [...extra.keys()].sort()) map.set(g, extra.get(g));
  for (const [g, list] of map) {
    if (!list.length) map.delete(g);
    else list.sort((a, b) => Number(b.playable) - Number(a.playable));
  }
  return map;
}

/**
 * When a signed link stops working, in ms since the epoch, or null when the link says nothing.
 * Reads ?e= or ?expires= and a 10-digit time inside ?token= (the same hints as VideoResolver.java).
 */
export function streamExpiry(url) {
  let params;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const epoch = (text) => {
    const seconds = Number(text);
    return Number.isInteger(seconds) && seconds >= 1e9 && seconds < 1e10 ? seconds * 1000 : null;
  };
  for (const key of ['e', 'expires']) {
    const value = params.get(key);
    if (value !== null && epoch(value) !== null) return epoch(value);
  }
  const token = params.get('token');
  const match = token && /(?:^|-)(\d{10})(?:-|$)/.exec(token);
  return match ? epoch(match[1]) : null;
}

/** A plain-language reason for a fatal hls.js error. `code` is the HTTP status, 0 or missing when the request never got an answer. */
export function explainStreamError({ details = '', code = 0, expiry = null, now = Date.now() } = {}) {
  if (code === 401 || code === 403) {
    if (expiry && expiry > now) return `El servidor rechaza la solicitud (HTTP ${code}), aunque el token todavía no ha caducado.`;
    if (expiry && expiry <= now) return `El enlace ha caducado y el servidor rechaza la solicitud (HTTP ${code}).`;
    return 'El servidor rechaza este enlace: no está autorizado o ya caducó.';
  }
  if (code === 404 || code === 410) return 'El enlace ya no existe en el servidor.';
  if (code >= 500) return 'El servidor del canal o el puente HTTPS ha devuelto un error. Pulsa Refrescar para volver a conectar.';
  if (/mediaNetwork/i.test(details)) return 'La conexión del vídeo se ha interrumpido después de conectar.';
  if (/load/i.test(details)) return 'El servidor del canal no permite cargarlo desde otra web (CORS), no responde o está bloqueado en tu red.';
  if (/parsing/i.test(details)) return 'La emisión no tiene un formato que el navegador entienda.';
  if (/codec|buffer|decode/i.test(details)) return 'El navegador no admite el vídeo de esta emisión.';
  return 'No se pudo reproducir esta emisión en el navegador.';
}

/** Only non-secret fields are returned; response text and URL queries may contain tokens. */
export function streamFailureReport({ details = '', code = 0, url = '', expiry = null, mediaCode = 0 } = {}) {
  const stage = /^manifest/i.test(details) ? 'Lista principal'
    : /^level|^audioTrack|^subtitleTrack/i.test(details) ? 'Lista de vídeo o audio'
    : /^frag/i.test(details) ? 'Fragmento de vídeo'
    : /^key/i.test(details) ? 'Clave de la emisión' : 'Reproducción';
  let host = '';
  try { host = new URL(url).hostname; } catch { /* No URL is safer than a raw invalid address. */ }
  return { stage, mediaCode: [1, 2, 3, 4].includes(mediaCode) ? mediaCode : null, code: Number.isInteger(code) && code > 0 ? code : null, host,
    expiresAt: Number.isFinite(expiry) && expiry > 0 ? new Date(expiry).toISOString() : null };
}

/** How the browser can play a URL: 'hls', 'video', or a reason it needs the app. */
export function webPlayback(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'Enlace no válido' };
  }
  const path = u.pathname.toLowerCase();
  if (httpTsSource(url)) return { ok: true, kind: 'ts', relay: true };
  if (u.protocol === 'http:') return { ok: false, reason: 'Este enlace HTTP no es un flujo TS/IPTV compatible con el puente' };
  if (u.protocol !== 'https:') return { ok: false, reason: 'Este enlace usa http:// y el navegador lo bloquea en una web segura' };
  if (path.endsWith('.m3u8')) return { ok: true, kind: 'hls' };
  if (/\.(mp4|webm)$/.test(path)) return { ok: true, kind: 'video' };
  if (path.endsWith('.ts')) return { ok: true, kind: 'ts', relay: false };
  if (/\.(mpd|m3u)$/.test(path)) return { ok: false, reason: 'Formato no compatible con el navegador' };
  return { ok: false, reason: 'Es la página de un reproductor; se resuelve en la app' };
}

/** Events always resolve their channel's current sources, never a saved copy of its links. */
export function events(channels, custom) {
  return ((custom && custom.events) || []).flatMap((event) => {
    const target = channels.find((c) => c.id === event.channelId && c.playable);
    return target ? [{ ...target, name: event.name, cover: event.cover, event: true, eventId: event.id }] : [];
  });
}
