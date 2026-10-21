// Video files kept on the Calamar hosting (MKV, AVI…). Their audio is often AC3 or DTS, which Chrome
// and Firefox cannot play, so hosting/calamar-video.php converts them for the browser: H.264 video
// copied as it is, AAC stereo audio, HLS that grows while FFmpeg works.
export const VIDEO_BRIDGE = 'https://calamarmenciano.com/calamar-video.php';
const HOSTS = ['calamarmenciano.com', 'www.calamarmenciano.com'];
export const VIDEO_FILE = /\.(mkv|avi|mov|wmv|flv|m4v|mpg|mpeg|m2ts|vob)$/i;

/** True for a video file of the Calamar hosting that the browser plays through the converter. */
export function hostedVideo(address) {
  try {
    const u = new URL(address);
    return u.protocol === 'https:' && HOSTS.includes(u.hostname) && !u.username && !u.password && VIDEO_FILE.test(u.pathname);
  } catch { return false; }
}

/** Asks the hosting to convert the file and waits until the first fragments exist. */
export async function prepareHostedVideo(address, { fetcher = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onStatus = () => {}, isCurrent = () => true } = {}) {
  if (!hostedVideo(address)) return null;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (!isCurrent()) return null;
    let response;
    try {
      response = await fetcher(`${VIDEO_BRIDGE}?action=start&src=${encodeURIComponent(address)}`, { cache: 'no-store',
        signal: AbortSignal.timeout(15000), referrerPolicy: 'no-referrer' });
    } catch { throw new Error('No se pudo conectar con el hosting para preparar el vídeo.'); }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Falta subir calamar-video.php al hosting.');
    }
    const data = await response.json();
    if (!response.ok && response.status !== 202) throw new Error(data.error || 'El hosting no pudo preparar el vídeo.');
    if (response.status === 200 && data.url) {
      const u = new URL(data.url);
      if (u.origin !== new URL(VIDEO_BRIDGE).origin || u.pathname !== '/calamar-video.php' || u.searchParams.get('action') !== 'media'
        || u.searchParams.get('file') !== 'index.m3u8' || !/^[a-f0-9]{64}$/.test(u.searchParams.get('session') || '')) {
        throw new Error('Respuesta no válida del hosting.');
      }
      return { url: data.url, complete: data.state === 'complete' };
    }
    onStatus(attempt < 3 ? 'Preparando el vídeo…' : 'Preparando el vídeo… La primera vez tarda unos segundos.');
    await sleep(1000);
  }
  throw new Error('El hosting no ha preparado el vídeo a tiempo. Vuelve a intentarlo.');
}
