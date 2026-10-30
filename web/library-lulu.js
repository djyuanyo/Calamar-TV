// Reads the administrator's LuluStream folders with its API and matches each video with TMDB:
//   Peliculas/<one video per film>          Documentales/<one video per documentary>
//   Series/<Name>/Temporada N/<episodes>     Documentales/<Name>/Temporada N/<episodes>
// The key lives only in the admin-only settings; when the browser cannot call the API directly
// (CORS), the request goes through the hosting (calamar-lulu.php), which only relays the JSON.
import { LULU_ENDPOINT } from './catalog.js';
import { searchTmdb, tmdbDetails, seasonEpisodes, movieItem, seriesWithSeason } from './library-tmdb.js';
import { videoKey as codeOf, managedByScan, reconcileScan } from './library-sync.js';

// LuluStream moved to luluvido.com (lulustream.com stopped answering): the same API, tried there first.
export const LULU_APIS = ['https://luluvido.com/api/', 'https://api.lulustream.com/api/'];
export const LULU_API = LULU_APIS[0];

function luluResult(data) {
  if (!data || typeof data !== 'object') throw new Error('LuluStream no ha respondido con datos.');
  if (Number(data.status) !== 200) throw new Error(/auth/i.test(data.msg || '') ? 'LuluStream no acepta la clave de la API. Revísala en «Configuración».' : `LuluStream: ${data.msg || `error ${data.status}`}`);
  return data.result ?? {};
}

// Each call gives up after a while, so a request LuluStream or the hosting never answers shows an
// error instead of leaving «Leyendo…» on screen forever.
export const LULU_DIRECT_MS = 12000, LULU_HOSTING_MS = 50000;
const limited = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
// Once the browser is not allowed to call the API itself (CORS), the following calls go straight to the hosting.
let directBlocked = false;
export const resetLuluRoute = () => { directBlocked = false; };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The same call through the hosting (calamar-lulu.php), tried twice when it does not answer. */
async function viaHosting(action, params, key, fetcher) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetcher(LULU_ENDPOINT, { method: 'POST', body: new URLSearchParams({ api: action, ...params, key }), referrerPolicy: 'no-referrer', ...limited(LULU_HOSTING_MS) });
    } catch (error) {
      const late = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (attempt < 2) { await pause(2000); continue; }
      if (late) throw new Error('LuluStream no responde (ni directamente ni a través del hosting). Vuelve a intentarlo en un rato.');
      throw new Error('Sin conexión con LuluStream ni con el hosting. Comprueba la red y que calamar-lulu.php está subido.');
    }
    const data = await response.json().catch(() => null);
    if (!data && attempt < 2 && response.status >= 500) { await pause(2000); continue; }
    if (!data) throw new Error(`El hosting no ha podido consultar LuluStream (HTTP ${response.status}).`);
    if (data.error) {
      if (attempt < 2 && response.status >= 500) { await pause(2000); continue; }
      throw new Error(data.error);
    }
    return data;
  }
}

/** One API call: straight from the browser, or through the hosting when the browser is not allowed to. */
export async function luluApi(action, params, key, fetcher = globalThis.fetch) {
  const query = new URLSearchParams({ ...params, key });
  let data = null;
  if (!directBlocked) {
    try {
      for (const api of LULU_APIS) {
        try {
          const response = await fetcher(`${api}${action}?${query}`, { referrerPolicy: 'no-referrer', ...limited(LULU_DIRECT_MS) });
          data = await response.json();
          break;
        } catch (error) { if (api === LULU_APIS[LULU_APIS.length - 1]) throw error; }
      }
    } catch { directBlocked = true; }
  }
  if (!data) data = await viaHosting(action, params, key, fetcher);
  return luluResult(data);
}

// LuluStream sends names HTML-encoded («Serie &#40;Temporada 1&#41;»): they are used as written.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeHtml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all; }
  return NAMED[e.toLowerCase()] ?? all;
});
const textOf = (...values) => decodeHtml(String(values.find((v) => v != null && v !== '') ?? ''));

/** «2026-10-21 18:03:11» → «2026-10-21»: the day LuluStream received the video, or ''. */
export const dayOf = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : '');

