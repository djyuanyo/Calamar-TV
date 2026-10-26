import { matchExpired } from './match-scores.js';
import { eventOrder, eventMeta } from './sports.js';
import { fixtureEvent, weekFixtures } from './competitions.js';
import { httpTsSource } from './http-stream.js';
// Containers whose sound (often AC3/DTS) browsers cannot play: only the app plays them.
const VIDEO_FILE = /\.(mkv|avi|mov|wmv|flv|m4v|mpg|mpeg|m2ts|vob)$/i;
// Same rules as app/src/main/java/es/yuanyo/calamartv/Catalog.java so web and app match.
export const OWN_GROUP = 'Calamar TV';
export const GROUP_ORDER = [OWN_GROUP, 'Generalistas', 'Deportes', 'Informativos', 'Infantiles', 'Música', 'Autonómicos'];
/** Card background of each category until the administrator picks another one. */
export const CATEGORY_COLORS = { [OWN_GROUP]: '#5a6b12', Generalistas: '#1f4f8f', Deportes: '#1d7a40', Informativos: '#8f2c2c', Infantiles: '#b35c14', 'Música': '#6a2f8f', 'Autonómicos': '#1c7373' };
const EXTRA_COLORS = ['#7a5418', '#2d5a8a', '#8a2d63', '#4a6b2a', '#5c3d8a', '#8a4a2d', '#2d7a6b', '#6b6b2d'];
export function defaultColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return EXTRA_COLORS[h % EXTRA_COLORS.length];
}

/**
 * Categories in the administrator's order: `categories` ([{ id, name, color }]) when saved, otherwise
 * the older `groupOrder` and the defaults. `id` is the category a channel stores; `name` is shown.
 */
export function categoryList(custom) {
  if (Array.isArray(custom?.categories)) return custom.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }));
  const order = Array.isArray(custom?.groupOrder) ? custom.groupOrder : [];
  return [...new Set([...order, ...GROUP_ORDER])].map((g) => ({ id: g, name: g, color: defaultColor(g) }));
}

/** The category of a stored group: by id, else by shown name, else a new one with its default colour. */
export function resolveCategory(group, list) {
  return list.find((c) => c.id === group) || list.find((c) => c.name === group) || { id: group, name: group, color: defaultColor(group) };
}

function validUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

const https = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : '');

/**
 * Copies of logos on this web (tools/logo_mirror.py, data/logos.json): some logo sites are blocked by
 * Spanish operators or refuse other webs, so the copy is shown when there is one.
 */
