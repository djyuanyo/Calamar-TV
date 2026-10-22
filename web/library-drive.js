// Films, series and documentaries from Google Drive folders, read by the administrator's browser (no
// hosting): the Drive API lists the folders, TMDB gives synopsis, cast, rating and images, and the result
// is published to Firestore (calamarLibrary) for the web and the app. Same folder rules as Plex:
// a video alone in its folder takes the folder's name («Avatar (2009)/Avatar.mp4»); every subfolder of
// Series is a series and its videos (also in «Temporada N») are episodes: 1x01, S01E01 or Cap.101.
export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'wmv', 'mpg', 'mpeg', 'ts', 'm2ts', 'webm', 'flv', 'vob'];
export const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
export const TMDB_API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p/';
export const ATTRIBUTION = 'Datos e imágenes de TMDB. Este producto usa la API de TMDB, pero TMDB no lo respalda ni certifica.';
const FOLDER = 'application/vnd.google-apps.folder';

/** The folder id of a Drive folder link (…/folders/ID…, open?id=ID) or of a bare id; null otherwise. */
export function driveFolderId(value) {
  const text = String(value || '').trim();
  const link = text.match(/^https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([A-Za-z0-9_-]{10,})/);
  if (link) return link[1];
  return /^[A-Za-z0-9_-]{25,}$/.test(text) ? text : null;
}
export const driveVideoUrl = (id, key) => `${DRIVE_API}/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(key)}`;

const extension = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

/** "Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1001][AC3 5.1]" -> { title: 'Los Hombres De Paco', year: null }. */
export function cleanTitle(name) {
  let text = String(name).replace(new RegExp(`\\.(${VIDEO_EXTENSIONS.join('|')})$`, 'i'), '');
  const year = (` ${text} `).match(/[\[(. _-]((?:19|20)\d{2})[\]). _-]/);
  text = text.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/\(([^)]*)\)/g, ' ').replace(/(?<=[a-z0-9])[._](?=[a-z0-9])/gi, ' ');
  text = text.replace(/\b(?:S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|cap(?:[ií]tulo)?[ .]?\d{1,4}|episodio \d+|temporada \d+|season \d+|(?:19|20)\d{2}|2160p|1080p|720p|480p|4k|uhd|hdtv|hdrip|bdrip|brrip|bluray|blu-ray|web-?dl|webrip|dvdrip|x26[45]|h ?26[45]|hevc|xvid|divx|aac|ac3|dts|5 1|castellano|espa[nñ]ol|spanish|latino|dual|vose|subs?|proper|repack|extended|www [a-z0-9-]+ [a-z]{2,4})\b.*$/iu, ' ');
  text = text.replace(/\s+[-–—]\s*$|^\s*[-–—]\s+/u, ' ').replace(/\s+/g, ' ').trim().replace(/^[\s\-–—.]+|[\s\-–—.]+$/gu, '');
  return { title: text, year: year ? Number(year[1]) : null };
}

/** Season and episode from a file name (and its folder): 1x01, S01E01, Cap.101 / Cap.1001, or «Temporada 2» + «Capítulo 5». */
export function episodeNumber(file, folder = '') {
  let m = file.match(/S(\d{1,2})[ ._-]?E(\d{1,3})/i);
  if (m) return [Number(m[1]), Number(m[2])];
  m = file.match(/(?<!\d)(\d{1,2})x(\d{1,3})(?!\d)/i);
  if (m) return [Number(m[1]), Number(m[2])];
  m = file.match(/cap(?:[ií]tulo)?[ ._-]*(\d{3,4})(?!\d)/iu);
  if (m) return [Math.floor(Number(m[1]) / 100), Number(m[1]) % 100];
  const s = (`${folder} ${file}`).match(/(?:temporada|season|T)[ ._-]*(\d{1,2})(?!\d)/i);
  m = file.match(/(?:cap(?:[ií]tulo)?|episodio|episode|ep|e)[ ._-]*(\d{1,3})(?!\d)/iu);
  return m ? [s ? Number(s[1]) : 1, Number(m[1])] : null;
}

