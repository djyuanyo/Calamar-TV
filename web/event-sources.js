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
        const name = viewerName(entry.name) || viewerName(source.name) || 'Fuente del evento';
        if (!found.has(u.href)) found.set(u.href, { url: u.href, name: name + (entry !== source && entry.language ? ` · ${entry.language}` : '') });
      } catch { /* Ignore incomplete sources. */ }
    }
  }
  return [...found.values()];
}

/** A source's name as viewers see it: the channel's name, never the address of the site it comes from. */
export const viewerName = (name) => typeof name === 'string' && name.trim() && !/zico|calamar|https?:|\.(?:cc|com|net|org|tv|top|xyz|sbs|me|io)\b/i.test(name) ? name.trim() : '';

export async function expandEventSources(streams, { fetcher = globalThis.fetch, signal } = {}) {
  const rows = await Promise.all(streams.map(async url => {
    const api = zicoEventApi(url);
    if (!api) return [{ url }];
    try {
      const response = await fetcher(api, { credentials: 'omit', cache: 'no-store', signal });
      if (!response.ok) throw Error(`La fuente del evento responde HTTP ${response.status}.`);
      const sources = eventPlayerSources(await response.json());
      if (!sources.length) throw Error('El evento todavía no publica fuentes disponibles.');
      return sources.map(source => ({ ...source, origin: url }));
    } catch (error) {
      return [{ url, error: signal?.aborted ? 'La consulta de fuentes se ha cancelado o ha tardado demasiado.' : error.message || 'No se pudieron consultar las fuentes del evento.' }];
    }
  }));
  const sources = new Map();
  for (const source of rows.flat()) if (!sources.has(source.url)) sources.set(source.url, source);
  return [...sources.values()];
}
