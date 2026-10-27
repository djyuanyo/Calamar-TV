// Films, series and documentaries added by hand in the admin page: the title is chosen in TMDB (synopsis,
// cast, rating, images, seasons and episodes) and the administrator pastes the video link of each film or
// episode (LuluStream or any direct video). The library is published to Firestore (calamarLibrary).
export const TMDB_API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE = 'https://image.tmdb.org/t/p/';
export const ATTRIBUTION = 'Datos e imágenes de TMDB. Este producto usa la API de TMDB, pero TMDB no lo respalda ni certifica.';

async function tmdb(path, params, key, fetcher) {
  const bearer = key.includes('.'); // v4 read token (JWT) or v3 key
  const query = new URLSearchParams({ ...params, language: 'es-ES', ...(bearer ? {} : { api_key: key }) });
  let response;
  try { response = await fetcher(`${TMDB_API}${path}?${query}`, { referrerPolicy: 'no-referrer', ...(bearer ? { headers: { Authorization: `Bearer ${key}` } } : {}) }); }
  catch { throw new Error('Sin conexión con TMDB. Comprueba la red y vuelve a intentarlo.'); }
  if (response.status === 401) throw new Error('TMDB no acepta la clave. Revísala en Pelis y series → Configuración.');
  const data = await response.json().catch(() => null);
  if (response.status !== 200 || !data) throw new Error('TMDB no responde ahora. Vuelve a intentarlo.');
  return data;
}
export const checkTmdbKey = (key, fetcher = globalThis.fetch) => tmdb('/configuration', {}, key, fetcher);
const image = (path, size) => path ? `${TMDB_IMAGE}${size}${path}` : '';
const yearOf = (date) => date ? Number(String(date).slice(0, 4)) || null : null;

/** Films ('movie'), series ('tv') or both ('any', for documentaries): [{ id, kind, title, year, poster, overview }]. */
export async function searchTmdb(query, kind, key, fetcher = globalThis.fetch, year = null) {
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
  const d = await tmdb(`/${kind}/${Number(id)}`, { append_to_response: 'credits' }, key, fetcher);
  const info = { id: Number(id), kind, title: d.title || d.name || '', year: yearOf(d.release_date || d.first_air_date), overview: d.overview || '',
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

/** The episodes of one season: [{ episode, name, overview, still }]. */
export async function seasonEpisodes(id, season, key, fetcher = globalThis.fetch) {
  const d = await tmdb(`/tv/${Number(id)}/season/${Number(season)}`, {}, key, fetcher);
  return (d.episodes || []).map((e) => ({ episode: e.episode_number, name: e.name || '', overview: (e.overview || '').slice(0, 300), still: image(e.still_path, 'w300') }));
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
    id: `e${info.id}x${season}x${e.episode}`, season, episode: e.episode, name: e.name, overview: e.overview, still: e.still, file: '', url: String(links[e.episode]).trim() }));
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
