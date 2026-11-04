import { vidaraFolders, vidaraSeriesTitle, vidaraVideos } from './library-vidara.js';
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
    if (!data || typeof data !== 'object' || data.incompleteSearch || data.error
        || (!Array.isArray(data.files) && !Array.isArray(data.folders))
        || (data.files != null && !Array.isArray(data.files)) || (data.folders != null && !Array.isArray(data.folders)))
      throw Error('Drive devolvió una lista incompleta o no válida. No se ha actualizado el catálogo.');
    name = data.name || name;
    files.push(...(data.files || [])); folders.push(...(data.folders || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return { name, files, folders };
}

const EPISODE_NAME = /S\d{1,2}[ ._-]?E\d{1,3}|(?<!\d)\d{1,2}x\d{1,3}(?!\d)|cap(?:[ií]tulo)?[ ._-]*\d|episodio|episode/iu;
/** Most videos are episodes: by an explicit episode mark (strict), or as episodeOf reads them with their folder. */
const mostlyEpisodes = (files, strict = false) => {
  const marked = files.filter(f => (strict ? EPISODE_NAME.test(f.title) : episodeOf(f.title, f.folder))).length;
  return marked > 0 && marked * 2 >= files.length;
};

/** One combined scan. Failed Vidara folders do not make other folders unreadable. */
export async function scanFolders(sources, settings, { fetcher = globalThis.fetch, onFolder = () => {} } = {}) {
  const films = [], series = [], unknown = [], cache = new Map(), providers = new Set(), inventory = [], vidaraReport = [];
  const vidaraShows = new Map();
  const selectedVidara = sources.filter(source => source.provider === 'vidara');
  const selectedVidaraIds = new Set(selectedVidara.map(source => String(source.id)));
  const rootOnly = selectedVidara.filter(source => source.section === 'series').length === 1;
  const pendingSources = [...sources];
  let count = 0, vidaraIndex;
  const readVidaraIndex = () => vidaraIndex ||= vidaraFolders(settings.vidara, fetcher);
  const read = async (folder) => {
    const key = `${folder.provider}:${folder.id}`;
    if (cache.has(key)) return cache.get(key);
    if (++count > 1000) throw Error('La importación supera 1000 carpetas. Divide los enlaces en grupos más pequeños.');
    onFolder(folder.name || folder.id);
    let data;
    if (folder.provider === 'vidara') {
      const index = await readVidaraIndex();
      const selected = index.find(entry => entry.id === folder.id);
      if (!selected) throw Error('Una carpeta de Vidara ya no está disponible. Actualiza la selección de carpetas.');
      const files = await vidaraVideos(folder.id, settings.vidara, fetcher);
      if (!files.length && selected.count > 0) {
        throw Error(`Vidara indica que tiene ${selected.count} archivos, pero su lista está vacía.`);
      }
      data = { name: selected.name, files, folders: index.filter(entry => entry.parentId === folder.id) };
    } else data = folder.provider === 'drive' ? await driveFolder(folder, settings.drive, fetcher)
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
  for (const source of pendingSources) {
    if (!['movies', 'series', 'documentaries'].includes(source.section)) throw Error('Sección de carpeta no válida.');
    let ref = source.provider === 'vidara' ? { provider: 'vidara', id: String(source.id), name: source.name } : folderReference(source.url);
    providers.add(ref.provider);
    if (ref.provider === 'lulu') ref = await luluId(ref);
    let data, files;
    try {
      if (ref.provider === 'vidara' && source.section === 'series' && rootOnly) {
        const index = await readVidaraIndex();
        const root = index.find(folder => folder.id === ref.id);
        if (root && /^series$/i.test(root.name) && !root.parentId) {
          // Vidara can list season folders beside «Series», without a parent ID or path.
          for (const folder of index) {
            if (!folder.parentId && !folder.name.includes('/') && vidaraSeriesTitle(folder.name) && !selectedVidaraIds.has(folder.id)) {
              pendingSources.push({ provider: 'vidara', id: folder.id, name: folder.name, section: 'series' });
            }
          }
        }
      }
      data = await read(ref);
      files = await videos(ref);
    } catch (error) {
      if (ref.provider !== 'vidara') throw error;
      vidaraReport.push({ name: ref.name || `Carpeta ${ref.id}`, error: error.message });
      continue;
    }
    inventory.push({ id: `${ref.provider}:${ref.id}`, provider: ref.provider, section: source.section, links: files.map(f => f.link) });
    // An unavailable file still exists in Vidara and must not be reconciled as a deletion.
    const all = ref.provider === 'vidara' ? files.filter(f => !f.unavailable) : files;
    if (ref.provider === 'vidara') vidaraReport.push({ name: data.name, count: files.length, unavailable: files.length - all.length });
    if (source.section === 'movies') { for (const f of all) film(f, source.section); continue; }
    if (ref.provider === 'vidara') {
      for (const file of all) {
        const marker = file.title.match(EPISODE_NAME);
        const seasonTitle = vidaraSeriesTitle(file.folder);
        const episode = (source.section === 'series' || marker || seasonTitle) && episodeOf(file.title, file.folder);
        if (!episode) {
          if (source.section === 'documentaries') film(file, source.section);
          else unknown.push(`${file.title}: indica el capítulo con 1x01 o S01E01.`);
          continue;
        }
        const prefix = marker ? file.title.slice(0, marker.index).replace(/[ ._–—-]+$/u, '').trim() : '';
        const leaf = file.folder.split('/').pop().trim();
        const title = seasonTitle || prefix || leaf;
        const clean = cleanTitle(title);
        if (!clean.title || /^(series|documentales|documentaries)$/i.test(title)) {
          unknown.push(`${file.title}: indica el nombre de la serie antes del capítulo.`);
          continue;
        }
        const key = JSON.stringify([source.section, clean.title.toLocaleLowerCase('es'), clean.year]);
        if (!vidaraShows.has(key)) vidaraShows.set(key, { title, section: source.section, files: new Map() });
        vidaraShows.get(key).files.set(file.link, file);
      }
      continue;
    }
    // A documentaries folder is one series only when most of its videos name an episode (1x01, S01E01, «Capítulo 3»…)
    // or it has season folders: a film whose name starts with a number («11M (2022)») does not make it a series.
    const isShow = (source.section === 'documentaries' ? mostlyEpisodes(data.files, true) : data.files.some(f => episodeOf(f.title))) || data.folders.some(f => /^(?:temporada|season|T\s*\d)/i.test(f.name));
    if (isShow) { show(data.name, all, source.section); continue; }
    if (source.section === 'documentaries') for (const f of data.files) film(f, source.section);
    else if (data.files.length) unknown.push(`${data.name}: coloca cada serie en su propia carpeta.`);
    for (const child of data.folders) {
      const content = await videos(child);
      if (source.section === 'documentaries' && !mostlyEpisodes(content)) for (const f of content) film(f, source.section);
      else show(child.name, content, source.section);
    }
  }
  for (const item of vidaraShows.values()) show(item.title, item.files.values(), item.section);
  // Which sites were read: a copy missing from a site read in full was deleted there.
  return { films, series, unknown, providers: [...providers], inventory, vidaraReport,
    partialVidara: vidaraReport.some(row => !!row.error), complete: true };
}
