// Films, series and documentaries added by hand in the admin page: the title is chosen in TMDB (synopsis,
// cast, rating, images, seasons and episodes) and the administrator pastes the video link of each film or
// episode (LuluStream or any direct video). The library is published to Firestore (calamarLibrary).
export const TMDB_API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p/';
export const ATTRIBUTION = 'Datos e imágenes de TMDB. Este producto usa la API de TMDB, pero TMDB no lo respalda ni certifica.';

// Each request gives up after a while and is tried once more, so a TMDB request that never answers (or a
// «too many requests») does not leave «Buscando en TMDB…» on screen forever.
export const TMDB_TIMEOUT_MS = 20000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function tmdb(path, params, key, fetcher, attempt = 1) {
  const bearer = key.includes('.'); // v4 read token (JWT) or v3 key
  const query = new URLSearchParams({ ...params, language: 'es-ES', ...(bearer ? {} : { api_key: key }) });
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(TMDB_TIMEOUT_MS) } : {};
  let response, data;
  try {
    response = await fetcher(`${TMDB_API}${path}?${query}`, { referrerPolicy: 'no-referrer', ...signal, ...(bearer ? { headers: { Authorization: `Bearer ${key}` } } : {}) });
    data = await response.json().catch(() => null);
  } catch (error) {
    if (attempt < 2) { await wait(1500); return tmdb(path, params, key, fetcher, attempt + 1); }
    const late = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new Error(late ? 'TMDB no responde. Vuelve a intentarlo en un rato.' : 'Sin conexión con TMDB. Comprueba la red y vuelve a intentarlo.');
  }
  if (response.status === 401) throw new Error('TMDB no acepta la clave. Revísala en Pelis y series → Configuración.');
  if ((response.status === 429 || response.status >= 500) && attempt < 2) { await wait(response.status === 429 ? 3000 : 1500); return tmdb(path, params, key, fetcher, attempt + 1); }
  if (response.status !== 200 || !data) throw new Error('TMDB no responde ahora. Vuelve a intentarlo.');
  return data;
}
export const checkTmdbKey = (key, fetcher = globalThis.fetch) => tmdb('/configuration', {}, key, fetcher);
const image = (path, size) => path ? `${TMDB_IMAGE}${size}${path}` : '';
const yearOf = (date) => date ? Number(String(date).slice(0, 4)) || null : null;

/** A public TMDB record URL (its slug/language are optional); only its type and numeric id are used. */
export function tmdbReference(value) {
  const text = String(value || '').trim();
  try {
    const u = new URL(/^(?:www\.)?themoviedb\.org\//i.test(text) ? `https://${text}` : text);
    if (!['https:', 'http:'].includes(u.protocol) || !['themoviedb.org', 'www.themoviedb.org'].includes(u.hostname)
        || u.username || u.password || u.port) return null;
    const match = u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(movie|tv)\/([1-9]\d*)(?:-[^/]+)?\/?$/i);
    if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
    return { id: Number(match[2]), kind: match[1].toLowerCase() };
  } catch { return null; }
}

/** Films ('movie'), series ('tv') or both ('any', for documentaries): [{ id, kind, title, year, poster, overview }]. */
export async function searchTmdb(query, kind, key, fetcher = globalThis.fetch, year = null) {
  const reference = tmdbReference(query);
  if (reference) {
    if (kind !== 'any' && reference.kind !== kind)
      throw new Error(`El enlace corresponde a ${reference.kind === 'tv' ? 'una serie' : 'una película'}. Elige una ficha de ${kind === 'tv' ? 'serie' : 'película'} para este elemento.`);
    const d = await tmdb(`/${reference.kind}/${reference.id}`, {}, key, fetcher);
    return [{ id: reference.id, kind: reference.kind, title: d.title || d.name || '', year: yearOf(d.release_date || d.first_air_date),
      poster: image(d.poster_path, 'w185'), overview: (d.overview || '').slice(0, 220) }];
  }
  if (/^(?:https?:\/\/|(?:www\.)?themoviedb\.org\/)/i.test(String(query).trim()))
    throw new Error('Pega el enlace de una ficha de themoviedb.org/movie/… o themoviedb.org/tv/….');
  const path = kind === 'tv' ? '/search/tv' : kind === 'movie' ? '/search/movie' : '/search/multi';
  const dated = year && kind !== 'any' ? { [kind === 'tv' ? 'first_air_date_year' : 'year']: String(year) } : {};
  const data = await tmdb(path, { query, include_adult: 'false', ...dated }, key, fetcher);
  return (data.results || [])
    .map((r) => ({ ...r, media_type: r.media_type || kind }))
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, 12)
    .map((r) => ({ id: r.id, kind: r.media_type, title: r.title || r.name || '', year: yearOf(r.release_date || r.first_air_date),
      poster: image(r.poster_path, 'w185'), overview: (r.overview || '').slice(0, 220) }));
}