/** A folder's subfolders and videos: { folders: [{ id, name }], files: [{ code, title, uploaded }] }. */
export async function luluFolder(id, key, fetcher) {
  const result = await luluApi('folder/list', { fld_id: String(id), files: '1' }, key, fetcher);
  if ((!Array.isArray(result.folders) && !Array.isArray(result.files))
      || (result.folders != null && !Array.isArray(result.folders)) || (result.files != null && !Array.isArray(result.files))
      || result.has_more || result.next_page || result.nextPageToken)
    throw Error('LuluStream devolvió una lista incompleta o no válida. No se ha actualizado el catálogo.');
  if ((result.folders || []).some(f => !f || !textOf(f.fld_id, f.id))
      || (result.files || []).some(f => !f || !/^[A-Za-z0-9]{8,20}$/.test(textOf(f.file_code, f.filecode, f.code))))
    throw Error('LuluStream devolvió archivos o carpetas no válidos. No se ha actualizado el catálogo.');
  return {
    folders: (result.folders || []).map((f) => ({ id: textOf(f.fld_id, f.id), name: textOf(f.name, f.title), ...(f.code ? { code: String(f.code) } : {}) })).filter((f) => f.id),
    files: (result.files || []).map((f) => ({ code: textOf(f.file_code, f.filecode, f.code), title: textOf(f.title, f.name, f.file_title),
      uploaded: dayOf(textOf(f.uploaded, f.upload_date, f.created, f.file_created)) }))
      .filter((f) => /^[A-Za-z0-9]{8,20}$/.test(f.code)),
  };
}

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Title and year from a file or folder name: «Torrente.Presidente.2025.1080p.mkv» → Torrente Presidente, 2025. */
export function cleanTitle(name) {
  let s = String(name).replace(/\.(mkv|mp4|avi|mov|wmv|flv|m4v|mpg|mpeg|m2ts|ts|webm)$/i, '');
  const year = Number(` ${s} `.match(/[[(. _-]((?:19|20)\d{2})[\]). _-]/)?.[1]) || null;
  s = s.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, ' ').replace(/(?<=[a-z0-9])[._](?=[a-z0-9])/gi, ' ');
  s = s.replace(/\b(?:S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|cap(?:[ií]tulo)?[ .]?\d{1,4}|episodio \d+|temporada \d+|season \d+|(?:19|20)\d{2}|2160p|1080p|720p|480p|4k|uhd|hdtv|hdrip|bdrip|brrip|bluray|blu-ray|web-?dl|webrip|dvdrip|x26[45]|h ?26[45]|hevc|xvid|divx|aac|ac3|dts|5 1|castellano|espa[nñ]ol|spanish|latino|dual|vose|subs?|proper|repack|extended)\b.*$/iu, ' ');
  return { title: s.replace(/\s+[-–—]\s*$|^\s*[-–—]\s+/u, ' ').replace(/\s+/g, ' ').trim().replace(/^[-–—. ]+|[-–—. ]+$/g, ''), year };
}

/** Season and episode from a file name and its folder: 1x01, S01E01, Cap.101, «Temporada 2» + «Capítulo 5», «05». */
export function episodeOf(file, folder = '') {
  const name = String(file).replace(/\.(mkv|mp4|avi|mov|m4v|ts|webm)$/i, '');
  let m;
  if ((m = name.match(/S(\d{1,2})[ ._-]?E(\d{1,3})/i))) return [Number(m[1]), Number(m[2])];
  if ((m = name.match(/(?<!\d)(\d{1,2})x(\d{1,3})(?!\d)/i))) return [Number(m[1]), Number(m[2])];
  if ((m = name.match(/cap(?:[ií]tulo)?[ ._-]*(\d{3,4})(?!\d)/iu))) return [Math.floor(Number(m[1]) / 100), Number(m[1]) % 100];
  const season = Number(`${folder} ${name}`.match(/(?:temporada|season|\bT)[ ._-]*(\d{1,2})(?!\d)/i)?.[1]) || 1;
  if ((m = name.match(/(?:cap(?:[ií]tulo)?|episodio|episode|ep|\be)[ ._-]*(\d{1,3})(?!\d)/iu))) return [season, Number(m[1])];
  if ((m = name.match(/^\D{0,3}(\d{1,3})(?!\d)/)) && !/^(?:19|20)\d{2}/.test(name)) return [season, Number(m[1])];
  return null;
}