/** A short stable id from a text (the Drive file or folder id): «m» + 16 hex characters. */
export async function stableId(prefix, text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return prefix + [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function json(url, fetcher, init) {
  let response;
  try { response = await fetcher(url, { referrerPolicy: 'no-referrer', ...init }); }
  catch { throw new Error('Sin conexión con el servicio. Comprueba la red y vuelve a intentarlo.'); }
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

/** One page of a Drive folder; errors say what to change in Drive or in Google Cloud. */
async function driveList(folder, key, fetcher, page = '') {
  const params = new URLSearchParams({ q: `'${folder}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType)',
    pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', key });
  if (page) params.set('pageToken', page);
  const { status, data } = await json(`${DRIVE_API}?${params}`, fetcher);
  if (status === 403 && JSON.stringify(data).includes('SERVICE_DISABLED')) throw new Error('Activa la «Google Drive API» en Google Cloud para el proyecto menciamedia (ver instrucciones) y vuelve a escanear.');
  if (status === 400 || status === 403) throw new Error('Google Drive no acepta la clave. Revisa la clave de Google en la configuración.');
  if (status === 404) throw new Error('No se encuentra una carpeta de Drive: compártela como «Cualquier persona con el enlace» y pega su enlace.');
  if (status !== 200 || !data) throw new Error('Google Drive no responde ahora. Vuelve a intentarlo.');
  return data;
}

/** Videos under a Drive folder: [{ path inside the folder, key (Drive id), url }], subfolders up to 6 levels. */
export async function driveVideos(folder, key, fetcher = globalThis.fetch, limit = 5000) {
  const out = [], queue = [[folder, '', 0]], seen = new Set([folder]);
  let folders = 0;
  while (queue.length && out.length < limit && folders++ < 3000) {
    const [id, prefix, depth] = queue.shift();
    let page = '';
    do {
      const data = await driveList(id, key, fetcher, page);
      for (const file of data.files || []) {
        const name = String(file.name || '').replace(/\//g, '-');
        if (!name || name.startsWith('.')) continue;
        if (file.mimeType === FOLDER) {
          if (depth < 6 && !seen.has(file.id)) { seen.add(file.id); queue.push([file.id, `${prefix}${name}/`, depth + 1]); }
          continue;
        }
        if (!VIDEO_EXTENSIONS.includes(extension(name)) && !String(file.mimeType || '').startsWith('video/')) continue;
        out.push({ path: prefix + name, key: file.id, url: driveVideoUrl(file.id, key) });
      }
      page = data.nextPageToken || '';
    } while (page && out.length < limit);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true, sensitivity: 'base' }));
}

/** Titles of one section from its videos (films and documentaries) or series with episodes. */
export async function sectionItems(section, folderId, videos) {
  const items = [];
  if (section === 'series') {
    const series = new Map();
    for (const v of videos) {
      if (!v.path.includes('/')) continue; // A series is a folder.
      const name = v.path.split('/')[0];
      if (!series.has(name)) series.set(name, []);
      series.get(name).push(v);
    }
    for (const [name, files] of series) {
      const clean = cleanTitle(name);
      const episodes = [];
      for (const [index, file] of files.entries()) {
        const parts = file.path.split('/');
        const [season, episode] = episodeNumber(parts.at(-1), parts.at(-2) || '') || [1, index + 1];
        episodes.push({ id: await stableId('e', file.key), season, episode, file: parts.at(-1), url: file.url });
      }
      episodes.sort((a, b) => a.season - b.season || a.episode - b.episode || a.file.localeCompare(b.file));
      items.push({ id: await stableId('s', `${folderId}/${name}`), kind: 'tv', title: clean.title || name, year: clean.year, folder: name, episodes });
    }
  } else {
    const perFolder = new Map();
    const dir = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    for (const v of videos) perFolder.set(dir(v.path), (perFolder.get(dir(v.path)) || 0) + 1);
    for (const v of videos) {
      const parts = v.path.split('/'), file = parts.at(-1), folder = parts.length > 1 ? parts.at(-2) : null;
      const alone = folder !== null && perFolder.get(dir(v.path)) === 1;
      const clean = cleanTitle(alone ? folder : file);
      items.push({ id: await stableId('m', v.key), kind: 'movie', title: clean.title || file, year: clean.year ?? cleanTitle(file).year, file, url: v.url });
    }
  }
  return items.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
}

/**
 * New scan merged with the published library: titles keep their TMDB data and choices; episodes keep
 * their names. Titles gone from Drive disappear; new ones are «pending».
 */
export function mergeScan(scanned, previous) {
  const before = new Map(Object.values(previous?.sections || {}).flat().map((item) => [item.id, item]));
  const sections = {};
  for (const [section, items] of Object.entries(scanned)) {
    sections[section] = items.map((item) => {
      const old = before.get(item.id);
      if (!old) return { ...item, status: 'pending' };
      const merged = { ...item, status: old.status || 'pending' };
      if (old.tmdb) merged.tmdb = old.tmdb;
      if (item.kind === 'tv') {
        const extras = new Map((old.episodes || []).map((e) => [e.id, e]));
        merged.episodes = item.episodes.map((e) => {
          const prior = extras.get(e.id);
          return prior?.name !== undefined ? { ...e, name: prior.name, overview: prior.overview, still: prior.still } : e;
        });
        // New episodes of a recognised series need their names from TMDB.
        if (merged.status === 'matched' && merged.episodes.some((e) => e.name === undefined)) merged.status = 'refresh';
      }
      return merged;
    });
  }
  return sections;
}

// ---- TMDB -----------------------------------------------------------------------------------------

async function tmdb(path, params, key, fetcher) {
  const bearer = key.includes('.'); // v4 read token (JWT) or v3 key
  const query = new URLSearchParams({ ...params, language: 'es-ES', ...(bearer ? {} : { api_key: key }) });
  const { status, data } = await json(`${TMDB_API}${path}?${query}`, fetcher, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
  if (status === 401) throw new Error('TMDB no acepta la clave. Revísala en Pelis y series → Configuración.');
  if (status !== 200 || !data) throw new Error('TMDB no responde ahora. Vuelve a intentarlo.');
  return data;
}
export const checkTmdbKey = (key, fetcher = globalThis.fetch) => tmdb('/configuration', {}, key, fetcher);

/** Candidates for a title: [{ id, kind, title, year, poster, overview }]; films first, series when none. */
export async function searchTmdb(title, year, kind, key, fetcher = globalThis.fetch) {
  const out = [];
  for (const type of kind === 'tv' ? ['tv'] : ['movie', 'tv']) {
    const params = { query: title, include_adult: 'false' };
    if (year) params[type === 'tv' ? 'first_air_date_year' : 'year'] = String(year);
    const data = await tmdb(`/search/${type}`, params, key, fetcher);
    for (const r of (data.results || []).slice(0, 8)) {
      const date = r.release_date || r.first_air_date || '';
      out.push({ id: r.id, kind: type, title: r.title || r.name || '', year: date ? Number(date.slice(0, 4)) : null,
        poster: r.poster_path ? `${TMDB_IMAGE}w185${r.poster_path}` : '', overview: (r.overview || '').slice(0, 220) });
    }
    if (out.length && kind !== 'tv') break;
  }
  return out;
}

/** Details in Spanish (synopsis, genres, cast, rating, images) and episode names of the given seasons. */
export async function tmdbDetails(id, kind, key, seasons = [], fetcher = globalThis.fetch) {
  const append = ['credits', ...[...new Set(seasons)].slice(0, 18).map((s) => `season/${s}`)];
  const d = await tmdb(`/${kind}/${Number(id)}`, { append_to_response: append.join(',') }, key, fetcher);
  const date = d.release_date || d.first_air_date || '';
  const info = { id: Number(id), kind, title: d.title || d.name || '', year: date ? Number(date.slice(0, 4)) : null, overview: d.overview || '',
    genres: (d.genres || []).map((g) => g.name), cast: (d.credits?.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: c.character || '' })),
    rating: d.vote_average != null ? Math.round(d.vote_average * 10) / 10 : null, votes: d.vote_count || 0,
    runtime: d.runtime || d.episode_run_time?.[0] || null,
    poster: d.poster_path ? `${TMDB_IMAGE}w342${d.poster_path}` : '', backdrop: d.backdrop_path ? `${TMDB_IMAGE}w1280${d.backdrop_path}` : '' };
  const episodes = {};
  for (const s of seasons) for (const e of d[`season/${s}`]?.episodes || []) {
    episodes[`${s}x${e.episode_number}`] = { name: e.name || '', overview: (e.overview || '').slice(0, 300), still: e.still_path ? `${TMDB_IMAGE}w300${e.still_path}` : '' };
  }
  return { info, episodes };
}

/** A first result is accepted automatically only when its title is close to the folder or file name. */
export function confident(wanted, found) {
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(wanted), b = norm(found);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Similarity as PHP similar_text: twice the common characters over both lengths.
  const common = (x, y) => {
    if (!x || !y) return 0;
    let best = 0, bi = 0, bj = 0;
    for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
      let k = 0;
      while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
      if (k > best) { best = k; bi = i; bj = j; }
    }
    return best ? best + common(x.slice(0, bi), y.slice(0, bj)) + common(x.slice(bi + best), y.slice(bj + best)) : 0;
  };
  return (common(a, b) * 2 * 100) / (a.length + b.length) >= 80;
}

/** Applies a TMDB match (or «none» with null) to a library item. */
export function applyMatch(item, match) {
  if (!match) { const { tmdb: _gone, ...rest } = item; return { ...rest, status: 'none' }; }
  const out = { ...item, tmdb: match.info, status: 'matched' };
  if (item.kind === 'tv') out.episodes = item.episodes.map((e) => ({ ...e, ...(match.episodes[`${e.season}x${e.episode}`] || {}) }));
  return out;
}
export const seasonsOf = (item) => [...new Set((item.episodes || []).map((e) => e.season))];

/** The library in Firestore parts of up to ~850 KB: { index, parts: { 'movies-0': {...} } }. */
export function libraryParts(sections, updatedAt = new Date().toISOString(), limit = 850000) {
  const size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  const parts = {}, index = { updatedAt, attribution: ATTRIBUTION, sections: {} };
  for (const [section, items] of Object.entries(sections)) {
    let chunk = [], n = 0;
    const flush = () => { parts[`${section}-${n++}`] = { items: chunk }; chunk = []; };
    for (const item of items) {
      if (size({ items: [...chunk, item] }) > limit && chunk.length) flush();
      chunk.push(item);
    }
    if (chunk.length || n === 0) flush();
    index.sections[section] = n;
  }
  return { index, parts };
}
