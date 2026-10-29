export const CAST_BRIDGE = 'https://calamarmenciano.com/calamar-cast.php';

import { httpTsSource } from './http-stream.js';
import { PLAYER_ENDPOINT, webPlayback } from './catalog.js';

/** MPEG-TS the hosting converts for the TV: HTTP IPTV and also .ts addresses over HTTPS. */
export const needsCastBridge = (address) => httpTsSource(address)
  || (/^https:\/\//i.test(String(address || '')) && httpTsSource(String(address).replace(/^https:/i, 'http:')));
/** Player pages (zicotv and similar): the TV gets the list relayed by calamar-player.php, as the web plays it. */
export const castPage = (address) => webPlayback(String(address || ''), { pages: true }).kind === 'hls'
  && !!webPlayback(String(address || ''), { pages: true }).page;

/**
 * An M3U8 channel the TV cannot read straight away (HTTP on an HTTPS receiver, or a server without
 * CORS): calamar-player.php hands out its list and pieces with CORS, for channels of the catalog only.
 */
export const relayListCast = (address, { fetcher = globalThis.fetch, onStatus = () => {} } = {}) => preparePageCast(address, fetcher, onStatus);

async function preparePageCast(address, fetcher, onStatus) {
  onStatus('Preparando el canal para la TV…');
  let response, data = null;
  try {
    response = await fetcher(`${PLAYER_ENDPOINT}?page=${encodeURIComponent(String(address).trim())}&cast=1`,
      { cache: 'no-store', signal: AbortSignal.timeout(25000), referrerPolicy: 'no-referrer' });
    data = await response.json();
  } catch { throw new Error('No se pudo conectar con calamar-player.php del hosting.'); }
  if (!response.ok || typeof data?.url !== 'string') {
    throw new Error(response.ok ? 'Sube la última versión de calamar-player.php al hosting para enviar este canal a la TV.' : (data?.error || 'El hosting no pudo leer el reproductor.'));
  }
  const u = new URL(data.url, PLAYER_ENDPOINT);
  if (u.origin !== new URL(PLAYER_ENDPOINT).origin || u.pathname !== new URL(PLAYER_ENDPOINT).pathname
    || !u.searchParams.get('seg') || !/^[a-f0-9]{32}$/.test(u.searchParams.get('sig') || '')) {
    throw new Error('Respuesta no válida del hosting.');
  }
  return { url: u.href, type: 'application/x-mpegURL', live: true };
}

export async function prepareCastSource(address, { fetcher = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onStatus = () => {}, isCurrent = () => true } = {}) {
  if (castPage(address)) return preparePageCast(address, fetcher, onStatus);
  if (!needsCastBridge(address)) return null;
  onStatus('Preparando el canal para la TV…');
  const bytes = new TextEncoder().encode(address);
  const headers = { 'X-Calamar-Source': btoa(String.fromCharCode(...bytes)) };
  for (let attempt = 0; attempt < 35; attempt++) {
    if (!isCurrent()) return null;
    let response;
    try { response = await fetcher(`${CAST_BRIDGE}?action=start`, { headers, cache: 'no-store',
      signal: AbortSignal.timeout(10000), referrerPolicy: 'no-referrer' }); }
    catch { throw new Error('No se pudo conectar con el adaptador del hosting.'); }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Falta instalar Calamar Chromecast en el hosting.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'El hosting no pudo preparar el canal.');
    if (response.status === 200 && data.url) {
      const u = new URL(data.url);
      if (u.origin !== new URL(CAST_BRIDGE).origin || u.pathname !== '/calamar-cast.php'
        || u.searchParams.get('action') !== 'media' || u.searchParams.get('file') !== 'live.m3u8'
        || !/^[a-f0-9]{64}$/.test(u.searchParams.get('session') || '')) {
        throw new Error('Respuesta no válida del adaptador.');
      }
      return { url: data.url, type: 'application/x-mpegURL', live: true };
    }
    await sleep(1000);
  }
  throw new Error('El hosting no ha generado vídeo compatible a tiempo. Revisa la prueba de Chromecast del hosting.');
}