const SECTION_FOLDERS = { peliculas: 'movies', pelis: 'movies', movies: 'movies', series: 'series', documentales: 'documentaries', documentaries: 'documentaries' };
const link = (code) => `https://luluvido.com/${code}`;

/**
 * Walks the section folders. Films: every video under Peliculas (or straight in Documentales).
 * Series: every subfolder of Series (or of Documentales), with its season folders.
 */
export async function scanLulu(key, { fetcher, onFolder = () => {} } = {}) {
  resetLuluRoute(); // Each reading tries the direct route again first.
  const films = [], series = [], unknown = [], inventory = [];
  let folderCount = 0;
  const root = await luluFolder(0, key, fetcher);
  const sections = root.folders.map((f) => ({ ...f, section: SECTION_FOLDERS[plain(f.name).replace(/[^a-z]/g, '')] })).filter((f) => f.section);
  // Include empty/missing sections too: deleting the last video or the whole series must sync.
  for (const section of ['movies', 'series', 'documentaries']) inventory.push({ id: `lulu:library:${section}`, provider: 'lulu', section, links: [] });
  const videos = async (folder, bucket, depth = 0, ancestry = new Set()) => {
    if (depth > 8 || ++folderCount > 1000 || ancestry.has(folder.id)) throw Error('No se pudieron leer todas las carpetas de LuluStream. No se ha actualizado el catálogo.');
    onFolder(folder.name);
    const content = await luluFolder(folder.id, key, fetcher);
    bucket.links.push(...content.files.map(f => link(f.code)));
    // One folder at a time: dozens of requests at once filled the hosting and LuluStream stopped answering.
    const nested = [];
    const next = new Set(ancestry).add(folder.id);
    for (const f of content.folders) nested.push(await videos(f, bucket, depth + 1, next));
    return [...content.files.map((f) => ({ ...f, folder: folder.name })), ...nested.flat()];
  };
  for (const section of sections) {
    onFolder(section.name);
    const content = await luluFolder(section.id, key, fetcher);
    const bucket = inventory.find(source => source.section === section.section);
    bucket.links.push(...content.files.map(f => link(f.code)));
    if (section.section === 'movies') {
      const inside = [];
      for (const sub of content.folders) inside.push(...await videos(sub, bucket));
      for (const f of [...content.files, ...inside]) films.push({ section: 'movies', ...cleanTitle(f.title), file: f.title, link: link(f.code), uploaded: f.uploaded || '' });
      continue;
    }
    if (section.section === 'documentaries') for (const f of content.files) films.push({ section: 'documentaries', ...cleanTitle(f.title), file: f.title, link: link(f.code), uploaded: f.uploaded || '' });
    for (const show of content.folders) {
      const episodes = [];
      for (const f of await videos(show, bucket)) {
        const at = episodeOf(f.title, f.folder === show.name ? '' : f.folder);
        if (at) episodes.push({ season: at[0], episode: at[1], file: f.title, link: link(f.code), uploaded: f.uploaded || '' });
        else unknown.push(`${show.name} / ${f.title}: no se sabe qué capítulo es (usa 1x01 o S01E01 en el nombre)`);
      }
      if (episodes.length) series.push({ section: section.section, ...cleanTitle(show.name), folder: show.name, episodes });
    }
  }
  return { films, series, unknown, providers: ['lulu'], inventory, complete: true };
}

/** A search result is taken automatically only when its title is close to the file or folder name. */
export function confident(wanted, found) {
  const norm = (s) => plain(s).replace(/[^a-z0-9]+/g, '');
  const a = norm(wanted), b = norm(found);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const pairs = (s) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2));
  const pa = pairs(a), pb = pairs(b);
  const common = pa.filter((p) => { const i = pb.indexOf(p); if (i < 0) return false; pb.splice(i, 1); return true; }).length;
  return (2 * common) / (pa.length + pairs(b).length) >= 0.8;
}

