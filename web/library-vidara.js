import { vidaraVideo } from './provider-players.js';

export const VIDARA_ENDPOINT = 'https://calamarmenciano.com/calamar-vidara.php';
const folderId = /^[1-9]\d{0,11}$/;
const fileCode = /^[A-Za-z0-9]{8,24}$/;

async function vidaraApi(action, params, key, fetcher) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key || '')) throw Error('Añade una clave válida de Vidara en Configuración.');
  let response;
  try {
    response = await fetcher(VIDARA_ENDPOINT, {
      method: 'POST',
      body: new URLSearchParams({ action, ...params, key }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw Error('No se pudo conectar con el puente de Vidara. Comprueba que calamar-vidara.php esté instalado en tu hosting.');
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 && data?.error === 'vidara_key') {
    throw Error('Vidara no acepta la clave de la API. Revísala en Configuración.');
  }
  if (!response.ok || !data || typeof data !== 'object' || data.error) {
    if (response.status === 404 || !data) throw Error('Instala calamar-vidara.php en tu hosting para leer tus carpetas.');
    if (data.error === 'curl') throw Error('El hosting necesita la extensión cURL de PHP para consultar Vidara.');
    if (data.error === 'vidara_unavailable' || data.error === 'vidara_response' && !data.bridge) {
      throw Error('El puente antiguo no indica por qué falló Vidara. Sustituye calamar-vidara.php por la versión nueva.');
    }
    const codes = [
      ['Vidara HTTP', data.upstream_http], ['estado de la API', data.upstream_status], ['cURL', data.curl_error],
    ].filter(([, value]) => Number.isSafeInteger(value) && value > 0).map(([label, value]) => `${label} ${value}`);
    const diagnostic = codes.length ? codes.join(', ') : `puente HTTP ${response.status}`;
    const message = data.error === 'vidara_transport' ? 'El hosting no pudo completar la conexión con Vidara'
      : data.error === 'vidara_response' ? 'Vidara devolvió una lista con un formato inesperado'
      : 'Vidara rechazó la consulta o su API está temporalmente indisponible';
    throw Error(`${message} (${diagnostic}).`);
  }
  return data;
}

export async function vidaraFolders(key, fetcher = globalThis.fetch) {
  const { folders } = await vidaraApi('folders', {}, key, fetcher);
  if (!Array.isArray(folders)) throw Error('Vidara devolvió una lista de carpetas incompleta.');
  const ids = new Set();
  return folders.map(folder => {
    const id = String(folder?.fld_id ?? '');
    if (!folderId.test(id) || typeof folder.name !== 'string' || !folder.name.trim() || ids.has(id)) {
      throw Error('Vidara devolvió una carpeta no válida.');
    }
    ids.add(id);
    const count = /^\d+$/.test(String(folder.videos)) ? Number(folder.videos) : NaN;
    return { id, name: folder.name.trim(), count: Number.isSafeInteger(count) ? count : null };
  });
}

export async function vidaraVideos(id, key, fetcher = globalThis.fetch) {
  if (!folderId.test(String(id))) throw Error('Selecciona una carpeta de Vidara válida.');
  const files = [], seen = new Set();
  let pages, total;
  for (let page = 1; page <= (pages ?? 1); page++) {
    const data = await vidaraApi('videos', { id, page }, key, fetcher);
    if (data.complete_inventory !== true) {
      throw Error('Sustituye calamar-vidara.php por la versión nueva en el hosting y vuelve a buscar.');
    }
    const count = Number(data.total), lastPage = Number(data.total_pages);
    if (!Array.isArray(data.videos) || data.total == null || data.total_pages == null || !Number.isSafeInteger(count) || count < 0
        || !Number.isSafeInteger(lastPage) || lastPage < 0 || lastPage > 250
        || Number(data.page) !== page || (count > 0 && lastPage < page)
        || (total !== undefined && (total !== count || pages !== lastPage))) {
      throw Error('La lista de Vidara está incompleta. No se ha actualizado el catálogo.');
    }
    pages = lastPage;
    total = count;
    for (const video of data.videos) {
      const code = video?.filecode;
      if (!fileCode.test(code || '') || typeof video.title !== 'string' || !video.title.trim() || seen.has(code)) {
        throw Error('Vidara devolvió un vídeo duplicado o no válido. No se ha actualizado el catálogo.');
      }
      seen.add(code);
      const unavailable = ['blocked', 'error'].includes(String(video.status).toLowerCase())
        || ['0', 'false'].includes(String(video.file_active));
      files.push({ code, title: video.title, link: vidaraVideo(code), unavailable,
        uploaded: String(video.uploaded || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '' });
    }
  }
  if (files.length !== total) throw Error('Faltan vídeos en la lista de Vidara. No se ha actualizado el catálogo.');
  return files;
}

export function suggestedVidaraSection(name) {
  const text = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return ({ peliculas: 'movies', cine: 'movies', movies: 'movies', series: 'series', documentales: 'documentaries', documentaries: 'documentaries' })[text] || '';
}
