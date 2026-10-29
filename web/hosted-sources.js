import { PLAYER_ENDPOINT, renewablePage, playerPageRelay } from './catalog.js';

export function signalName(value, fallback = 'Canal') {
  const clean = String(value || '').replace(/https?:\/\/\S+|(?:[a-z0-9-]+\.)+(?:com|cc|net|org)\b\S*/gi, '')
    .replace(/zico\s*tv|zicotv/gi, '').replace(/^[\s·|:-]+|[\s·|:-]+$/g, '').trim();
  return clean && !/^(CDN|fuente|opción|servidor)\s*\d*$/i.test(clean) ? clean : fallback;
}

export function hostedRequest(page, id) {
  const request = new URL(playerPageRelay(page));
  request.searchParams.set('cast', '1');
  if (id) request.searchParams.set('source_id', id);
  return request.href;
}

export function hostedUrl(value) {
  const u = new URL(value, PLAYER_ENDPOINT), endpoint = new URL(PLAYER_ENDPOINT);
  if (u.origin !== endpoint.origin || u.pathname !== endpoint.pathname || u.username || u.password
      || !u.searchParams.has('seg') || !u.searchParams.has('sig')) throw Error('La señal no devolvió una lista válida.');
  return u.href;
}

/** Expand each player page into separately selectable signals; media stays on our relay. */
export async function expandHostedSources(streams, { names = {}, fallbackName = 'Canal', fetcher = globalThis.fetch, signal } = {}) {
  const groups = await Promise.all(streams.map(async (url, index) => {
    const fallback = signalName(names[url], signalName(fallbackName));
    if (!renewablePage(url)) return [{ url, name: signalName(names[url], `${fallback} · Señal ${index + 1}`) }];
    try {
      const response = await fetcher(`${playerPageRelay(url)}&list=1`, { credentials: 'omit', cache: 'no-store', signal });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      const channel = signalName(data.name, fallback);
      const options = (data.items || []).filter(item => /^[a-f0-9]{16}$/.test(item.id)).map((item, i) => ({
        url: hostedRequest(url, item.id), name: signalName(item.name, `${channel} · Señal ${i + 1}`),
        page: url, sourceId: item.id,
      }));
      if (!options.length) throw Error('No hay señales disponibles.');
      return options;
    } catch {
      return [{ url, name: fallback, error: 'No se pudieron consultar las señales del canal. Pulsa Reintentar.' }];
    }
  }));
  return groups.flat();
}