async function bestMatch(title, year, kind, key, fetcher) {
  let found = await searchTmdb(title, kind, key, fetcher, year);
  if (!found.length && year) found = await searchTmdb(title, kind, key, fetcher); // A wrong year in the name.
  const sameYear = found.filter((r) => !year || !r.year || Math.abs(r.year - year) <= 1);
  return sameYear.find((r) => confident(title, r.title)) || (found[0] && confident(title, found[0].title) ? found[0] : null);
}

const titleKey = value => plain(decodeHtml(value || '')).replace(/[^a-z0-9]+/g, '');
const namedItem = (sections, wanted, kind) => {
  const candidates = Object.entries(sections).flatMap(([section, items]) => items
    .filter(item => item.kind === kind && titleKey(item.tmdb?.title || item.title) === titleKey(wanted.title)
      && (!wanted.year || !(item.tmdb?.year || item.year) || Number(wanted.year) === Number(item.tmdb?.year || item.year)))
    .map(item => ({ section, item })));
  return candidates.length === 1 ? candidates[0] : null;
};
/** A video's file name as a key (title and year), the same in Drive and LuluStream for the same film. */
export const fileKey = (name) => { const c = cleanTitle(name || ''), t = titleKey(c.title); return t ? t + (c.year || '') : ''; };
const linksOf = (item) => [item.url, ...(item.mirrors || [])].filter(Boolean).map(codeOf);
/**
 * A film with one more copy. Its own link found in a folder: the file name is remembered (to recognise
 * its twin in the other site). Another copy: kept as a spare only for a film whose link came from a
 * folder, the only kind that can be deleted there; links pasted by hand are left exactly as they are.
 */
