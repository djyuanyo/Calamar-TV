// Reads the administrator's LuluStream folders with its API and matches each video with TMDB:
//   Peliculas/<one video per film>          Documentales/<one video per documentary>
//   Series/<Name>/Temporada N/<episodes>     Documentales/<Name>/Temporada N/<episodes>
// The key lives only in the admin-only settings; when the browser cannot call the API directly
// (CORS), the request goes through the hosting (calamar-lulu.php), which only relays the JSON.
import { LULU_ENDPOINT, lulustreamEmbed } from './catalog.js';
import { searchTmdb, tmdbDetails, seasonEpisodes, movieItem, seriesWithSeason } from './library-tmdb.js';

export const LULU_API = 'https://api.lulustream.com/api/';

function luluResult(data) {
  if (!data || typeof data !== 'object') throw new Error('LuluStream no ha respondido con datos.');
  if (Number(data.status) !== 200) throw new Error(/auth/i.test(data.msg || '') ? 'LuluStream no acepta la clave de la API. Revísala en «Configuración».' : `LuluStream: ${data.msg || `error ${data.status}`}`);
  return data.result ?? {};
}

/** One API call: straight from the browser, or through the hosting when the browser is not allowed to. */
export async function luluApi(action, params, key, fetcher = globalThis.fetch) {
  const query = new URLSearchParams({ ...params, key });
  let data;
  try {
    const response = await fetcher(`${LULU_API}${action}?${query}`, { referrerPolicy: 'no-referrer' });
    data = await response.json();
  } catch {
    let response;
    try {
      response = await fetcher(LULU_ENDPOINT, { method: 'POST', body: new URLSearchParams({ api: action, ...params, key }), referrerPolicy: 'no-referrer' });
    } catch { throw new Error('Sin conexión con LuluStream ni con el hosting. Comprueba la red y que calamar-lulu.php está subido.'); }
    data = await response.json().catch(() => null);
    if (!data) throw new Error(`El hosting no ha podido consultar LuluStream (HTTP ${response.status}).`);
    if (data.error) throw new Error(data.error);
  }
  return luluResult(data);
}

const textOf = (...values) => String(values.find((v) => v != null && v !== '') ?? '');