/** A film's or series' details in Spanish; for series also its seasons [{ season, name, episodes }]. */
export async function tmdbDetails(id, kind, key, fetcher = globalThis.fetch) {
  const d = await tmdb(`/${kind}/${Number(id)}`, { append_to_response: 'credits,watch/providers,videos', include_video_language: 'es' }, key, fetcher);
  const info = { id: Number(id), kind, trailer: trailerOf(d), creators: creatorsOf(d), ...(lastEpisodeOf(d) ? { lastEpisode: lastEpisodeOf(d) } : {}), title: d.title || d.name || '', year: yearOf(d.release_date || d.first_air_date), overview: d.overview || '',
    released: d.release_date || d.first_air_date || '', providers: providersOf(d), logos: providerLogosOf(d), countries: countriesOf(d), language: d.original_language || '',
    genres: (d.genres || []).map((g) => g.name), cast: (d.credits?.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: c.character || '' })),
    rating: d.vote_average != null ? Math.round(d.vote_average * 10) / 10 : null, votes: d.vote_count || 0,
    runtime: d.runtime || d.episode_run_time?.[0] || null, poster: image(d.poster_path, 'w342'), backdrop: image(d.backdrop_path, 'w1280') };
  const seasons = kind === 'tv' ? (d.seasons || []).map((s) => ({ season: s.season_number, name: s.name || `Temporada ${s.season_number}`, episodes: s.episode_count || 0 }))
    .sort((a, b) => (a.season === 0) - (b.season === 0) || a.season - b.season) : [];
  return { info, seasons };
}

/** TMDB's trending films and series of the week, most trending first: [{ id, kind }] (up to 100). */
export async function tmdbTrending(key, fetcher = globalThis.fetch, pages = 5) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const data = await tmdb('/trending/all/week', { page: String(page) }, key, fetcher);
    for (const r of data.results || []) if (r.media_type === 'movie' || r.media_type === 'tv') out.push({ id: r.id, kind: r.media_type });
    if (page >= (data.total_pages || 1)) break;
  }
  return out;
}

/** How popular a film or series is on TMDB today (its `popularity`). */
export async function tmdbPopularity(id, kind, key, fetcher = globalThis.fetch) {
  return Number((await tmdb(`/${kind}/${Number(id)}`, {}, key, fetcher)).popularity) || 0;
}

/** Popularity, release date and the platforms where it can be watched in Spain, in one request. */
export async function tmdbFacts(id, kind, key, fetcher = globalThis.fetch) {
  const d = await tmdb(`/${kind}/${Number(id)}`, { append_to_response: 'watch/providers,videos,credits', include_video_language: 'es' }, key, fetcher);
  return { popularity: Number(d.popularity) || 0, released: d.release_date || d.first_air_date || '', providers: providersOf(d),
    logos: providerLogosOf(d), countries: countriesOf(d), language: d.original_language || '', trailer: trailerOf(d), creators: creatorsOf(d), lastEpisode: lastEpisodeOf(d) };
}

/** The logo of each of those platforms (TMDB's square icons): { «Netflix»: «https://image.tmdb.org/…» }. */
export function providerLogosOf(details) {
  const es = details?.['watch/providers']?.results?.ES || {};
  const names = new Set(providersOf(details));
  const out = {};
  for (const p of [...(es.flatrate || []), ...(es.free || []), ...(es.ads || [])]) {
    const name = String(p.provider_name || '').trim();
    if (names.has(name) && !out[name] && /^\/[\w.-]+$/.test(p.logo_path || '')) out[name] = `https://image.tmdb.org/t/p/w154${p.logo_path}`;
  }
  return out;
}

/** A series' last aired episode (TMDB): { season, episode, aired: YYYY-MM-DD }, or null. */
export function lastEpisodeOf(details) {
  const e = details?.last_episode_to_air;
  return e && /^\d{4}-\d{2}-\d{2}$/.test(e.air_date || '') && e.season_number >= 0 && e.episode_number > 0
    ? { season: e.season_number, episode: e.episode_number, aired: e.air_date } : null;
}

/** The YouTube key of the title's trailer in Spanish (Spain first, then any Spanish), or ''. */
export function trailerOf(details) {
  const videos = (details?.videos?.results || []).filter((v) => v?.site === 'YouTube' && v.iso_639_1 === 'es' && /^[\w-]{11}$/.test(v.key || ''));
  const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 4) + (v.iso_3166_1 === 'ES' ? 0 : 1) + (v.official === false ? 1 : 0);
  return videos.sort((a, b) => rank(a) - rank(b))[0]?.key || '';
}