const withCopy = (item, file, link) => {
  const own = !!link && codeOf(link) === codeOf(item.url);
  if (!own && !item.fromFolder) return item;
  const fk = fileKey(file);
  const files = [...new Set([...(item.files || []), ...(fk ? [fk] : [])])];
  const mirrors = [...new Set([...(item.mirrors || []), ...(link && !own ? [link] : [])])];
  const next = { ...item, files, mirrors, fromFolder: true };
  if (!files.length) delete next.files;
  if (!mirrors.length) delete next.mirrors;
  return next;
};
const folderId = (name) => `u${plain(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;

/** A film TMDB did not recognise: added with the file's name, to be matched later in the admin page. */
export const unmatchedFilm = (f) => ({ id: `u${codeOf(f.link)}`, kind: 'movie', title: f.title || f.file, year: f.year, file: f.file, url: f.link, status: 'unmatched' });
/** A series TMDB did not recognise: its folder name and episodes, to be matched later. */
export const unmatchedSeries = (s) => {
  const id = folderId(s.folder);
  return { id, kind: 'tv', title: s.title || s.folder, year: s.year, folder: s.folder, status: 'unmatched',
    episodes: s.episodes.map((e) => ({ id: `${id}x${e.season}x${e.episode}`, season: e.season, episode: e.episode, name: '', overview: '', still: '', file: '', url: e.link }))
      .sort((a, b) => a.season - b.season || a.episode - b.episode) };
};

/**
 * Gives a series the episode links [{ season, episode, link }] with TMDB's names, season by season. Links
 * already saved in those seasons stay unless a new one replaces them; episodes TMDB does not list are kept.
 */
export async function seriesWithLinks(item, info, links, key, fetcher) {
  for (const season of [...new Set(links.map((e) => e.season))].sort((a, b) => a - b)) {
    const mine = links.filter((e) => e.season === season);
    const known = await seasonEpisodes(info.id, season, key, fetcher).catch(() => []);
    const urls = Object.fromEntries((item?.episodes || []).filter((e) => e.season === season).map((e) => [e.episode, e.url]));
    for (const e of mine) urls[e.episode] = e.link;
    const list = [...known, ...Object.keys(urls).map(Number).filter((n) => !known.some((k) => k.episode === n)).map((n) => ({ episode: n, name: '', overview: '', still: '' }))];
    item = seriesWithSeason(item, info, season, list, urls);
  }
  return item;
}

/** A title without a TMDB record, matched by hand to TMDB's id: its links move to that record. */
export async function matchUnmatched(item, tmdbId, existing, key, fetcher = globalThis.fetch) {
  if (item.kind !== 'tv') {
    const { info } = await tmdbDetails(tmdbId, 'movie', key, fetcher);
    return { ...item, ...movieItem(info, item.url) };
  }
  const { info } = await tmdbDetails(tmdbId, 'tv', key, fetcher);
  const base = { ...item, ...existing, episodes: [...(existing?.episodes || []).filter(e => !item.episodes.some(old => old.season === e.season && old.episode === e.episode)), ...item.episodes] };
  const series = await seriesWithLinks(base, info, item.episodes.map((e) => ({ season: e.season, episode: e.episode, link: e.url })), key, fetcher);
  return { ...series, ...(Object.hasOwn(item, "trailerUrl") ? { trailerUrl: item.trailerUrl } : {}), folder: item.folder || existing?.folder || info.title };
}

/**
 * Adds what the scan found to the library: films and series matched in TMDB replace the same title,
 * other seasons and the titles added by hand are kept. Returns { sections, added, unknown }.
 */
export async function libraryFromScan(scan, current, key, { fetcher, onProgress = () => {}, skipDuplicates = false } = {}) {
  const skipped = { films: 0, episodes: 0 };
  const sections = Object.fromEntries(Object.entries(current).map(([k, items]) => [k, [...items]]));
  // Adopt pre-provenance imports before collecting their spare copies.
  if (skipDuplicates) for (const [section, items] of Object.entries(sections)) sections[section] = items.map(item => item.kind === 'tv'
    ? { ...item, episodes: (item.episodes || []).map(e => managedByScan(e, section, scan) ? { ...e, fromFolder: true } : e) }
    : managedByScan(item, section, scan) ? { ...item, fromFolder: true } : item);
  const put = (section, item) => {
    if (skipDuplicates) item = item.kind === 'tv'
      ? { ...item, episodes: item.episodes.map(e => managedByScan(e, section, scan) ? { ...e, fromFolder: true } : e) }
      : managedByScan(item, section, scan) ? { ...item, fromFolder: true } : item;
    const previous = Object.values(sections).flat().find((x) => x.id === item.id);
    if (previous && Object.hasOwn(previous, "trailerUrl")) item = { ...item, trailerUrl: previous.trailerUrl };
    for (const k of Object.keys(sections)) sections[k] = sections[k].filter((x) => x.id !== item.id);
    (sections[section] ||= []).push(item);
  };
  const find = (id) => Object.values(sections).flat().find((x) => x.id === id);
  const drop = (id) => { for (const k of Object.keys(sections)) sections[k] = sections[k].filter((x) => x.id !== id); };
  // Titles already matched (by the scan or by hand) are recognised by their links or their folder.
  const matched = Object.entries(sections).flatMap(([section, items]) => items.filter((x) => x.tmdb?.id && x.status !== 'unmatched').map((x) => ({ section, item: x })));
  const byLink = new Map(matched.flatMap(({ section, item }) => [item.url, ...(item.episodes || []).map((e) => e.url)].filter(Boolean).map((url) => [codeOf(url), { section, item }])));
  const byFolder = new Map(matched.filter(({ item }) => item.kind === 'tv' && item.folder).map((m) => [plain(decodeHtml(m.item.folder)), m]));
  const unknown = [...scan.unknown];
  let films = 0, shows = 0, episodes = 0, pending = 0, done = 0;
  const total = scan.films.length + scan.series.length;
  // The same film in Drive and in LuluStream is one title: the one already in the library (identified or not)
  // stays and the other copy is kept as a spare link, never offered again to be identified.
  const filmEntries = () => Object.entries(sections).flatMap(([section, items]) => items.filter((x) => x.kind !== 'tv').map((item) => ({ section, item })));
  const keepCopy = (entry, file, link) => {
    const list = sections[entry.section], at = list.indexOf(entry.item);
    if (at >= 0) list[at] = withCopy(entry.item, file, link);
  };
  const copyOf = (f) => {
    const fk = fileKey(f.file), code = codeOf(f.link);
    const hits = filmEntries().filter(({ item }) => linksOf(item).includes(code)
      || (fk && ((item.files || []).includes(fk) || (item.status === 'unmatched' && fileKey(item.file) === fk))));
    return hits.find(({ item }) => item.tmdb?.id && item.status !== 'unmatched') || hits[0] || null;
  };
  // First the file names of the copies the library already plays, so their twins are recognised.
  if (skipDuplicates) for (const f of scan.films) {
    const entry = filmEntries().find(({ item }) => linksOf(item).includes(codeOf(f.link)));
    if (entry) keepCopy(entry, f.file, f.link);
  }
  for (const f of scan.films) {
    onProgress(++done, total, f.title);
    const known = byLink.get(codeOf(f.link));
    const copy = skipDuplicates ? copyOf(f) || namedItem(sections, f, 'movie') : null;
    if (copy) {
      // A pending duplicate left by an earlier import goes; its link stays as a spare of the title.
      for (const e of filmEntries()) {
        if (e.item === copy.item || e.item.status !== 'unmatched') continue;
        if (linksOf(e.item).includes(codeOf(f.link)) || (fileKey(f.file) && fileKey(e.item.file) === fileKey(f.file))) {
          drop(e.item.id);
          keepCopy(filmEntries().find((x) => x.item.id === copy.item.id) || copy, e.item.file, e.item.url);
        }
      }
      keepCopy(filmEntries().find((x) => x.item.id === copy.item.id) || copy, f.file, f.link);
      skipped.films++; continue;
    }
    // The day LuluStream received the video is the day it arrived (for «Recién llegada»).
    const arrived = (item) => (f.uploaded ? { ...item, addedAt: f.uploaded } : item);
    if (known && known.item.kind !== 'tv') { put(known.section, arrived({ ...known.item, url: f.link })); films++; continue; }
    const match = await bestMatch(f.title, f.year, f.section === 'movies' ? 'movie' : 'any', key, fetcher);
    if (!match || match.kind !== 'movie') {
      put(f.section, arrived(unmatchedFilm(f))); pending++;
      unknown.push(`${f.file}: añadida sin ficha de TMDB como «${f.title || f.file}»`);
      continue;
    }
    if (skipDuplicates && find(`m${match.id}`)) {
      keepCopy(filmEntries().find((x) => x.item.id === `m${match.id}`), f.file, f.link);
      skipped.films++; continue;
    }
    const { info } = await tmdbDetails(match.id, 'movie', key, fetcher);
    drop(unmatchedFilm(f).id);
    put(f.section, arrived(movieItem(info, f.link)));
    films++;
  }
  // Older callers without complete folder inventories retain the historical mirror handling.
  if (skipDuplicates && !scan.complete) {
    const seen = new Set([...scan.films.map((f) => codeOf(f.link)), ...scan.series.flatMap((x) => x.episodes.map((e) => codeOf(e.link)))]);
    const provider = (code) => code.startsWith('drive_') ? 'drive' : /^[A-Za-z0-9]{8,20}$/.test(code) ? 'lulu' : '';
    const scanned = new Set(scan.providers || [...seen].map(provider).filter(Boolean));
    const gone = (link) => { const code = codeOf(link); return scanned.has(provider(code)) && !seen.has(code); };
    for (const { section, item } of filmEntries()) {
      if (!item.mirrors?.length) continue;
      const alive = item.mirrors.filter((l) => !gone(l));
      const next = item.fromFolder && gone(item.url) && alive.length ? { ...item, url: alive[0], mirrors: alive.slice(1) } : { ...item, mirrors: alive };
      if (!next.mirrors.length) delete next.mirrors;
      const list = sections[section]; list[list.indexOf(item)] = next;
    }
  }
  for (const s of scan.series) {
    onProgress(++done, total, s.title);
    let known = (skipDuplicates ? namedItem(sections, s, 'tv') : null) || byFolder.get(plain(s.folder)) || s.episodes.map((e) => byLink.get(codeOf(e.link))).find((m) => m?.item.kind === 'tv');
    if (skipDuplicates && known) {
      const latest = find(known.item.id) || known.item;
      const item = { ...latest, episodes: latest.episodes.map(e => s.episodes.filter(f => f.season === e.season && f.episode === e.episode)
        .reduce((old, f) => withCopy(old, f.file, f.link), e)) };
      put(known.section, item); known = { ...known, item };
    }
    let info = known?.item.tmdb;
    if (!info) {
      const match = await bestMatch(s.title, s.year, 'tv', key, fetcher);
      if (!match) {
        if (skipDuplicates && known) {
          const before = known.item;
          const missing = s.episodes.filter(e => !before.episodes.some(old => old.season === e.season && old.episode === e.episode));
          skipped.episodes += s.episodes.length - missing.length;
          if (missing.length) {
            const added = unmatchedSeries({ ...s, episodes: missing });
            put(known.section, { ...before, episodes: [...before.episodes, ...added.episodes].sort((a,b)=>a.season-b.season || a.episode-b.episode) });
            shows++; episodes += missing.length;
          }
          continue;
        }
        put(s.section, unmatchedSeries(s)); pending++;
        unknown.push(`${s.folder}: añadida sin ficha de TMDB (${s.episodes.length} capítulos)`);
        continue;
      }
      info = (await tmdbDetails(match.id, 'tv', key, fetcher)).info;
    }
    // Links pasted by hand stay; the folder adds or replaces its own episodes.
    let before = find(`s${info.id}`) || (skipDuplicates ? known?.item : null);
    if (skipDuplicates && before) {
      const section = Object.entries(sections).find(([, items]) => items.some(item => item.id === before.id))?.[0] || s.section;
      before = { ...before, episodes: before.episodes.map(e => s.episodes.filter(f => f.season === e.season && f.episode === e.episode)
        .reduce((old, f) => withCopy(old, f.file, f.link), e)) };
      put(section, before);
    }
    const incoming = skipDuplicates ? s.episodes.filter((e, i, list) => {
      const duplicate = before?.episodes?.some(old => old.season === e.season && old.episode === e.episode)
        || list.slice(0,i).some(old => old.season === e.season && old.episode === e.episode);
      if (duplicate) skipped.episodes++;
      return !duplicate;
    }) : s.episodes;
    if (skipDuplicates && !incoming.length) continue;
    const linked = await seriesWithLinks(before, info, incoming, key, fetcher);
    // Each episode arrived the day LuluStream received it (for «Nuevo episodio»).
    const uploads = new Map((skipDuplicates ? incoming : s.episodes).filter((e) => e.uploaded && codeOf(e.link)).map((e) => [codeOf(e.link), e.uploaded]));
    const item = linked && { ...linked, episodes: (linked.episodes || []).map(e => {
      let next = uploads.get(codeOf(e.url)) ? { ...e, addedAt: uploads.get(codeOf(e.url)) } : e;
      if (skipDuplicates && scan.complete) next = s.episodes.filter(f => f.season === e.season && f.episode === e.episode)
        .reduce((old, f) => withCopy(old, f.file, f.link), { ...next, fromFolder: true });
      return next;
    }) };
    // A series arrived with its first uploaded episode.
    const first = s.episodes.map((e) => e.uploaded).filter(Boolean).sort()[0];
    if (item?.episodes?.length) {
      drop(unmatchedSeries(s).id);
      put(known?.section || Object.entries(sections).find(([,items])=>items.some(x=>x.id===before?.id))?.[0] || s.section, { ...item, folder: s.folder, ...(first ? { addedAt: first } : {}) }); shows++; episodes += incoming.length;
    }
  }
  const reconciled = reconcileScan(sections, scan);
  for (const items of Object.values(reconciled.sections)) items.sort((a, b) => String(a.tmdb?.title || a.title).localeCompare(String(b.tmdb?.title || b.title), 'es', { sensitivity: 'base' }));
  return { ...reconciled, changed: JSON.stringify(reconciled.sections) !== JSON.stringify(current), added: { films, shows, episodes, pending }, unknown, ...(skipDuplicates ? { skipped } : {}) };
}
