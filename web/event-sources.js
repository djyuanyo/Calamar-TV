import { PLAYER_ENDPOINT } from './catalog.js';

/** Zico event pages are not embeddable; the public CORS API exposes their player URLs. */
export function zicoEventApi(address) {
  try {
    const u = new URL(address);
    const match = /^\/(?:api\/v1\/)?events\/(\d+)\/?$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.username || u.password || !match || !(u.hostname === 'zicotv.cc' || u.hostname.endsWith('.zicotv.cc'))) return null;
    return `${u.origin}/api/v1/events/${match[1]}`;
  } catch { return null; }
}

export function eventPlayerSources(data) {
  const found = new Map();
  for (const source of data?.data?.sources || []) {
    if (!source || source.locked || source.is_premium) continue;
    const entries = [source, ...(Array.isArray(source.streams) ? source.streams : [])];
    for (const entry of entries) {
      if (!entry || entry.locked || entry.is_premium) continue;
      try {
        const u = new URL(entry.player_url || entry.url);
        if (u.protocol !== 'https:' || u.username || u.password || zicoEventApi(u.href)) continue;
        if (!found.has(u.href)) found.set(u.href, { url: u.href, name: String(entry.name || source.name || 'Fuente del evento') + (entry !== source && entry.language ? ` · ${entry.language}` : '') });
      } catch { /* Ignore incomplete sources. */ }
    }
  }
  return [...found.values()];
}

export async function expandEventSources(streams, { fetcher = globalThis.fetch, signal } = {}) {
  const rows = await Promise.all(streams.map(async url => {
    const api = zicoEventApi(url);
    if (!api) return [{ url }];
    try {
      const response = await fetcher(`${PLAYER_ENDPOINT}?event=${encodeURIComponent(url)}`, { credentials: 'omit', cache: 'no-store', signal });
      if (!response.ok) throw Error(`La consulta responde HTTP ${response.status}.`);
      const sources = eventPlayerSources(await response.json());
      if (!sources.length) throw Error('Todavía no hay señales disponibles para este evento.');
      return sources.map(source => ({ ...source, origin: url }));
    } catch (error) {
      return [{ url, error: signal?.aborted ? 'La consulta de fuentes se ha cancelado o ha tardado demasiado.' : error.message || 'No se pudieron consultar las señales del evento.' }];
    }
  }));
  const sources = new Map();
  for (const source of rows.flat()) if (!sources.has(source.url)) sources.set(source.url, source);
  return [...sources.values()];
}