let logoCopies = {};
export function setLogoCopies(map) { logoCopies = map && typeof map === 'object' ? map : {}; }
export const mirrorLogo = (url) => (typeof logoCopies[url] === 'string' && /^logos\/[0-9a-f]{24}\.png$/.test(logoCopies[url]) ? logoCopies[url] : url);

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
    logo: mirrorLogo(https(o.logo)),
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
  // Shown category name and card colour follow the administrator's categories.
  const categories = categoryList(custom);
  for (const c of out) {
    const category = resolveCategory(c.group, categories);
    c.category = c.group;
    c.group = category.name;
    c.color = category.color;
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

/**
 * Categories in display order: the order saved by the administrator (catalog `groupOrder`), then the
 * default categories, then any other category alphabetically.
 */
export function groups(channels, order = []) {
  const map = new Map([...(Array.isArray(order) ? order : []), ...GROUP_ORDER].map((g) => [g, []]));
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
  if (code >= 500) return 'El servidor del canal o el puente HTTPS ha devuelto un error. Pulsa Reintentar para volver a conectar.';
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
// LuluStream links (the video page, /d/ or /e/) play in LuluStream's own player, embedded in ours.
// LuluStream serves the same videos under several names (lulustream.com, luluvdo.com, luluvido.com, lulu.st…).
const LULU_HOST = /^(?:www\.)?(?:lulustream|luluvdoo?|luluvido|luluvid|lulu)\.(?:com|st|to|net|org|io|live|pw)$/;
export function lulustreamEmbed(url) {
  try {
    const u = new URL(String(url).trim());
    const code = u.pathname.match(/^\/(?:e\/|d\/|v\/)?([A-Za-z0-9]{8,20})(?:\.html)?\/?$/)?.[1];
    return u.protocol === 'https:' && LULU_HOST.test(u.hostname) && code && code !== 'api' ? `https://lulustream.com/e/${code}` : null;
  } catch { return null; }
}

export const LULU_ENDPOINT = 'https://calamarmenciano.com/calamar-lulu.php';

/**
 * Player pages (a web with the video inside): the app reads them itself; browsers cannot reach their
 * video (CORS), so the hosting reads the page and relays its HLS list (calamar-player.php).
 */
export const PLAYER_ENDPOINT = 'https://calamarmenciano.com/calamar-player.php';
export const playerPageRelay = (url) => `${PLAYER_ENDPOINT}?page=${encodeURIComponent(String(url).trim())}&hls=1`;

/**
 * Player pages shown as they are, inside the player (their own player, straight from their servers):
 * zicotv allows other webs to show its pages and refuses the hosting, so its video never passes through it.
 */
const FRAME_HOSTS = ['zicotv.cc'];
export function framedPage(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && FRAME_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

/** `pages`: player pages play through the hosting (channels) or in a frame; otherwise they need the app. */
export function webPlayback(url, { pages = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'Enlace no válido' };
  }
  const path = u.pathname.toLowerCase();
  const embed = lulustreamEmbed(url);
  // LuluStream only serves the video to whoever opened its player page, so the hosting reads the page and
  // passes the HLS list and its pieces on (calamar-lulu.php); the video plays in our own player.
  if (embed) return { ok: true, kind: 'hls', address: `${LULU_ENDPOINT}?code=${embed.split('/').pop()}&hls=1` };
  // Films and series from Google Drive play straight from the Drive API (it allows browser video).
  if (u.protocol === 'https:' && u.hostname === 'www.googleapis.com' && /^\/drive\/v3\/files\/[A-Za-z0-9_-]+$/.test(u.pathname) && u.searchParams.get('alt') === 'media') return { ok: true, kind: 'video' };
  if (VIDEO_FILE.test(path)) return { ok: false, reason: 'Los vídeos MKV, AVI y similares se ven en la app Calamar TV; en el navegador usa MP4' };
  if (httpTsSource(url)) return { ok: true, kind: 'ts', relay: true };
  if (u.protocol === 'http:') return { ok: false, reason: 'Este enlace HTTP no es un flujo TS/IPTV compatible con el puente' };
  if (u.protocol !== 'https:') return { ok: false, reason: 'Este enlace usa http:// y el navegador lo bloquea en una web segura' };
  if (path.endsWith('.m3u8')) return { ok: true, kind: 'hls' };
  if (/\.(mp4|webm)$/.test(path)) return { ok: true, kind: 'video' };
  if (path.endsWith('.ts')) return { ok: true, kind: 'ts', relay: false };
  if (/\.(mpd|m3u)$/.test(path)) return { ok: false, reason: 'Formato no compatible con el navegador' };
  if (pages && framedPage(url)) return { ok: true, kind: 'frame', page: true };
  if (pages) return { ok: true, kind: 'hls', address: playerPageRelay(url), page: true };
  return { ok: false, reason: 'Es la página de un reproductor; se resuelve en la app' };
}

/** Events and imported matches (as events), as the catalog keeps them. */
export function catalogEvents(custom) {
  return [...(custom?.events || []), ...(custom?.fixtures || []).map((f) => fixtureEvent(f, custom))];
}

/**
 * Link name of every event, from its name like channels ("local-vs-visitante"); repeated names get
 * -2, -3… in date order. tools/event_pages.py and SportsCatalog.slugs() apply the same rule. Imported
 * matches come after the events, so they never change an event's link.
 */
export function eventSlugs(custom) {
  const out = new Map(), used = new Set();
  const all = catalogEvents(custom);
  for (const event of [...all.filter((e) => !e.imported).sort(eventOrder), ...all.filter((e) => e.imported).sort(eventOrder)]) {
    const base = slugify(event.name);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    out.set(event.id, slug);
  }
  return out;
}

/** Card art of an event without a cover: the league's background with both crests on top. */
export function eventArt(event, custom) {
  const find = (list, id) => (custom?.[list] || []).find((x) => x.id === id);
  const image = (v) => (typeof v === 'string' && (v.startsWith('https://') || v.startsWith('data:image/')) ? v : '');
  const league = find('leagues', event.leagueId);
  const logo = (v) => mirrorLogo(image(v));
  return { background: image(league?.background), leagueLogo: logo(league?.logo), homeLogo: logo(find('teams', event.homeTeamId)?.logo), awayLogo: logo(find('teams', event.awayTeamId)?.logo) };
}

/**
 * Each event has a stable identity and resolves the current channel sources. Imported matches show
 * only the week of their league's next match; until they have a channel they say «Canal por confirmar».
 * A finished match leaves the home page and the lists but stays in the catalog: with `finished` (its
 * own link) it is still found, with its channel or, without one, with the match alone.
 */
export const FINISHED = 'Partido finalizado';
export function events(channels, custom, now = Date.now(), { allWeeks = false, finished = false } = {}) {
  const slugs = eventSlugs(custom);
  const ended = (event) => !!event.matchUrl && matchExpired(event.matchId, now);
  const all = catalogEvents(custom).filter(event => finished || !ended(event));
  const imported = new Set(weekFixtures(all.filter((e) => e.imported), now));
  return all.filter((e) => !e.imported || allWeeks || imported.has(e)).sort(eventOrder).flatMap((event) => {
    const target = channels.find((c) => c.id === event.channelId && c.playable);
    const shared = { ...event, id: event.id, eventId: event.id, slug: slugs.get(event.id), event: true, ...eventArt(event, custom) };
    if (target) return [{ ...target, ...shared, channelId: target.id, channelName: target.name, meta: eventMeta(event, custom),
      streams: target.streams, playable: target.playable }];
    if (ended(event)) return [{ ...shared, logo: '', group: '', region: '', web: '', own: true, streams: [], playable: false, pending: true,
      channelName: FINISHED, meta: [eventMeta(event, custom), FINISHED].filter(Boolean).join(' · ') }];
    return event.imported ? [{ ...shared, logo: '', group: '', region: '', web: '', own: true, streams: [], playable: false, pending: true,
      channelName: PENDING, meta: [eventMeta(event, custom), PENDING].filter(Boolean).join(' · ') }] : [];
  });
}
export const PENDING = 'Canal por confirmar';
/** Home rows: one per league (with its logo), ordered by its next event; events without league last. */
export function eventRows(list, custom) {
  const leagues = new Map((custom?.leagues || []).map((l) => [l.id, l]));
  const rows = new Map();
  for (const event of list) {
    const league = leagues.get(event.leagueId);
    const key = league ? league.id : '';
    if (!rows.has(key)) rows.set(key, { id: key, name: league ? league.name : 'Otros eventos', logo: mirrorLogo(https(league?.logo)) || (league?.logo?.startsWith('data:image/') ? league.logo : ''), events: [] });
    rows.get(key).events.push(event);
  }
  const out = [...rows.values()];
  return [...out.filter((r) => r.id), ...out.filter((r) => !r.id)];
}
export function homeHighlights(channels, custom) {
  const matches = events(channels, custom).filter(e => e.featured);
  const picked = (custom?.featured || []).flatMap(id => channels.filter(c => c.id === id && c.playable));
  return matches.length || picked.length ? [...matches, ...picked] : featured(channels, custom, 1);
}
