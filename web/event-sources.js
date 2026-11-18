import { renewablePage, zicoHost, ZICO_PLAYER_ENDPOINT } from './zico-channel.js';

/** Zico event pages are not embeddable; the public CORS API exposes their player URLs. */
export function zicoEventApi(address) {
  try {
    const u = new URL(address);
    const match = /^\/(?:api\/v1\/)?events\/(\d+)\/?$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.username || u.password || !match || !zicoHost(u.hostname)) return null;
    return `${u.origin}/api/v1/events/${match[1]}`;
  } catch { return null; }
}

/** Event feeds can include external players and short video clips alongside live signals. */
function zicoEventSignal(address) {
  try {
    const u = new URL(address);
    if (u.protocol !== 'https:' || u.username || u.password || u.searchParams.has('token')) return null;
    return renewablePage(u.href) || /\.(m3u8|ts)$/i.test(u.pathname) ? u : null;
  } catch { return null; }
}

export function eventPlayerSources(data) {
  const found = new Map();
  for (const source of data?.data?.sources || []) {
    if (!source || source.locked || source.is_premium) continue;
    const entries = [source, ...(Array.isArray(source.streams) ? source.streams : [])];
    for (const entry of entries) {
      if (!entry || entry.locked || entry.is_premium) continue;
      const u = zicoEventSignal(entry.player_url || entry.url);
      if (u && !found.has(u.href)) found.set(u.href, { url: u.href, name: String(entry.name || source.name || 'Fuente del evento') + (entry !== source && entry.language ? ` · ${entry.language}` : '') });
    }
  }
  return [...found.values()];
}

export async function expandEventSources(streams, { fetcher = globalThis.fetch, signal } = {}) {
  const rows = await Promise.all(streams.map(async url => {
    if (!zicoEventApi(url)) return [{ url }];
    try {
      const timeout = AbortSignal.timeout(35000);
      const response = await fetcher(ZICO_PLAYER_ENDPOINT + '?event=' + encodeURIComponent(url), {
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw Error(`El VPS responde HTTP ${response.status} al consultar las fuentes.`);
      const payload = await response.json();
      if (!Array.isArray(payload?.data?.sources)) throw Error('No se pudieron consultar las fuentes de este evento.');
      const sources = eventPlayerSources(payload).filter(source => renewablePage(source.url) || !zicoHost(new URL(source.url).hostname));
      return sources.length ? sources.map(source => ({ ...source, origin: url })) : [{ url, unavailable: true }];
    } catch (error) {
      return [{ url, error: signal?.aborted ? 'La consulta de fuentes se ha cancelado o ha tardado demasiado.' : error.message || 'No se pudieron consultar las fuentes de Zico TV.' }];
    }
  }));
  const sources = new Map();
  for (const source of rows.flat()) if (!sources.has(source.url)) sources.set(source.url, source);
  return [...sources.values()];
}
