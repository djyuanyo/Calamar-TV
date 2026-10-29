import { cleanTitle, episodeOf, luluFolder } from './library-lulu.js';

export const DRIVE_ENDPOINT = 'https://calamarmenciano.com/calamar-drive.php';
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;

/** Only folder links; never accept an arbitrary address for the hosting to fetch. */
export function folderReference(address) {
  const u = new URL(String(address).trim());
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw Error('Pega un enlace HTTPS de carpeta de Google Drive o LuluStream.');
  if (u.hostname === 'drive.google.com') {
    const id = u.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    const resourceKey = u.searchParams.get('resourcekey') || '';
    if (id && idPattern.test(id) && (!resourceKey || idPattern.test(resourceKey))) return { provider: 'drive', id, resourceKey };
  }
  if (/^(?:www\.)?(?:lulustream|luluvdo|luluvdoo|luluvido|luluvid|lulu)\.(?:com|st|to|net|org|io|live|pw)$/.test(u.hostname)) {
    const code = u.pathname.match(/^\/fld\/([A-Za-z0-9]+)(?:\/.*)?$/)?.[1];
    const id = u.searchParams.get('fld_id');
    if (code) return { provider: 'lulu', code };
    if (/^\d{1,12}$/.test(id || '')) return { provider: 'lulu', id };
  }
  throw Error('Ese enlace no es una carpeta de Google Drive o LuluStream.');
}

export async function driveFolder(folder, key, fetcher = globalThis.fetch) {
  if (!key) throw Error('Añade la clave de Google Drive en Configuración.');
  const files = [], folders = [], seen = new Set();
  let pageToken = '', name = '';
  do {
    if (seen.has(pageToken) || seen.size >= 100) throw Error('Drive devolvió una lista incompleta. No se ha publicado la importación.');
    seen.add(pageToken);
    const response = await fetcher(DRIVE_ENDPOINT, { method: 'POST', body: new URLSearchParams({
      id: folder.id, resourceKey: folder.resourceKey || '', key, pageToken,
    }), credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(45000) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'No se pudo leer la carpeta de Google Drive.');
    name = data.name || name;
    files.push(...(data.files || [])); folders.push(...(data.folders || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { name, files, folders };
}

/** One combined scan; publication happens only after every configured folder has been read. */
export async function scanFolders(sources, settings, { fetcher = globalThis.fetch, onFolder = () => {} } = {}) {
  const films = [], series = [], unknown = [], cache = new Map(), providers = new Set();
  let count = 0;
  const read = async (folder) => {
    const key = `${folder.provider}:${folder.id}`;
    if (cache.has(key)) return cache.get(key);
    if (++count > 1000) throw Error('La importación supera 1000 carpetas. Divide los enlaces en grupos más pequeños.');
    onFolder(folder.name || folder.id);
    const data = folder.provider === 'drive' ? await driveFolder(folder, settings.drive, fetcher)
      : await luluFolder(folder.id, settings.lulu, fetcher);
    const result = { ...data, name: data.name || folder.name || 'Carpeta',
      folders: data.folders.map(f => ({ ...f, provider: folder.provider })),
      files: data.files.map(f => ({ ...f, link: f.link || `https://luluvido.com/${f.code}` })) };
    cache.set(key, result); return result;
  };
  const luluId = async (ref) => {
    if (!settings.lulu) throw Error('Añade la clave de LuluStream en Configuración.');
    if (ref.id) return ref;
    const queue = [{ provider: 'lulu', id: '0' }], visited = new Set();
    while (queue.length) {
      const parent = queue.shift();
      if (visited.has(parent.id)) continue;
      visited.add(parent.id);
      const data = await read(parent);
      for (const f of data.folders) { if (f.code === ref.code) return f; queue.push(f); }
    }
    throw Error('No se encuentra esa carpeta en tu cuenta de LuluStream.');
  };
  const videos = async (folder, depth = 0, ancestry = new Set()) => {
    if (depth > 8) throw Error('Hay más de ocho niveles de carpetas. Importa una subcarpeta directamente.');
    if (ancestry.has(`${folder.provider}:${folder.id}`)) throw Error('Se ha encontrado una referencia circular de carpetas.');
    const next = new Set(ancestry).add(`${folder.provider}:${folder.id}`), data = await read(folder);
    const out = data.files.map(f => ({ ...f, folder: data.name }));
    for (const child of data.folders) out.push(...await videos(child, depth + 1, next));
    return out;
  };
  const film = (f, section) => films.push({ section, ...cleanTitle(f.title), file: f.title, link: f.link, uploaded: f.uploaded || '' });
  const show = (name, files, section) => {
    const episodes = [];
    for (const f of files) {
      const at = episodeOf(f.title, f.folder === name ? '' : f.folder);
      if (at) episodes.push({ season: at[0], episode: at[1], file: f.title, link: f.link, uploaded: f.uploaded || '' });
      else unknown.push(`${name} / ${f.title}: indica el capítulo con 1x01 o S01E01.`);
    }
    if (episodes.length) series.push({ section, ...cleanTitle(name), folder: name, episodes });
  };
  for (const source of sources) {
    if (!['movies', 'series', 'documentaries'].includes(source.section)) throw Error('Sección de carpeta no válida.');
    let ref = folderReference(source.url);
    providers.add(ref.provider);
    if (ref.provider === 'lulu') ref = await luluId(ref);
    const data = await read(ref);
    if (source.section === 'movies') { for (const f of await videos(ref)) film(f, source.section); continue; }
    const isShow = data.files.some(f => episodeOf(f.title)) || data.folders.some(f => /^(?:temporada|season|T\s*\d)/i.test(f.name));
    if (isShow) { show(data.name, await videos(ref), source.section); continue; }
    if (source.section === 'documentaries') for (const f of data.files) film(f, source.section);
    else if (data.files.length) unknown.push(`${data.name}: coloca cada serie en su propia carpeta.`);
    for (const child of data.folders) {
      const content = await videos(child);
      if (source.section === 'documentaries' && !content.some(f => episodeOf(f.title, f.folder))) for (const f of content) film(f, source.section);
      else show(child.name, content, source.section);
    }
  }
  // Which sites were read: a copy missing from a site read in full was deleted there.
  return { films, series, unknown, providers: [...providers] };
}
