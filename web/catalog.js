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

/** How the browser can play a URL: 'hls', 'video', or a reason it needs the app. */
export function webPlayback(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'Enlace no válido' };
  }
  const path = u.pathname.toLowerCase();
  if (u.protocol !== 'https:') return { ok: false, reason: 'Este enlace usa http:// y el navegador lo bloquea en una web segura' };
  if (path.endsWith('.m3u8')) return { ok: true, kind: 'hls' };
  if (/\.(mp4|webm)$/.test(path)) return { ok: true, kind: 'video' };
  if (path.endsWith('.ts')) return { ok: false, reason: 'Los navegadores no reproducen .ts' };
  if (/\.(mpd|m3u)$/.test(path)) return { ok: false, reason: 'Formato no compatible con el navegador' };
  return { ok: false, reason: 'Es la página de un reproductor; se resuelve en la app' };
}