/** «Creada por» (series) or «Dirigida por» (films): up to four names. */
export function creatorsOf(details) {
  const names = details?.created_by?.length ? details.created_by.map((c) => c?.name)
    : (details?.credits?.crew || []).filter((c) => c?.job === 'Director').map((c) => c.name);
  return [...new Set(names.filter((n) => typeof n === 'string' && n.trim()))].slice(0, 4);
}

/** Where a title was made (ISO codes: «ES», «US»…), for the «Películas españolas» row. */
export function countriesOf(details) {
  const codes = [...(details?.production_countries || []).map((c) => c?.iso_3166_1), ...(details?.origin_country || [])];
  return [...new Set(codes.filter((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)))].slice(0, 6);
}

/** The streaming platforms of a title in Spain (subscription, free or with ads), by TMDB's watch providers. */
export function providersOf(details) {
  const es = details?.['watch/providers']?.results?.ES || {};
  const names = [...(es.flatrate || []), ...(es.free || []), ...(es.ads || [])].map((p) => String(p.provider_name || '').trim()).filter(Boolean);
  return [...new Set(names)].slice(0, 8);
}

/**
 * The day each title arrived in the library (`addedAt`, YYYY-MM-DD): titles new in this publication get today,
 * the others keep theirs. Titles from before this existed have none and are never «Recién llegada».
 */
export function stampAdded(next, before, today = new Date().toISOString().slice(0, 10)) {
  const known = new Map(Object.values(before || {}).flat().map((item) => [item.id, item]));
  return Object.fromEntries(Object.entries(next).map(([section, items]) => [section, items.map((item) => {
    const old = known.get(item.id);
    const stamped = item.addedAt ? item : old ? (old.addedAt ? { ...item, addedAt: old.addedAt } : item) : { ...item, addedAt: today };
    return old && item.episodes?.length ? { ...stamped, episodes: stampEpisodes(item.episodes, old.episodes || [], today) } : stamped;
  })]));
}

/**
 * The day each episode of a series already in the library arrived (for «Nuevo episodio»): an episode new
 * in this publication gets today, the others keep theirs (episodes from before this existed have none).
 */
export function stampEpisodes(episodes, before, today) {
  const known = new Map(before.map((e) => [e.id, e]));
  return episodes.map((e) => {
    if (e.addedAt) return e;
    const old = known.get(e.id);
    if (old) return old.addedAt ? { ...e, addedAt: old.addedAt } : e;
    return { ...e, addedAt: today };
  });
}

/** The episodes of one season: [{ episode, name, overview, still }]. */
export async function seasonEpisodes(id, season, key, fetcher = globalThis.fetch) {
  const d = await tmdb(`/tv/${Number(id)}/season/${Number(season)}`, {}, key, fetcher);
  return (d.episodes || []).map((e) => ({ episode: e.episode_number, name: e.name || '', overview: (e.overview || '').slice(0, 300), still: image(e.still_path, 'w300'),
    ...(e.runtime > 0 ? { runtime: e.runtime } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(e.air_date || '') ? { aired: e.air_date } : {}) }));
}

/** The library item of a film (or documentary film) with its video link. */
export const movieItem = (info, url) => ({ id: `m${info.id}`, kind: 'movie', title: info.title, year: info.year, file: '', url, status: 'matched', tmdb: info });

/**
 * A series with the links of one season saved: episodes of other seasons are kept, episodes of this season
 * take the new links, and an episode without a link is left out (it is not shown to viewers).
 */
export function seriesWithSeason(existing, info, season, episodes, links) {
  const others = (existing?.episodes || []).filter((e) => e.season !== season);
  const now = episodes.filter((e) => String(links[e.episode] || '').trim()).map((e) => ({
    id: `e${info.id}x${season}x${e.episode}`, season, episode: e.episode, name: e.name, overview: e.overview, still: e.still, ...(e.runtime ? { runtime: e.runtime } : {}), ...(e.aired ? { aired: e.aired } : {}), file: '', url: String(links[e.episode]).trim() }));
  const all = [...others, ...now].sort((a, b) => a.season - b.season || a.episode - b.episode);
  // Anything else saved with the series (its LuluStream folder, the intro and credits times) stays.
  return { ...(existing || {}), id: `s${info.id}`, kind: 'tv', title: info.title, year: info.year, folder: existing?.folder || info.title, status: 'matched', tmdb: info, episodes: all };
}

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
