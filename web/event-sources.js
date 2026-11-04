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
        if (u.protocol !== 'https:' || u.username || u.password || u.searchParams.has('token') || zicoEventApi(u.href)) continue;
        if (!found.has(u.href)) found.set(u.href, { url: u.href, name: String(entry.name || source.name || 'Fuente del evento') + (entry !== source && entry.language ? ` · ${entry.language}` : '') });
      } catch { /* Ignore incomplete sources. */ }
    }
  }
  return [...found.values()];
}

const HOSTED_EVENTS = 'https://calamarmenciano.com/calamar-player.php?event=';
async function hostedEventSources(event, fetcher, signal) {
  try {
    const timeout = AbortSignal.timeout(5500);
    const response = await fetcher(HOSTED_EVENTS + encodeURIComponent(event), { credentials: 'omit', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    return response.ok ? eventPlayerSources(await response.json()) : [];
  } catch { return []; }
}

export async function expandEventSources(streams, { fetcher = globalThis.fetch, signal, preferHosted = false } = {}) {
  const rows = await Promise.all(streams.map(async url => {
    const api = zicoEventApi(url);
    if (!api) return [{ url }];
    try {
      const hosted = preferHosted ? hostedEventSources(url, fetcher, signal) : [];
      const direct = (async () => {
        const response = await fetcher(api, { credentials: 'omit', cache: 'no-store', signal });
        if (!response.ok) throw Error(`Zico TV responde HTTP ${response.status}.`);
        return eventPlayerSources(await response.json());
      })();
      const [preferred, publicSources] = await Promise.allSettled([hosted, direct]);
      const sources = [...(preferred.value || []), ...(publicSources.value || [])];
      if (!sources.length) throw publicSources.reason || Error('Zico TV todavía no publica fuentes disponibles para este evento.');
      return sources.map(source => ({ ...source, origin: url }));
    } catch (error) {
      return [{ url, error: signal?.aborted ? 'La consulta de fuentes se ha cancelado o ha tardado demasiado.' : error.message || 'No se pudieron consultar las fuentes de Zico TV.' }];
    }
  }));
  const sources = new Map();
  for (const source of rows.flat()) if (!sources.has(source.url)) sources.set(source.url, source);
  return [...sources.values()];
}