/** A folder's subfolders and videos: { folders: [{ id, name }], files: [{ code, title }] }. */
export async function luluFolder(id, key, fetcher) {
  const result = await luluApi('folder/list', { fld_id: String(id), files: '1' }, key, fetcher);
  return {
    folders: (result.folders || []).map((f) => ({ id: textOf(f.fld_id, f.id), name: textOf(f.name, f.title) })).filter((f) => f.id),
    files: (result.files || []).map((f) => ({ code: textOf(f.file_code, f.filecode, f.code), title: textOf(f.title, f.name, f.file_title) }))
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
const link = (code) => `https://lulustream.com/${code}`;

/**
 * Walks the section folders. Films: every video under Peliculas (or straight in Documentales).
 * Series: every subfolder of Series (or of Documentales), with its season folders.
 */
export async function scanLulu(key, { fetcher, onFolder = () => {} } = {}) {
  const films = [], series = [], unknown = [];
  const root = await luluFolder(0, key, fetcher);
  const sections = root.folders.map((f) => ({ ...f, section: SECTION_FOLDERS[plain(f.name).replace(/[^a-z]/g, '')] })).filter((f) => f.section);
  if (!sections.length) throw new Error(`No hay carpetas «Peliculas», «Series» o «Documentales» en LuluStream (encontradas: ${root.folders.map((f) => f.name).join(', ') || 'ninguna'}).`);
  const videos = async (folder, depth = 0) => {
    onFolder(folder.name);
    const content = await luluFolder(folder.id, key, fetcher);
    const nested = depth < 2 ? await Promise.all(content.folders.map((f) => videos(f, depth + 1))) : [];
    return [...content.files.map((f) => ({ ...f, folder: folder.name })), ...nested.flat()];
  };
  for (const section of sections) {
    onFolder(section.name);
    const content = await luluFolder(section.id, key, fetcher);
    if (section.section === 'movies') {
      for (const f of [...content.files, ...(await Promise.all(content.folders.map((sub) => videos(sub)))).flat()]) films.push({ section: 'movies', ...cleanTitle(f.title), file: f.title, link: link(f.code) });
      continue;
    }
    if (section.section === 'documentaries') for (const f of content.files) films.push({ section: 'documentaries', ...cleanTitle(f.title), file: f.title, link: link(f.code) });
    for (const show of content.folders) {
      const episodes = [];
      for (const f of await videos(show)) {
        const at = episodeOf(f.title, f.folder === show.name ? '' : f.folder);
        if (at) episodes.push({ season: at[0], episode: at[1], file: f.title, link: link(f.code) });
        else unknown.push(`${show.name} / ${f.title}: no se sabe qué capítulo es (usa 1x01 o S01E01 en el nombre)`);
      }
      if (episodes.length) series.push({ section: section.section, ...cleanTitle(show.name), folder: show.name, episodes });
    }
  }
  return { films, series, unknown };
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

const codeOf = (url) => lulustreamEmbed(String(url || ''))?.split('/').pop() || '';
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
    return movieItem(info, item.url);
  }
  const { info } = await tmdbDetails(tmdbId, 'tv', key, fetcher);
  const series = await seriesWithLinks(existing, info, item.episodes.map((e) => ({ season: e.season, episode: e.episode, link: e.url })), key, fetcher);
  return { ...series, folder: item.folder || existing?.folder || info.title };
}

/**
 * Adds what the scan found to the library: films and series matched in TMDB replace the same title,
 * other seasons and the titles added by hand are kept. Returns { sections, added, unknown }.
 */
export async function libraryFromScan(scan, current, key, { fetcher, onProgress = () => {} } = {}) {
  const sections = Object.fromEntries(Object.entries(current).map(([k, items]) => [k, [...items]]));
  const put = (section, item) => {
    for (const k of Object.keys(sections)) sections[k] = sections[k].filter((x) => x.id !== item.id);
    (sections[section] ||= []).push(item);
  };
  const find = (id) => Object.values(sections).flat().find((x) => x.id === id);
  const drop = (id) => { for (const k of Object.keys(sections)) sections[k] = sections[k].filter((x) => x.id !== id); };
  // Titles already matched (by the scan or by hand) are recognised by their links or their folder.
  const matched = Object.entries(sections).flatMap(([section, items]) => items.filter((x) => x.tmdb?.id && x.status !== 'unmatched').map((x) => ({ section, item: x })));
  const byLink = new Map(matched.flatMap(({ section, item }) => [item.url, ...(item.episodes || []).map((e) => e.url)].filter(Boolean).map((url) => [codeOf(url), { section, item }])));
  const byFolder = new Map(matched.filter(({ item }) => item.kind === 'tv' && item.folder).map((m) => [plain(m.item.folder), m]));
  const unknown = [...scan.unknown];
  let films = 0, shows = 0, episodes = 0, pending = 0, done = 0;
  const total = scan.films.length + scan.series.length;
  for (const f of scan.films) {
    onProgress(++done, total, f.title);
    const known = byLink.get(codeOf(f.link));
    if (known && known.item.kind !== 'tv') { put(known.section, { ...known.item, url: f.link }); films++; continue; }
    const match = await bestMatch(f.title, f.year, f.section === 'movies' ? 'movie' : 'any', key, fetcher);
    if (!match || match.kind !== 'movie') {
      put(f.section, unmatchedFilm(f)); pending++;
      unknown.push(`${f.file}: añadida sin ficha de TMDB como «${f.title || f.file}»`);
      continue;
    }
    const { info } = await tmdbDetails(match.id, 'movie', key, fetcher);
    drop(unmatchedFilm(f).id);
    put(f.section, movieItem(info, f.link));
    films++;
  }
  for (const s of scan.series) {
    onProgress(++done, total, s.title);
    const known = byFolder.get(plain(s.folder)) || s.episodes.map((e) => byLink.get(codeOf(e.link))).find((m) => m?.item.kind === 'tv');
    let info = known?.item.tmdb;
    if (!info) {
      const match = await bestMatch(s.title, s.year, 'tv', key, fetcher);
      if (!match) {
        put(s.section, unmatchedSeries(s)); pending++;
        unknown.push(`${s.folder}: añadida sin ficha de TMDB (${s.episodes.length} capítulos)`);
        continue;
      }
      info = (await tmdbDetails(match.id, 'tv', key, fetcher)).info;
    }
    // Links pasted by hand stay; the folder adds or replaces its own episodes.
    const item = await seriesWithLinks(find(`s${info.id}`), info, s.episodes, key, fetcher);
    if (item?.episodes?.length) {
      drop(unmatchedSeries(s).id);
      put(known?.section || s.section, { ...item, folder: s.folder }); shows++; episodes += s.episodes.length;
    }
  }
  for (const k of Object.keys(sections)) sections[k].sort((a, b) => String(a.tmdb?.title || a.title).localeCompare(String(b.tmdb?.title || b.title), 'es', { sensitivity: 'base' }));
  return { sections, added: { films, shows, episodes, pending }, unknown };
}
