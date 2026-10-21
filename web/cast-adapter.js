export const CAST_BRIDGE = 'https://calamarmenciano.com/calamar-cast.php';

// The server accepts only the HTTP IPTV provider already configured on this hosting.
export function needsCastBridge(address) {
  try {
    const u = new URL(address);
    return u.protocol === 'http:' && u.hostname === '31.43.191.125' && u.port === '8080'
      && !u.username && !u.password && !u.search && !u.hash
      && /^\/[^/]+\/[^/]+\/\d+(?:\.ts)?$/.test(u.pathname);
  } catch { return false; }
}

export async function prepareCastSource(address, { fetcher = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onStatus = () => {} } = {}) {
  if (!needsCastBridge(address)) return null;
  onStatus('Preparando el canal para la TV…');
  const bytes = new TextEncoder().encode(address);
  const headers = { 'X-Calamar-Source': btoa(String.fromCharCode(...bytes)) };
  for (let attempt = 0; attempt < 35; attempt++) {
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
