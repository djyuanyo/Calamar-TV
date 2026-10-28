// Films, series and documentaries chosen in TMDB by the administrator, each with its video link
// (LuluStream or a direct video), with synopsis, genres, cast, rating and posters from TMDB. The administrator shows or hides the whole catalog (catalog field
// `libraryVisible`); while hidden the menu does not offer it. Published by the admin page to Firestore (calamarLibrary: an index and parts), read here without
// signing in; the videos play from Google Drive. Nothing depends on the hosting.
import { firebaseConfig } from './firebase-config.js';
import { searchTmdb, tmdbDetails, seasonEpisodes, movieItem, seriesWithSeason, libraryParts, checkTmdbKey, tmdbTrending, tmdbFacts, stampAdded } from './library-tmdb.js';
import { luluFolder, scanLulu, libraryFromScan, matchUnmatched } from './library-lulu.js';
import { lulustreamEmbed, webPlayback, LULU_ENDPOINT } from './catalog.js';
import { madridDay } from './audience.js';

export const LIBRARY_DOCS = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/calamarLibrary/`;
export const LIBRARY_SECTIONS = [
  { key: 'movies', page: 'peliculas', label: 'Películas', one: 'película' },
  { key: 'series', page: 'series', label: 'Series', one: 'serie' },
  { key: 'documentaries', page: 'documentales', label: 'Documentales', one: 'documental' },
];
export const sectionByPage = (page) => LIBRARY_SECTIONS.find((s) => s.page === page) || null;
export const libraryVisible = (custom) => custom?.libraryVisible === true;

let cached = null, cachedAt = 0;
/** The published library; kept for two minutes so moving between pages does not download it again. */
export async function fetchLibrary({ fresh = false, fetcher = globalThis.fetch } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < 120000) return cached;
  const part = async (name) => {
    let response;
    try { response = await fetcher(`${LIBRARY_DOCS}${name}?key=${firebaseConfig.apiKey}`, { cache: fresh ? 'no-store' : 'default', referrerPolicy: 'no-referrer' }); }
    catch { throw new Error('No se pudieron cargar las películas y series. Comprueba la conexión y vuelve a intentarlo.'); }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('No se pudieron cargar las películas y series. Vuelve a intentarlo en unos minutos.');
    return JSON.parse((await response.json()).fields.json.stringValue);
  };
  const index = await part('index');
  const sections = {};
  if (index) await Promise.all(Object.entries(index.sections || {}).map(async ([section, count]) => {
    const parts = await Promise.all(Array.from({ length: count }, (_, n) => part(`${section}-${n}`)));
    sections[section] = parts.flatMap((p) => p?.items || []);
  }));
  cached = { sections, attribution: index?.attribution || '', updatedAt: index?.updatedAt || '' };
  cachedAt = Date.now();
  return cached;
}

/** The library as last downloaded (or null): the home page draws with it and asks for it in the background. */
export const cachedLibrary = () => cached;

export const itemTitle = (item) => item.tmdb?.title || item.title;
export const itemYear = (item) => item.tmdb?.year || item.year || '';
const norm = (s) => String(s).toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
// «1x01» in the file name is season 1, episode 1: it is shown as «Capítulo 1» of «Temporada 1».
export const episodeLabel = (e) => `Capítulo ${e.episode}`;
/** The episode's name from TMDB when it has one; otherwise «Capítulo N». */
export const episodeTitle = (e) => e.name || episodeLabel(e);
export const seasonLabel = (e) => `Temporada ${e.season}`;
export const episodePath = (section, item, e) => `#/${section.page}/${encodeURIComponent(item.id)}/capitulo/${encodeURIComponent(e.id)}`;
/** The next episode of the series (episodes come in season and episode order), or null after the last. */
export function nextEpisode(item, episode) {
  const list = item.episodes || [];
  const i = list.findIndex((e) => e.id === episode.id);
  return i >= 0 ? list[i + 1] || null : null;
}

// ---- Saltar intro y siguiente capítulo --------------------------------------------------------------
// Set once per series in the admin page (and per season when one differs): item.skip =
// { intro: [start, end], credits: seconds, seasons: { "2": { intro, credits } } }, all in seconds.
export const CREDITS_DEFAULT = 30;
/** The intro [start, end] (or null) and the credits' length of an episode: its season's, else the series'. */
// Times typed in the admin page win; without them the player asks TheIntroDB (community timestamps per
// episode, by TMDB id): { manualIntro, manualCredits } say which ones were typed.
export function skipMarks(item, episode) {
  const skip = item?.skip || {}, season = skip.seasons?.[episode?.season] || {};
  const intro = season.intro || skip.intro;
  const credits = Number(season.credits ?? skip.credits);
  const validIntro = Array.isArray(intro) && intro[1] > intro[0] && intro[0] >= 0;
  return { intro: validIntro ? intro : null, credits: credits > 0 ? credits : CREDITS_DEFAULT, creditsAt: null,
    manualIntro: validIntro, manualCredits: credits > 0 };
}
/** Which button the player shows at second t: «Saltar intro», «Siguiente capítulo» or none. */
export function skipButton(marks, t, duration, hasNext) {
  if (!marks || !Number.isFinite(t)) return null;
  if (marks.intro && t >= marks.intro[0] && t < marks.intro[1] - 1) return 'intro';
  if (!hasNext || !Number.isFinite(duration) || duration - t <= 0.5) return null;
  // Where TheIntroDB says the credits start; otherwise the last seconds set for the series (30 by default).
  if (marks.creditsAt != null && marks.creditsAt < duration - 5) return t >= marks.creditsAt ? 'next' : null;
  return duration > marks.credits * 2 && duration - t <= marks.credits ? 'next' : null;
}

export const INTRODB_API = 'https://api.theintrodb.org/v4/media';
/** TheIntroDB's answer as { intro: [start, end] | null, creditsAt: seconds | null }. */
export function introDbMarks(data) {
  const first = (list) => (Array.isArray(list) ? list : []).find((s) => Number.isFinite(s?.start_ms));
  const intro = first(data?.intro), credits = first(data?.credits);
  return { intro: intro && Number.isFinite(intro.end_ms) && intro.end_ms > intro.start_ms ? [intro.start_ms / 1000, intro.end_ms / 1000] : null,
    creditsAt: credits && credits.start_ms > 0 ? credits.start_ms / 1000 : null };
}
/** The episode's marks with TheIntroDB's where none were typed; the same marks when it has nothing. */
export async function withIntroDb(marks, source, fetcher = globalThis.fetch) {
  if (!marks || !source?.tmdb || (marks.manualIntro && marks.manualCredits)) return marks;
  try {
    const query = new URLSearchParams({ tmdb_id: String(source.tmdb), season: String(source.season), episode: String(source.episode) });
    const ask = (url) => fetcher(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(8000) });
    // Straight from the browser, or through the hosting when TheIntroDB does not allow it (a few hundred bytes).
    const response = await ask(`${INTRODB_API}?${query}`).catch(() => ask(`${LULU_ENDPOINT}?introdb=1&${query}`));
    if (!response.ok) return marks;
    const found = introDbMarks(await response.json());
    return { ...marks, intro: marks.manualIntro ? marks.intro : found.intro || marks.intro, creditsAt: marks.manualCredits ? null : found.creditsAt };
  } catch { return marks; }
}
/** «1:45» → 105, «1:02:03» → 3723, «90» → 90, empty → null; anything else → NaN. */
export function parseClock(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):([0-5]\d)$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}
/** 105 → «1:45», 3723 → «1:02:03». */
export function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** What the player needs to play a film or an episode (the same player as the channels). */
export function playable(section, item, episode = null) {
  const target = episode || item, info = item.tmdb || {};
  return { id: target.id, libraryId: item.id, name: episode ? `${itemTitle(item)} · T${episode.season} · ${episodeTitle(episode)}` : itemTitle(item),
    streams: [target.url], playable: true, vod: true, logo: '', group: section.label, region: '',
    path: `#/${section.page}/${encodeURIComponent(item.id)}/ver${episode ? `/${encodeURIComponent(episode.id)}` : ''}`,
    // Saved in «Continuar viendo»: enough to draw its card and come back without the library.
    progress: { key: target.id, page: section.page, item: item.id, episode: episode?.id || '',
      name: itemTitle(item), sub: episode ? `${seasonLabel(episode)} · ${episodeTitle(episode)}` : String(itemYear(item) || section.label),
      image: episode?.still || info.backdrop || info.poster || '' },
    skip: episode ? skipMarks(item, episode) : null, hasNext: !!(episode && nextEpisode(item, episode)),
    skipSource: episode && item.tmdb?.id && item.status !== 'unmatched' ? { tmdb: item.tmdb.id, season: episode.season, episode: episode.episode } : null,
    next: episode ? () => { const n = nextEpisode(item, episode); return n ? playable(section, item, n) : null; } : null };
}

// ---- Continuar viendo --------------------------------------------------------------------------
// Kept in this browser (localStorage): where each film or episode was left. One entry per series (the
// last episode watched), the 20 most recent, and gone once it has been watched. With a signed-in
// account it is also kept in Firestore (progress-sync.js), so every device of that account shows the
// same row: what this browser removes is remembered for a while (PROGRESS_REMOVED), so another
// device does not bring it back.
export const PROGRESS_STORAGE = 'calamar-progress-v1';
export const PROGRESS_REMOVED = 'calamar-progress-removed-v1';
export const PROGRESS_LIMIT = 20;
export const finished = (position, duration) => Number.isFinite(duration) && duration >= 300 && position / duration >= 0.95;

export function recordProgress(store, entry, position, duration, now = Date.now()) {
  const next = { ...store };
  if (!entry?.key || !(position >= 10)) return next;
  for (const [key, saved] of Object.entries(next)) if (key !== entry.key && saved.page === entry.page && saved.item === entry.item) delete next[key];
  if (finished(position, duration)) { delete next[entry.key]; return next; }
  next[entry.key] = { ...entry, position: Math.floor(position), duration: Number.isFinite(duration) ? Math.floor(duration) : 0, at: now };
  for (const old of progressList(next).slice(PROGRESS_LIMIT)) delete next[old.key];
  return next;
}
export const removeProgress = (store, key) => { const next = { ...store }; delete next[key]; return next; };
export const progressList = (store) => Object.values(store || {}).sort((a, b) => b.at - a.at);
export const progressPath = (entry) => `#/${entry.page}/${encodeURIComponent(entry.item)}/ver${entry.episode ? `/${encodeURIComponent(entry.episode)}` : ''}`;
export function loadProgress() {
  try { const data = JSON.parse(localStorage.getItem(PROGRESS_STORAGE) || '{}'); return data && typeof data === 'object' ? data : {}; }
  catch { return {}; }
}
export function loadRemoved() {
  try { const data = JSON.parse(localStorage.getItem(PROGRESS_REMOVED) || '{}'); return data && typeof data === 'object' ? data : {}; }
  catch { return {}; }
}
const progressListeners = new Set();
/** Called after every change of «Continuar viendo» in this browser (the cloud copy follows). */
export const onProgressSaved = (listener) => { progressListeners.add(listener); return () => progressListeners.delete(listener); };
/** Saves the row; what disappeared from it (removed, watched, replaced by a later episode) is noted as removed now. */
export function saveProgress(store, { now = Date.now(), quiet = false, removed = null } = {}) {
  const before = loadProgress(), gone = removed || loadRemoved();
  if (!removed) for (const key of Object.keys(before)) if (!store[key]) gone[key] = now;
  for (const key of Object.keys(store)) if (gone[key] && gone[key] < (store[key].at || 0)) delete gone[key];
  try { localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(store)); localStorage.setItem(PROGRESS_REMOVED, JSON.stringify(gone)); } catch {}
  if (!quiet) for (const listener of progressListeners) listener();
}

// The copy in the cloud, shared with the app (Library.java writes the same): sections by key
// («movies»…), positions in seconds, `at` in milliseconds and `removed` {key: when}.
const REMOVED_DAYS = 60, REMOVED_LIMIT = 200;
/** This browser's row and removals in the shared form. */
export function progressToCloud(store, removed) {
  const entries = {};
  for (const e of Object.values(store || {})) {
    const section = sectionByPage(e.page);
    if (!section || !e.key) continue;
    entries[e.key] = { key: e.key, section: section.key, item: e.item, episode: e.episode || '', name: e.name || '', sub: e.sub || '',
      image: e.image || '', position: Math.floor(e.position || 0), duration: Math.floor(e.duration || 0), at: e.at || 0 };
  }
  return { entries, removed: { ...(removed || {}) } };
}
/** The shared form as this browser keeps it. */
export function progressFromCloud(cloud) {
  const store = {};
  for (const e of Object.values(cloud?.entries || {})) {
    const section = LIBRARY_SECTIONS.find((s) => s.key === e.section);
    if (!section || !e.key || !e.item) continue;
    store[e.key] = { key: e.key, page: section.page, item: e.item, episode: e.episode || '', name: e.name || '', sub: e.sub || '',
      image: e.image || '', position: e.position || 0, duration: e.duration || 0, at: e.at || 0 };
  }
  return { store, removed: { ...(cloud?.removed || {}) } };
}
/**
 * Two copies of the row in the shared form, joined: for each title the latest thing done on any device
 * wins (watching it again, or removing it); one entry per series and the 20 most recent, as on each device.
 */
export function mergeProgress(a, b, now = Date.now()) {
  const entries = {}, removed = {};
  const keys = new Set([...Object.keys(a?.entries || {}), ...Object.keys(b?.entries || {}), ...Object.keys(a?.removed || {}), ...Object.keys(b?.removed || {})]);
  for (const key of keys) {
    const x = a?.entries?.[key], y = b?.entries?.[key];
    const entry = !x ? y : !y ? x : (y.at || 0) > (x.at || 0) ? y : x;
    const gone = Math.max(a?.removed?.[key] || 0, b?.removed?.[key] || 0);
    if (entry && (entry.at || 0) > gone) entries[key] = entry;
    else if (gone && now - gone < REMOVED_DAYS * 86400000) removed[key] = gone;
  }
  const kept = Object.values(entries).sort((p, q) => (q.at || 0) - (p.at || 0));
  const series = new Set();
  for (const entry of kept) {
    const title = `${entry.section}/${entry.item}`;
    if (series.has(title) || series.size >= PROGRESS_LIMIT) { delete entries[entry.key]; continue; }
    series.add(title);
  }
  const oldest = Object.entries(removed).sort((p, q) => q[1] - p[1]).slice(REMOVED_LIMIT);
  for (const [key] of oldest) delete removed[key];
  return { entries, removed };
}
export const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
const bar = (el, saved) => saved?.duration ? el('span', { class: 'watch-progress', role: 'presentation' }, el('span', { style: `width:${Math.min(100, Math.round(saved.position / saved.duration * 100))}%` })) : null;

/** The first row of the home page: what this browser left half watched, most recent first. */
export function continueRow(el, entries, { open, remove }, title = 'Continuar viendo') {
  return [el('div', { class: 'section-head' }, el('h2', {}, title)),
    el('div', { class: 'rail wide continue-rail' }, entries.map((entry) => el('div', { class: 'continue-card' },
      el('a', { href: progressPath(entry), title: entry.name, onclick: (event) => { if (event.button || event.ctrlKey || event.metaKey) return; event.preventDefault(); open(entry); } },
        el('span', { class: 'continue-art' }, entry.image ? el('img', { src: entry.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'poster-fallback' }, entry.name),
          el('span', { class: 'continue-play', 'aria-hidden': 'true' }, '▶'), bar(el, entry)),
        el('span', { class: 'name' }, entry.name),
        el('span', { class: 'sub' }, `${entry.sub}${entry.duration ? ` · quedan ${Math.max(1, Math.round((entry.duration - entry.position) / 60))} min` : ''}`)),
      el('a', { class: 'continue-info', href: `#/${entry.page}/${encodeURIComponent(entry.item)}`, 'aria-label': `Ficha de ${entry.name}`, title: 'Ficha' }, 'i'),
      el('button', { class: 'continue-remove', type: 'button', 'aria-label': `Quitar ${entry.name} de Continuar viendo`, title: 'Quitar', onclick: () => remove(entry) }, '✕'))))];
}

// ---- Portada: destacadas y Top 10 ----------------------------------------------------------------
// The administrator marks titles «En portada» (item.featured: when it was marked, so they keep that
// order) and they join the featured slider of the home page. item.trend is the title's place in the
// weekly top of its section (1 = first), set from TMDB in the admin page; the home page shows the first
// 10 films and the first 10 series (or as many as there are).
const everyItem = (library) => LIBRARY_SECTIONS.flatMap((section) => (library?.sections?.[section.key] || []).map((item) => ({ section, item })));
export const libraryFeatured = (library) => everyItem(library).filter(({ item }) => item.featured).sort((a, b) => a.item.featured - b.item.featured);
export const TOP_SIZE = 10;
/** The sections with a weekly top on the home page. */
export const TOP_SECTIONS = ['movies', 'series'];
export const libraryTop = (library, sectionKey) => everyItem(library).filter(({ section, item }) => section.key === sectionKey && item.trend > 0)
  .sort((a, b) => a.item.trend - b.item.trend).slice(0, TOP_SIZE);
/** «Película · 2024 · Drama, Comedia · ★ 7,4» */
export const itemLine = (section, item) => [section.one[0].toUpperCase() + section.one.slice(1), itemYear(item), (item.tmdb?.genres || []).slice(0, 2).join(', '),
  item.tmdb?.rating ? `★ ${item.tmdb.rating.toLocaleString('es-ES')}` : ''].filter(Boolean).join(' · ');
export const itemPath = (section, item) => `#/${section.page}/${encodeURIComponent(item.id)}`;

/**
 * The weekly top of films and of series among the library's titles, each on its own: first those in TMDB's
 * trending of the week (in its order), then the rest by TMDB popularity. `trending` is [{ id, kind }] and
 * `popularity` maps «movie:123» to a number. Documentaries have no top.
 */
export function rankTop(sections, trending, popularity, size = TOP_SIZE) {
  const place = new Map(trending.map((t, i) => [`${t.kind}:${t.id}`, i]));
  const keyOf = (item) => item.tmdb?.id && item.status !== 'unmatched' ? `${item.kind === 'tv' ? 'tv' : 'movie'}:${item.tmdb.id}` : null;
  const rank = new Map();
  for (const sectionKey of TOP_SECTIONS) {
    (sections[sectionKey] || []).filter((item) => keyOf(item))
      .map((item) => ({ item, trend: place.get(keyOf(item)) ?? Infinity, popularity: popularity[keyOf(item)] || 0 }))
      .sort((a, b) => a.trend - b.trend || b.popularity - a.popularity)
      .slice(0, size)
      .forEach((r, i) => rank.set(r.item.id, i + 1));
  }
  return Object.fromEntries(Object.entries(sections).map(([key, items]) => [key, items.map((item) => {
    const { trend, ...rest } = item;
    return rank.has(item.id) ? { ...rest, trend: rank.get(item.id) } : rest;
  })]));
}

/** A home page row of the weekly top («películas» or «series»): big numbers next to the posters, as on Netflix. */
export function topRow(el, entries, what, title = `Top ${entries.length} ${what} de la semana`) {
  return [el('div', { class: 'section-head' }, el('h2', {}, title), el('span', {}, 'Según TMDB')),
    el('div', { class: 'rail top-rail' }, entries.map(({ section, item }, i) => el('a', { class: 'top-card', href: itemPath(section, item), title: itemTitle(item) },
      el('span', { class: 'top-rank', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'poster-frame' }, poster(el, item), posterLabel(item) ? el('span', { class: 'poster-new' }, posterLabel(item)) : null),
      el('span', { class: 'sr' }, `Número ${i + 1}: ${itemTitle(item)}`))))];
}


// ---- Netflix-style section page --------------------------------------------------------------------
// Without filters, a section is a stack of rows as on Netflix: Spanish titles, today's picks, the top 10,
// genres with their own titles, titles on no platform in Spain («Solo en Calamar TV»), what this browser
// left half watched and the newest arrivals. The app (Library.browseRows) builds the same rows.
export const SPANISH_ROW = { movies: 'Películas españolas', series: 'Series españolas', documentaries: 'Documentales españoles' };
/** Made in Spain (TMDB production countries), or in Spanish when TMDB gives no country. */
export const isSpanish = (item) => (item.tmdb?.countries?.length ? item.tmdb.countries.includes('ES') : item.tmdb?.language === 'es');
const genreRow = (key, genres, title) => ({ key, genres, title });
/** Genre rows with their own name, in the order they appear; the other genres follow as «Películas de …». */
export const GENRE_ROWS = {
  terror: genreRow('terror', ['Terror'], (s) => `${s.label} de terror`),
  scifi: genreRow('scifi', ['Ciencia ficción', 'Fantasía', 'Sci-Fi & Fantasy'], () => 'Ciencia ficción y fantasía'),
  comedy: genreRow('comedy', ['Comedia'], () => '¿Quieres echarte unas risas?'),
  thriller: genreRow('thriller', ['Suspense', 'Thriller'], () => 'Thrillers que te mantendrán en vilo'),
  action: genreRow('action', ['Acción', 'Action & Adventure'], () => 'Acción a tope'),
  drama: genreRow('drama', ['Drama'], () => 'Dramas que enganchan'),
  crime: genreRow('crime', ['Crimen'], () => 'Crimen e investigación'),
  family: genreRow('family', ['Animación', 'Familia', 'Kids'], () => 'Para ver en familia'),
  adventure: genreRow('adventure', ['Aventura'], () => 'Grandes aventuras'),
  romance: genreRow('romance', ['Romance'], () => 'Historias de amor'),
  mystery: genreRow('mystery', ['Misterio'], () => 'Misterios por resolver'),
};
const ROW_LIMIT = 40;
/** Most interesting first: the weekly top, then the newest arrivals, then the best rated. */
const byInterest = (a, b) => (a.trend || 999) - (b.trend || 999) || String(b.addedAt || '').localeCompare(String(a.addedAt || ''))
  || (b.tmdb?.rating || 0) - (a.tmdb?.rating || 0);
/** A number from 0 to 1 that changes every day for each title (the same in the web and the app). */
export function dailyLuck(day, id) {
  let h = 2166136261;
  for (const ch of `${day}|${id}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}
/** «Recomendaciones de hoy para ti»: a new pick every day, first titles of the genres this browser watches, without those already started. */
export function todaysPicks(items, watchedIds = [], day = madridDay(), size = 15) {
  const watched = new Set(watchedIds);
  const liked = new Set(items.filter((item) => watched.has(item.id)).flatMap((item) => item.tmdb?.genres || []));
  return items.filter((item) => !watched.has(item.id))
    .map((item) => [item, (item.tmdb?.genres || []).filter((g) => liked.has(g)).length + dailyLuck(day, item.id)])
    .sort((a, b) => b[1] - a[1]).slice(0, size).map(([item]) => item);
}
const NEW_EPISODE_DAYS = 14;
/** The day the newest episode of a series arrived (YYYY-MM-DD), or ''. */
const lastEpisodeDay = (item) => (item.episodes || []).map((e) => String(e.addedAt || '')).filter(Boolean).sort().pop() || '';
/** «Nuevo episodio»: a series already in the library that got an episode in the last two weeks. */
export function hasNewEpisode(item, now = Date.now()) {
  const last = lastEpisodeDay(item), at = Date.parse(last);
  return item.kind === 'tv' && !!item.addedAt && last > item.addedAt && Number.isFinite(at) && now - at <= NEW_EPISODE_DAYS * DAY && at <= now + DAY;
}
/** The red label of a poster: «Nuevo episodio», «Recién llegada» or nothing. */
export const posterLabel = (item, now = Date.now()) => (hasNewEpisode(item, now) ? 'Nuevo episodio' : isNewArrival(item, now) ? 'Recién llegada' : '');
const freshDay = (item, now) => (hasNewEpisode(item, now) ? lastEpisodeDay(item) : String(item.addedAt || ''));
/** «Novedades en Calamar TV»: new arrivals and series with a new episode, the newest first. */
export const freshTitles = (items, now = Date.now()) => items.filter((item) => posterLabel(item, now))
  .sort((a, b) => freshDay(b, now).localeCompare(freshDay(a, now)));

/** The slider at the top of a section: what is new, then the weekly top; without either, the best rated. */
export function heroTitles(items, now = Date.now(), size = 8) {
  const picked = [...freshTitles(items, now), ...items.filter((item) => item.trend > 0).sort((a, b) => a.trend - b.trend)];
  const out = [...new Set(picked)];
  if (!out.length) out.push(...items.filter((item) => item.tmdb?.backdrop || item.tmdb?.poster).sort((a, b) => (b.tmdb?.rating || 0) - (a.tmdb?.rating || 0)));
  return out.slice(0, size);
}

/**
 * The platforms of a list of titles (TMDB, in Spain): [{ name, logo, count }]. `settings` is the catalog's
 * `platforms` list set in the admin page ([{ name, logo, hidden }], in the order chosen): those go first in
 * that order with their own logo, hidden ones are left out, and the rest follow, the one with most titles first.
 */
export function platformsOf(items, settings = []) {
  const found = new Map();
  for (const item of items) for (const name of item.tmdb?.providers || []) {
    const p = found.get(name) || { name, logo: '', count: 0 };
    p.count++;
    p.logo ||= item.tmdb?.logos?.[name] || '';
    found.set(name, p);
  }
  const chosen = Array.isArray(settings) ? settings.filter((s) => s && typeof s.name === 'string') : [];
  const place = (p) => { const i = chosen.findIndex((s) => s.name === p.name); return i < 0 ? chosen.length : i; };
  return [...found.values()].filter((p) => !chosen.some((s) => s.name === p.name && s.hidden))
    .map((p) => ({ ...p, logo: chosen.find((s) => s.name === p.name)?.logo || p.logo }))
    .sort((a, b) => place(a) - place(b) || b.count - a.count || a.name.localeCompare(b.name, 'es'));
}
export const PLATFORM_PAGE = 'plataforma';
export const platformPath = (name) => `#/${PLATFORM_PAGE}/${encodeURIComponent(name)}`;
/**
 * The rows of a platform's page, every section together: [{ key, title, entries: [{ section, item }] }]:
 * «En primer plano» (new and top titles), one row per section and one per genre.
 */
export function platformRows(library, name, now = Date.now()) {
  const all = everyItem(library).filter(({ item }) => (item.tmdb?.providers || []).includes(name));
  const rows = [];
  const add = (key, title, entries) => { if (entries.length) rows.push({ key, title, entries: entries.slice(0, ROW_LIMIT) }); };
  const sorted = (entries) => [...entries].sort((a, b) => byInterest(a.item, b.item));
  const spotlight = heroTitles(all.map((e) => e.item), now, 15).map((item) => all.find((e) => e.item === item));
  add('spotlight', 'En primer plano', spotlight.length ? spotlight : sorted(all));
  for (const section of LIBRARY_SECTIONS) add(section.key, section.label, sorted(all.filter((e) => e.section === section)));
  const used = new Set();
  for (const row of Object.values(GENRE_ROWS)) {
    row.genres.forEach((g) => used.add(g));
    add(row.key, row.key === 'terror' ? 'Terror' : row.title(), sorted(all.filter(({ item }) => (item.tmdb?.genres || []).some((g) => row.genres.includes(g)))));
  }
  const rest = [...new Set(all.flatMap(({ item }) => item.tmdb?.genres || []))].filter((g) => !used.has(g)).sort((a, b) => a.localeCompare(b, 'es'));
  for (const g of rest) add(`genre:${g}`, g, sorted(all.filter(({ item }) => (item.tmdb?.genres || []).includes(g))));
  return { all, rows };
}

/**
 * The rows of a section page, in order: [{ key, title, kind, items }]. kind is 'poster', 'top' (big
 * numbers), 'big' (large posters) or 'continue' (filled by the page with what this browser left half watched).
 */
export function browseRows(section, items, { now = Date.now(), watchedIds = [], name = '' } = {}) {
  // kind 'horror': the dark banner of «Especial Halloween».
  const rows = [];
  const add = (key, title, list, kind = 'poster') => { if (kind === 'continue' || list.length) rows.push({ key, title, kind, items: list.slice(0, ROW_LIMIT) }); };
  const used = new Set();
  const genre = (row, kind = 'poster') => { row.genres.forEach((g) => used.add(g)); add(row.key, row.title(section), items.filter((item) => (item.tmdb?.genres || []).some((g) => row.genres.includes(g))).sort(byInterest), kind); };
  add('spanish', SPANISH_ROW[section.key] || `${section.label} españolas`, items.filter(isSpanish).sort(byInterest));
  add('today', 'Recomendaciones de hoy para ti', todaysPicks(items, watchedIds, madridDay(now)));
  if (TOP_SECTIONS.includes(section.key)) {
    const top = items.filter((item) => item.trend > 0).sort((a, b) => a.trend - b.trend).slice(0, TOP_SIZE);
    add('top', top.length > 1 ? `Las ${top.length} ${section.label.toLowerCase()} más populares de la semana` : `La ${section.one} más popular de la semana`, top, 'top');
  }
  // Horror has the dark banner of «Especial Halloween», with «Descubrir todo».
  genre(GENRE_ROWS.terror, 'horror');
  // Large posters: what arrived lately («Recién llegada») and series with a new episode, the newest first.
  add('new', 'Novedades en Calamar TV', freshTitles(items, now), 'big');
  add('continue', name ? `Seguir viendo para ${name}` : 'Seguir viendo', [], 'continue');
  genre(GENRE_ROWS.scifi);
  genre(GENRE_ROWS.comedy);
  for (const key of ['thriller', 'action', 'drama', 'crime', 'family', 'adventure', 'romance', 'mystery']) genre(GENRE_ROWS[key]);
  const counts = new Map();
  // «Documentales de documental» says nothing: the section's own genre has no row.
  for (const item of items) for (const g of item.tmdb?.genres || []) if (!used.has(g) && norm(g) !== norm(section.one)) counts.set(g, (counts.get(g) || 0) + 1);
  for (const [g] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')))
    add(`genre:${g}`, `${section.label} de ${g.toLocaleLowerCase('es')}`, items.filter((item) => (item.tmdb?.genres || []).includes(g)).sort(byInterest));
  return rows;
}

// ---- Especial Halloween ------------------------------------------------------------------------------
// From 1 October to 2 November (Madrid time) the home page has «Especial Halloween» with every horror
// title (TMDB genre «Terror») of films, series and documentaries; «Descubrir todo» opens #/halloween.
export const HALLOWEEN_PAGE = 'halloween';
export function halloweenOn(now = Date.now()) {
  const [, month, day] = madridDay(now).split('-').map(Number);
  return month === 10 || (month === 11 && day <= 2);
}
export const horrorTitles = (library) => everyItem(library).filter(({ item }) => (item.tmdb?.genres || []).includes('Terror'))
  .sort((a, b) => byInterest(a.item, b.item));

// ---- Public pages -------------------------------------------------------------------------------

function poster(el, item, cls = 'poster-art') {
  const fallback = () => el('span', { class: `${cls} poster-fallback` }, itemTitle(item));
  if (!item.tmdb?.poster) return fallback();
  const img = el('img', { class: cls, src: item.tmdb.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

/** Poster grid of a section, with a search box. */
const DAY = 86400000;
/** Released in the last 12 months (by its TMDB date; without one, a title of this year). */
export function isRecentRelease(item, now = Date.now()) {
  const at = Date.parse(item.tmdb?.released || '');
  if (Number.isFinite(at)) return at <= now && now - at <= 365 * DAY;
  return Number(itemYear(item)) === new Date(now).getFullYear();
}
/** «Recién llegada», as on Netflix: a title of this year that arrived in the library in the last month. */
export function isNewArrival(item, now = Date.now()) {
  const added = Date.parse(item.addedAt || '');
  return Number(itemYear(item)) === new Date(now).getFullYear() && Number.isFinite(added) && now - added <= 31 * DAY && added <= now + DAY;
}
export const LIBRARY_ORDERS = [['', 'Orden del catálogo'], ['added', 'Añadidas recientemente'], ['year', 'Más nuevas primero'], ['rating', 'Mejor valoradas'], ['name', 'Por nombre (A-Z)']];
/** The titles of a section that pass the filters: name, category, year, platform, «Estrenos» / «Recién llegadas», in an order. */
export function filterLibrary(items, { q = '', genre = '', year = '', platform = '', only = '', order = '' } = {}, now = Date.now()) {
  const text = norm(q.trim());
  const found = items.filter((item) => (!genre || (item.tmdb?.genres || []).includes(genre))
    && (!year || String(itemYear(item)) === String(year))
    && (!platform || (item.tmdb?.providers || []).includes(platform))
    && (only !== 'estrenos' || isRecentRelease(item, now))
    && (only !== 'nuevas' || isNewArrival(item, now))
    && (!text || norm(`${itemTitle(item)} ${item.title} ${(item.tmdb?.genres || []).join(' ')} ${(item.tmdb?.cast || []).map((c) => c.name).join(' ')}`).includes(text)));
  const by = { added: (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')),
    year: (a, b) => (Number(itemYear(b)) || 0) - (Number(itemYear(a)) || 0),
    rating: (a, b) => (b.tmdb?.rating || 0) - (a.tmdb?.rating || 0),
    name: (a, b) => itemTitle(a).localeCompare(itemTitle(b), 'es') }[order];
  return by ? [...found].sort(by) : found;
}

/** A poster of a row: «TOP 10» in the corner for the weekly top and «Recién llegada» under it, as on Netflix. */
export function browseCard(el, section, item, { big = false } = {}) {
  return el('a', { class: `poster-card browse-card${big ? ' big' : ''}`, href: itemPath(section, item), title: itemTitle(item), 'aria-label': itemTitle(item) },
    el('span', { class: 'poster-frame' }, poster(el, item),
      item.trend > 0 && TOP_SECTIONS.includes(section.key) ? el('span', { class: 'poster-top', 'aria-hidden': 'true' }, el('small', {}, 'TOP'), el('b', {}, '10')) : null,
      posterLabel(item) ? el('span', { class: 'poster-new' }, posterLabel(item)) : null));
}

/**
 * A section page. Without filters, rows as on Netflix (browseRows); with a category, a search or any
 * filter, the poster grid of the titles that pass. `watching` are this browser's «Continuar viendo»
 * entries, `name` the signed-in user's first name.
 */
export function libraryPage(el, section, library, { watching = [], name = '', open = () => {}, remove = () => {}, platforms: platformSettings = [] } = {}) {
  const items = library.sections[section.key] || [];
  const query = el('input', { type: 'search', placeholder: `Buscar en ${section.label.toLowerCase()}`, 'aria-label': `Buscar en ${section.label.toLowerCase()}` });
  const body = el('div', { class: 'browse-body' });
  const select = (label, all, values) => el('select', { 'aria-label': label }, [['', all], ...values.map((v) => (Array.isArray(v) ? v : [v, v]))].map(([value, text]) => el('option', { value }, text)));
  // Filters: TMDB genre, year, platform where it can be watched (in Spain), releases and new arrivals, and an order.
  const genres = [...new Set(items.flatMap((item) => item.tmdb?.genres || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const years = [...new Set(items.map((item) => Number(itemYear(item))).filter(Boolean))].sort((a, b) => b - a);
  const platforms = [...new Set(items.flatMap((item) => item.tmdb?.providers || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const picker = select('Categoría', 'Todas las categorías', genres);
  picker.classList.add('browse-category');
  const yearPicker = select('Año', 'Todos los años', years.map(String));
  const platformPicker = select('Plataforma', 'Todas las plataformas', platforms);
  const orderPicker = el('select', { 'aria-label': 'Ordenar' }, LIBRARY_ORDERS.map(([value, text]) => el('option', { value }, text)));
  let only = '';
  const chip = (value, text) => el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: (e) => {
    only = only === value ? '' : value;
    for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b.dataset.only === only));
    draw();
  }, 'data-only': value }, text);
  const chips = el('div', { class: 'chips library-chips', role: 'group', 'aria-label': 'Mostrar' }, chip('estrenos', 'Estrenos'), chip('nuevas', 'Recién llegadas'));
  const filters = el('div', { class: 'browse-filters', hidden: true },
    el('div', { class: 'library-filters' }, el('label', { class: 'search library-search' }, query),
      years.length > 1 ? el('label', { class: 'library-genre' }, yearPicker) : null,
      platforms.length ? el('label', { class: 'library-genre' }, platformPicker) : null,
      el('label', { class: 'library-genre' }, orderPicker)), chips);
  const toggle = el('button', { class: 'browse-toggle', type: 'button', 'aria-expanded': 'false', onclick: () => {
    filters.hidden = !filters.hidden;
    toggle.setAttribute('aria-expanded', String(!filters.hidden));
    if (!filters.hidden) query.focus();
  } }, '🔍 Buscar y filtrar');
  const watchedIds = watching.filter((entry) => entry.page === section.page).map((entry) => entry.item);
  const rows = () => [...heroSlider(el, section, heroTitles(items)), ...platformButtons(el, platformsOf(items, platformSettings)), ...browseRows(section, items, { watchedIds, name }).flatMap((row) => {
    if (row.kind === 'continue') {
      const mine = watching.filter((entry) => entry.page === section.page);
      return mine.length ? continueRow(el, mine, { open, remove }, row.title) : [];
    }
    if (row.kind === 'top') return topRow(el, row.items.map((item) => ({ section, item })), '', row.title);
    if (row.kind === 'horror') return horrorBanner(el, row.title, row.items.map((item) => ({ section, item })), { onclick: (event) => {
      // «Descubrir todo»: every horror title of this section, as when «Terror» is chosen in the categories.
      event.preventDefault();
      picker.value = [...picker.options].some((o) => o.value === 'Terror') ? 'Terror' : '';
      draw();
      picker.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } });
    return [el('div', { class: 'section-head' }, el('h2', {}, row.title)),
      el('div', { class: `rail browse-rail${row.kind === 'big' ? ' big-rail' : ''}` }, row.items.map((item) => browseCard(el, section, item, { big: row.kind === 'big' })))];
  })];
  const draw = () => {
    const filtered = query.value.trim() || picker.value || yearPicker.value || platformPicker.value || only || orderPicker.value;
    if (!filtered) {
      body.replaceChildren(...(items.length ? rows() : [el('p', { class: 'status' }, `Todavía no hay ${section.label.toLowerCase()}.`)]));
      return;
    }
    const found = filterLibrary(items, { q: query.value, genre: picker.value, year: yearPicker.value, platform: platformPicker.value, only, order: orderPicker.value });
    const grid = el('div', { class: 'poster-grid' }, found.map((item) => el('a', { class: 'poster-card', href: itemPath(section, item), title: itemTitle(item) },
      el('span', { class: 'poster-frame' }, poster(el, item), item.tmdb?.rating ? el('span', { class: 'poster-rating' }, `★ ${item.tmdb.rating.toLocaleString('es-ES')}`) : null,
        posterLabel(item) ? el('span', { class: 'poster-new' }, posterLabel(item)) : null),
      el('span', { class: 'name' }, itemTitle(item)),
      el('span', { class: 'sub' }, [itemYear(item), item.kind === 'tv' ? `${item.episodes.length} capítulos` : ''].filter(Boolean).join(' · ')))));
    if (!found.length) grid.append(el('p', { class: 'status' }, picker.value || yearPicker.value || platformPicker.value || only ? (query.value.trim() ? 'No hay títulos con ese nombre y esos filtros.' : 'No hay títulos con esos filtros.') : 'No hay títulos con ese nombre.'));
    body.replaceChildren(el('div', { class: 'section-head' }, el('h2', {}, picker.value || 'Resultados'), el('span', {}, found.length === 1 ? '1 título' : `${found.length} títulos`)), grid);
  };
  query.addEventListener('input', draw);
  for (const control of [picker, yearPicker, platformPicker, orderPicker]) control.addEventListener('change', draw);
  draw();
  return [el('div', { class: 'browse-head' }, el('h1', { class: 'browse-title' }, section.label),
    el('div', { class: 'browse-controls' }, genres.length ? el('label', { class: 'browse-select' }, picker) : null, toggle)),
    filters, body, attribution(el, library)];
}

/** The tagline of a slide: «Nuevo episodio disponible», «Recién llegada», «Nº 1 de la semana»… */
function heroTagline(item) {
  const label = posterLabel(item);
  if (label === 'Nuevo episodio') return 'Nuevo episodio disponible';
  if (label) return label;
  return item.trend > 0 ? `Nº ${item.trend} de la semana` : '';
}

/**
 * The slider at the top of a section, as on Disney+: big cards (the poster on a phone, the backdrop on a
 * wide screen) that move by themselves every six seconds and can be swiped.
 */
export function heroSlider(el, section, items) {
  if (!items.length) return [];
  const track = el('div', { class: 'browse-hero-track', role: 'list' }, items.map((item) => {
    const meta = [itemYear(item), (item.tmdb?.genres || [])[0]].filter(Boolean).join(' • ');
    const art = (src, cls) => (src ? el('img', { class: cls, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null);
    return el('a', { class: 'browse-hero-slide', role: 'listitem', href: itemPath(section, item), 'aria-label': itemTitle(item) },
      art(item.tmdb?.poster, 'hero-poster') || el('span', { class: 'hero-poster poster-fallback' }, itemTitle(item)),
      art(item.tmdb?.backdrop || item.tmdb?.poster, 'hero-backdrop'),
      el('span', { class: 'browse-hero-text' }, el('b', {}, itemTitle(item)), heroTagline(item) ? el('span', { class: 'browse-hero-tag' }, heroTagline(item)) : null,
        meta ? el('span', { class: 'browse-hero-meta' }, meta) : null));
  }));
  const host = el('section', { class: 'browse-hero', 'aria-label': `Destacadas de ${section.label.toLowerCase()}` }, track);
  // Moves on every six seconds while the page is on screen, unless the viewer is touching or pointing at it.
  let busy = false;
  for (const [name, value] of [['pointerenter', true], ['pointerleave', false], ['touchstart', true], ['touchend', false], ['focusin', true], ['focusout', false]])
    host.addEventListener(name, () => { busy = value; }, { passive: true });
  if (items.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const timer = setInterval(() => {
      if (!host.isConnected) { clearInterval(timer); return; }
      if (busy || document.hidden) return;
      const slide = track.firstElementChild?.getBoundingClientRect().width || track.clientWidth;
      const end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
      track.scrollTo({ left: end ? 0 : track.scrollLeft + slide, behavior: 'smooth' });
    }, 6000);
  }
  return [host];
}

/** The platform buttons under the slider (logo from TMDB, or its name), each opening the platform's page. */
export function platformButtons(el, platforms) {
  if (!platforms.length) return [];
  return [el('nav', { class: 'platform-buttons', 'aria-label': 'Plataformas' }, platforms.map((p) => el('a', { class: 'platform-button', href: platformPath(p.name), title: p.name, 'aria-label': p.name },
    p.logo ? el('img', { src: p.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, el('span', {}, p.name))))];
}

/**
 * A platform's page, as on Disney+ (Marvel): the platform's logo over the backdrop of one of its titles
 * (a different one, at random, every time) and its titles in rows: «En primer plano», by section and by genre.
 */
export function platformPage(el, library, name, random = Math.random, settings = []) {
  const { all, rows } = platformRows(library, name);
  const own = Array.isArray(settings) ? settings.find((s) => s?.name === name)?.logo : '';
  const logo = own || all.map(({ item }) => item.tmdb?.logos?.[name]).find(Boolean);
  const backdrops = all.map(({ item }) => item.tmdb?.backdrop).filter(Boolean);
  const backdrop = backdrops[Math.floor(random() * backdrops.length)];
  const nodes = [el('section', { class: 'platform-hero', style: backdrop ? `--platform-art:url("${backdrop.replace(/"/g, '%22')}")` : null },
    logo ? el('img', { class: 'platform-hero-logo', src: logo, alt: '', referrerpolicy: 'no-referrer' }) : null,
    el('h1', {}, name), el('p', {}, all.length === 1 ? '1 título' : `${all.length} títulos`))];
  for (const row of rows) nodes.push(el('div', { class: 'section-head' }, el('h2', {}, row.title)),
    el('div', { class: 'rail browse-rail' }, row.entries.map(({ section, item }) => browseCard(el, section, item))));
  if (!all.length) nodes.push(el('p', { class: 'status' }, `Todavía no hay títulos de ${name}.`));
  nodes.push(attribution(el, library));
  return nodes;
}

/** «Especial Halloween»: every horror title of the library, by section. */
export function halloweenPage(el, library) {
  const found = horrorTitles(library);
  const nodes = [el('div', { class: 'halloween-banner page' }, el('p', { class: 'halloween-kicker' }, 'Colección de terror'), el('h1', {}, 'Especial Halloween'),
    el('p', {}, found.length === 1 ? '1 título para pasar miedo' : `${found.length} títulos para pasar miedo`))];
  for (const section of LIBRARY_SECTIONS) {
    const mine = found.filter((f) => f.section === section);
    if (!mine.length) continue;
    nodes.push(el('div', { class: 'section-head' }, el('h2', {}, section.label), el('span', {}, String(mine.length))),
      el('div', { class: 'poster-grid' }, mine.map(({ item }) => browseCard(el, section, item))));
  }
  if (!found.length) nodes.push(el('p', { class: 'status' }, 'Todavía no hay películas ni series de terror.'));
  return nodes;
}

/** The home page block of «Especial Halloween»: a dark banner with the horror titles and «Descubrir todo». */
export function halloweenRow(el, library) {
  return horrorBanner(el, 'Especial Halloween', horrorTitles(library), { href: `#/${HALLOWEEN_PAGE}` });
}

/** The dark horror banner (Especial Halloween, and the horror row of each section): titles and «Descubrir todo». */
export function horrorBanner(el, title, entries, { href = '#', onclick = null } = {}) {
  if (!entries.length) return [];
  const backdrop = entries.find(({ item }) => item.tmdb?.backdrop)?.item.tmdb.backdrop;
  return [el('section', { class: 'halloween-banner', 'aria-label': title, style: backdrop ? `--halloween-art:url("${backdrop.replace(/"/g, '%22')}")` : null },
    el('p', { class: 'halloween-kicker' }, 'Colección de terror'), el('h2', {}, title),
    el('div', { class: 'rail browse-rail' }, entries.slice(0, ROW_LIMIT).map(({ section, item }) => browseCard(el, section, item))),
    el('a', { class: 'halloween-all', href, onclick }, 'Descubrir todo'))];
}

const attribution = (el, library) => el('p', { class: 'note library-credit' }, library.attribution || 'Datos de TMDB.');

/**
 * «Similares»: other titles of the same section that share genres with this one, the closest first
 * (then the best rated); without any in common, the best rated of the section.
 */
export function similarTitles(library, section, item, size = 12) {
  const genres = new Set(item.tmdb?.genres || []);
  const others = (library?.sections?.[section.key] || []).filter((other) => other.id !== item.id);
  const scored = others.map((other) => [other, (other.tmdb?.genres || []).filter((g) => genres.has(g)).length]);
  const close = scored.filter(([, n]) => n > 0);
  return (close.length ? close : scored).sort((a, b) => b[1] - a[1] || (b[0].tmdb?.rating || 0) - (a[0].tmdb?.rating || 0)).slice(0, size).map(([other]) => other);
}

/** The episode to play from a series' page: the one left half watched most recently, else the first. */
export function resumeEpisode(item, saved = () => null) {
  const episodes = [...(item.episodes || [])].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const started = episodes.map((e) => [e, saved(e.id)]).filter(([, s]) => s).sort((a, b) => (b[1].at || 0) - (a[1].at || 0))[0];
  return started ? started[0] : episodes[0] || null;
}

/**
 * A title's page, as on Netflix: the backdrop, the platform, the title and its facts, a big «Reproducir»
 * button, the synopsis, «Protagonizada por» and «Creada por» / «Dirigida por», and the tabs «Episodios»
 * (series: the season drop-down and its episodes), «Tráileres y más» (the trailer in Spanish) and «Similares».
 */
export function libraryDetail(el, section, library, item, play, saved = () => null, initialSeason = null) {
  const info = item.tmdb || {};
  const series = item.kind === 'tv';
  const seasons = series ? [...new Set(item.episodes.map((e) => e.season))].sort((a, b) => a - b) : [];
  const facts = [itemYear(item), series ? (seasons.length === 1 ? '1 temporada' : `${seasons.length} temporadas`) : info.runtime ? `${info.runtime} min` : '',
    info.rating ? `★ ${info.rating.toLocaleString('es-ES')}${info.votes ? ` (${info.votes.toLocaleString('es-ES')} votos)` : ''}` : ''].filter(Boolean).join(' · ');
  const brand = (info.providers || [])[0];
  // «Reproducir»: the film, or the episode of the series left half watched most recently (else the first).
  let action;
  if (series) {
    const next = resumeEpisode(item, saved);
    const left = next && saved(next.id);
    action = next ? el('div', { class: 'library-actions' },
      el('button', { class: 'btn lg title-play', type: 'button', onclick: () => play(item, next, false) },
        left ? `▶ Continuar T${next.season}:E${next.episode} · ${clock(left.position)}` : `▶ Reproducir T${next.season}:E${next.episode}`), bar(el, left)) : null;
  } else action = playButtons(el, saved(item.id), (restart) => play(item, null, restart));
  // «Protagonizada por: a, b, c… más»: «más» shows everyone.
  const cast = (info.cast || []).map((c) => c.name).filter(Boolean);
  const starring = cast.length ? el('p', { class: 'title-credit cast-list' }, el('b', {}, 'Protagonizada por: '), cast.slice(0, 3).join(', ')) : null;
  if (starring && cast.length > 3) {
    const more = el('button', { class: 'link-button', type: 'button', onclick: () => { starring.replaceChildren(el('b', {}, 'Protagonizada por: '), cast.join(', ')); } }, 'más');
    starring.append('… ', more);
  }
  const creators = (info.creators || []).filter(Boolean);
  const share = el('button', { class: 'title-action', type: 'button', onclick: async () => {
    const url = new URL(itemPath(section, item), location.href).href;
    try { if (navigator.share) await navigator.share({ title: itemTitle(item), url }); else { await navigator.clipboard.writeText(url); share.lastChild.textContent = 'Enlace copiado'; } } catch {}
  } }, el('span', { 'aria-hidden': 'true' }, '⤴'), el('span', {}, 'Compartir'));
  const head = el('section', { class: 'title-page' },
    el('div', { class: 'title-backdrop' }, info.backdrop ? el('img', { src: info.backdrop, alt: '', referrerpolicy: 'no-referrer' }) : poster(el, item, 'library-poster'),
      el('a', { class: 'library-back title-back', href: `#/${section.page}`, 'aria-label': `Volver a ${section.label}` }, '‹')),
    el('div', { class: 'title-body' },
      brand ? el('p', { class: 'title-brand' }, brand) : null,
      el('h1', {}, itemTitle(item)),
      facts ? el('p', { class: 'library-facts' }, facts) : null,
      action, !series ? soundNote(el, item.file) : null,
      el('p', { class: 'library-overview' }, info.overview || 'Sin sinopsis. El administrador puede buscar este título en TMDB.'),
      starring,
      creators.length ? el('p', { class: 'title-credit' }, el('b', {}, series ? 'Creada por: ' : 'Dirigida por: '), creators.join(', ')) : null,
      info.genres?.length ? el('p', { class: 'title-credit' }, el('b', {}, 'Géneros: '), info.genres.join(', ')) : null,
      el('div', { class: 'title-actions' }, share)));
  // The tabs.
  const panel = el('div', { class: 'title-panel' });
  const tabs = [];
  if (series) tabs.push(['episodes', 'Episodios', () => {
    let chosen = seasons.includes(initialSeason) ? initialSeason : (resumeEpisode(item, saved)?.season ?? seasons[0]);
    const picker = el('select', { class: 'season-picker', 'aria-label': 'Temporada' }, seasons.map((s) => el('option', { value: String(s) }, `Temporada ${s}`)));
    picker.value = String(chosen);
    const list = el('div', { class: 'episode-list' });
    const draw = () => list.replaceChildren(...item.episodes.filter((e) => e.season === chosen).sort((a, b) => a.episode - b.episode).map((e) => el('a', { class: 'episode', href: episodePath(section, item, e) },
      el('span', { class: 'episode-art' }, e.still ? el('img', { class: 'episode-still', src: e.still, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'episode-still episode-number' }, episodeLabel(e)),
        el('span', { class: 'episode-play-icon', 'aria-hidden': 'true' }, '▶'), bar(el, saved(e.id))),
      el('span', { class: 'episode-text' }, el('b', {}, e.name ? `${e.episode}. ${e.name}` : episodeLabel(e)), e.runtime ? el('small', {}, `${e.runtime} min`) : null),
      e.overview ? el('span', { class: 'episode-overview' }, e.overview) : null)));
    picker.addEventListener('change', () => { chosen = Number(picker.value); draw(); });
    draw();
    return [el('label', { class: 'browse-select season-select' }, picker), list];
  }]);
  tabs.push(['trailers', 'Tráileres y más', () => (info.trailer
    ? [el('div', { class: 'title-trailer' }, el('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.trailer)}?rel=0`, title: `Tráiler de ${itemTitle(item)}`,
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' }))]
    : [el('p', { class: 'status' }, 'Este título no tiene tráiler en español.')])]);
  tabs.push(['similar', 'Similares', () => {
    const found = similarTitles(library, section, item);
    return found.length ? [el('div', { class: 'poster-grid similar-grid' }, found.map((other) => browseCard(el, section, other)))] : [el('p', { class: 'status' }, 'Todavía no hay títulos parecidos.')];
  }]);
  const bar_ = el('div', { class: 'title-tabs', role: 'tablist' });
  const open = (key) => {
    for (const b of bar_.children) b.setAttribute('aria-selected', String(b.dataset.tab === key));
    panel.replaceChildren(...tabs.find(([k]) => k === key)[2]());
  };
  for (const [key, label] of tabs) bar_.append(el('button', { class: 'title-tab', type: 'button', role: 'tab', 'data-tab': key, onclick: () => open(key) }, label));
  open(series ? 'episodes' : info.trailer ? 'trailers' : 'similar');
  return [head, bar_, panel, attribution(el, library)];
}

/** Browsers often play MKV/AVI without sound (AC3/DTS audio); the app plays them with sound. */
const soundNote = (el, file) => /\.(mkv|avi|mov|wmv|flv|mpg|mpeg|m2ts|vob)$/i.test(file || '')
  ? el('p', { class: 'note library-sound' }, 'Este vídeo es MKV: si en el navegador no se oye, ábrelo en la app Calamar TV, donde se oye bien.') : null;

/** «▶ Ver», or «▶ Continuar · 12:34» and «Desde el principio» when it was left half watched. */
function playButtons(el, saved, play) {
  if (!saved) return el('div', { class: 'library-actions' }, el('button', { class: 'btn lg', type: 'button', onclick: () => play(false) }, '▶ Reproducir'));
  return el('div', { class: 'library-actions' },
    el('button', { class: 'btn lg', type: 'button', onclick: () => play(false) }, `▶ Continuar · ${clock(saved.position)}`),
    el('button', { class: 'btn secondary lg', type: 'button', onclick: () => play(true) }, '↺ Desde el principio'), bar(el, saved));
}

/** An episode's own page: its image, «Capítulo N», its name and synopsis, and the play button. */
export function libraryEpisode(el, section, library, item, episode, play, saved = () => null) {
  const info = item.tmdb || {};
  const image = episode.still || info.backdrop || '';
  const next = nextEpisode(item, episode);
  return [el('section', { class: 'library-hero episode-hero', style: image ? `--backdrop:url("${image.replace(/"/g, '')}")` : null },
    el('div', { class: 'library-info' },
      el('a', { class: 'library-back', href: `#/${section.page}/${encodeURIComponent(item.id)}/temporada/${episode.season}` }, `‹ ${itemTitle(item)}`),
      el('p', { class: 'library-facts' }, `${itemTitle(item)} · ${seasonLabel(episode)}`),
      el('h1', {}, episodeTitle(episode)),
      el('p', { class: 'library-overview' }, episode.overview || info.overview || 'Sin descripción.'),
      playButtons(el, saved(episode.id), (restart) => play(item, episode, restart)), soundNote(el, episode.file),
      next ? el('a', { class: 'episode-next', href: episodePath(section, item, next) }, `Siguiente: ${seasonLabel(next)} · ${episodeTitle(next)} ›`) : null)),
    attribution(el, library)];
}

// ---- Administration ---------------------------------------------------------------------------

/** A link the web or the app can play: LuluStream, or a direct HTTPS video (MP4, HLS…). */
/** LuluStream's links (of films, documentaries and episodes) on its current site, luluvido.com: { sections, changed }. */
export function luluvidoLinks(sections) {
  let changed = 0;
  const move = (url) => {
    const code = lulustreamEmbed(url)?.split('/').pop();
    const next = code ? `https://luluvido.com/${code}` : url;
    if (next !== url) changed++;
    return next;
  };
  const out = Object.fromEntries(Object.entries(sections || {}).map(([key, items]) => [key, (items || []).map((item) => ({
    ...item, ...(item.url ? { url: move(item.url) } : {}), ...(item.episodes ? { episodes: item.episodes.map((e) => (e.url ? { ...e, url: move(e.url) } : e)) } : {}) }))]));
  return { sections: out, changed };
}

export const validVideoLink = (url) => !!lulustreamEmbed(url) || (/^https:\/\//.test(String(url).trim()) && webPlayback(String(url).trim()).ok);

/**
 * The «Pelis y series» admin section: search a title in TMDB, choose it and paste its video link (for a
 * series, the link of every episode of the chosen season). Everything is saved to Firestore and can be
 * edited later. `readSettings`/`saveSettings` keep the TMDB key private; `publish` writes the library.
 */
export function libraryAdmin(el, { visible, setVisible, field, readSettings, saveSettings, publish }) {
  const status = el('p', { class: 'note', role: 'status' });
  const say = (text, error = false) => { status.textContent = text; status.className = error ? 'error' : 'note'; };
  const toggle = el('input', { type: 'checkbox', checked: visible });
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try { await setVisible(toggle.checked); say(toggle.checked ? 'Publicado: Películas, Series y Documentales aparecen en el menú para todos.' : 'Oculto para los usuarios: solo tú, como administrador, los sigues viendo.'); }
    catch (error) { toggle.checked = !toggle.checked; say(error.message, true); }
    finally { toggle.disabled = false; }
  });
  let settings = {}, current = { sections: {} };
  const key = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Clave de la API de TMDB (v3) o token de lectura (v4)' });
  const saveKey = el('button', { class: 'btn secondary', type: 'button' }, 'Guardar clave');
  const tmdbKey = () => { if (!settings.tmdb) throw new Error('Primero añade la clave de TMDB en «Configuración».'); return settings.tmdb; };
  const luluKey = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Clave de la API de LuluStream' });
  const saveLulu = el('button', { class: 'btn secondary', type: 'button' }, 'Guardar clave de LuluStream');
  const store = async (sections) => {
    // Each title keeps the day it arrived: new ones are «Recién llegada» for a month if they are from this year.
    // LuluStream links are saved on its current site (luluvido.com), whatever name they were pasted with.
    const next = stampAdded(luluvidoLinks(Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, sections[s.key] || []]))).sections, current.sections);
    await publish(libraryParts(next));
    current = { ...current, sections: next };
    drawList();
  };
  const sectionOf = (id) => LIBRARY_SECTIONS.find((s) => (current.sections[s.key] || []).some((item) => item.id === id))?.key || null;
  const upsert = async (section, item) => {
    // Editing a title keeps it «En portada» and in the top.
    const before = Object.values(current.sections).flat().find((x) => x.id === item.id);
    if (before?.featured && item.featured === undefined) item = { ...item, featured: before.featured };
    if (before?.trend && item.trend === undefined) item = { ...item, trend: before.trend };
    const sections = Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, (current.sections[s.key] || []).filter((x) => x.id !== item.id)]));
    sections[section] = [...sections[section], item].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), 'es', { sensitivity: 'base' }));
    await store(sections);
  };
  const remove = async (id) => store(Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, (current.sections[s.key] || []).filter((x) => x.id !== id)])));
  const linkInput = (value, label) => el('input', { type: 'url', value: value || '', placeholder: 'https://luluvido.com/…', 'aria-label': label, class: 'library-link' });
  const checkLinks = (inputs) => {
    const bad = inputs.find((i) => i.value.trim() && !validVideoLink(i.value));
    if (bad) { bad.focus(); throw new Error(`Enlace no válido: ${bad.value.trim()}. Pega el enlace del vídeo de LuluStream (https://luluvido.com/…) o un vídeo MP4/HLS por HTTPS.`); }
  };

  // ---- Search ----
  const sectionPick = el('select', { 'aria-label': 'Sección' }, LIBRARY_SECTIONS.map((s) => el('option', { value: s.key }, s.label)));
  const query = el('input', { type: 'search', placeholder: 'Título de la película, serie o documental', 'aria-label': 'Buscar en TMDB' });
  const searchButton = el('button', { class: 'btn', type: 'submit' }, 'Buscar en TMDB');
  const results = el('div', { class: 'library-results' });
  const editor = el('div', { class: 'library-editor', hidden: true });
  const searchForm = el('form', { class: 'library-search-form', onsubmit: async (event) => {
    event.preventDefault();
    if (!query.value.trim()) return;
    searchButton.disabled = true; results.replaceChildren(el('p', { class: 'note' }, 'Buscando…'));
    try {
      const kind = sectionPick.value === 'movies' ? 'movie' : sectionPick.value === 'series' ? 'tv' : 'any';
      const found = await searchTmdb(query.value.trim(), kind, tmdbKey());
      results.replaceChildren(...found.map((r) => el('button', { class: 'library-result', type: 'button', onclick: () => { results.replaceChildren(); openEditor(sectionPick.value, r.id, r.kind); } },
        r.poster ? el('img', { src: r.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
        el('span', {}, el('b', {}, `${r.title}${r.year ? ` (${r.year})` : ''}`), el('small', {}, r.kind === 'tv' ? 'Serie' : 'Película'), r.overview ? el('small', {}, r.overview) : null))));
      if (!found.length) results.append(el('p', { class: 'note' }, 'Sin resultados. Prueba con otro título.'));
    } catch (error) { results.replaceChildren(el('p', { class: 'error' }, error.message)); }
    finally { searchButton.disabled = false; }
  } }, el('div', { class: 'library-search-row' }, sectionPick, query, searchButton));

  // ---- Editor: a film's link, or a series' episode links season by season ----
  async function openEditor(section, tmdbId, kind) {
    editor.hidden = false;
    editor.replaceChildren(el('p', { class: 'note' }, 'Cargando la ficha de TMDB…'));
    editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
    try {
      const { info, seasons } = await tmdbDetails(tmdbId, kind, tmdbKey());
      const id = `${kind === 'tv' ? 's' : 'm'}${info.id}`;
      const existing = Object.values(current.sections).flat().find((item) => item.id === id);
      const inSection = existing ? sectionOf(id) : section;
      const close = el('button', { class: 'ghost', type: 'button', onclick: () => { editor.hidden = true; editor.replaceChildren(); } }, 'Cerrar');
      const del = existing ? el('button', { class: 'ghost danger', type: 'button', onclick: async () => {
        if (!confirm(`¿Quitar «${info.title}» de la biblioteca?`)) return;
        try { await remove(id); say(`«${info.title}» quitada.`); editor.hidden = true; editor.replaceChildren(); } catch (error) { say(error.message, true); }
      } }, kind === 'tv' ? 'Quitar la serie' : 'Quitar') : null;
      const where = el('select', { 'aria-label': 'Sección' }, LIBRARY_SECTIONS.map((s) => el('option', { value: s.key, selected: s.key === inSection }, s.label)));
      const head = el('div', { class: 'library-editor-head' },
        info.poster ? el('img', { src: info.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
        el('div', {}, el('h3', {}, `${info.title}${info.year ? ` (${info.year})` : ''}`), el('p', { class: 'note' }, info.overview.slice(0, 260) || 'Sin sinopsis.'), field('Sección', where)));
      const note = el('p', { class: 'note', role: 'status' });
      if (kind !== 'tv') {
        const link = linkInput(existing?.url, 'Enlace del vídeo');
        const save = el('button', { class: 'btn', type: 'button', onclick: async () => {
          try {
            if (!link.value.trim()) throw new Error('Pega el enlace del vídeo.');
            checkLinks([link]);
            save.disabled = true; note.textContent = 'Guardando…';
            await upsert(where.value, movieItem(info, link.value.trim()));
            note.textContent = 'Guardado y publicado.'; say(`«${info.title}» guardada.`);
          } catch (error) { note.textContent = error.message; } finally { save.disabled = false; }
        } }, existing ? 'Guardar cambios' : 'Guardar');
        editor.replaceChildren(head, field('Enlace del vídeo (LuluStream)', link, 'El enlace de la página del vídeo de LuluStream (luluvido.com, lulustream.com, luluvdo.com…).'),
          el('div', { class: 'actions' }, save, del, close), note);
        link.focus();
        return;
      }
      // Series: choose the season, then paste the link of each episode.
      const seasonPick = el('select', { 'aria-label': 'Temporada' }, seasons.map((s) => el('option', { value: s.season },
        `${s.name}${s.episodes ? ` · ${s.episodes} capítulos` : ''}${(existing?.episodes || []).some((e) => e.season === s.season) ? ' ✓' : ''}`)));
      const firstWithLinks = seasons.find((s) => (existing?.episodes || []).some((e) => e.season === s.season));
      seasonPick.value = String((firstWithLinks || seasons.find((s) => s.season > 0) || seasons[0])?.season ?? 1);
      const rows = el('div', { class: 'library-episodes' });
      let episodes = [], inputs = {};
      const loadSeason = async () => {
        rows.replaceChildren(el('p', { class: 'note' }, 'Cargando capítulos…'));
        const season = Number(seasonPick.value);
        try {
          episodes = await seasonEpisodes(info.id, season, tmdbKey());
          const saved = new Map((current.sections[sectionOf(id)] || []).find((item) => item.id === id)?.episodes?.filter((e) => e.season === season).map((e) => [e.episode, e.url]) || []);
          inputs = Object.fromEntries(episodes.map((e) => [e.episode, linkInput(saved.get(e.episode), `Enlace del capítulo ${e.episode}`)]));
          rows.replaceChildren(...episodes.map((e) => el('label', { class: 'library-episode-row' },
            el('span', {}, el('b', {}, `${e.episode}.`), ` ${e.name || `Capítulo ${e.episode}`}`), inputs[e.episode])));
          if (!episodes.length) rows.append(el('p', { class: 'note' }, 'TMDB no tiene capítulos para esta temporada.'));
        } catch (error) { rows.replaceChildren(el('p', { class: 'error' }, error.message)); }
      };
      seasonPick.addEventListener('change', loadSeason);
      const save = el('button', { class: 'btn', type: 'button', onclick: async () => {
        try {
          checkLinks(Object.values(inputs));
          const links = Object.fromEntries(Object.entries(inputs).map(([n, input]) => [n, input.value]));
          const season = Number(seasonPick.value);
          const before = Object.values(current.sections).flat().find((item) => item.id === id);
          const item = seriesWithSeason(before, info, season, episodes, links);
          if (!item.episodes.length) throw new Error('Pega el enlace de al menos un capítulo.');
          save.disabled = true; note.textContent = 'Guardando…';
          await upsert(where.value, item);
          const count = item.episodes.filter((e) => e.season === season).length;
          note.textContent = `Temporada ${season} guardada y publicada: ${count} ${count === 1 ? 'capítulo' : 'capítulos'} con enlace.`;
          [...seasonPick.options].find((o) => Number(o.value) === season).textContent = `${seasons.find((s) => s.season === season)?.name || `Temporada ${season}`} · ${count} con enlace ✓`;
        } catch (error) { note.textContent = error.message; } finally { save.disabled = false; }
      } }, 'Guardar temporada');
      // «Saltar intro» and «Siguiente capítulo»: times for the whole series, or for one season that differs.
      const introFrom = el('input', { type: 'text', inputmode: 'numeric', placeholder: '0:30', 'aria-label': 'La intro empieza en', class: 'library-clock' });
      const introTo = el('input', { type: 'text', inputmode: 'numeric', placeholder: '1:45', 'aria-label': 'La intro acaba en', class: 'library-clock' });
      const credits = el('input', { type: 'text', inputmode: 'numeric', placeholder: `0:${String(CREDITS_DEFAULT).padStart(2, '0')}`, 'aria-label': 'Duración de los créditos', class: 'library-clock' });
      const scope = el('select', { 'aria-label': 'Tiempos para' });
      const skipNote = el('p', { class: 'note', role: 'status' });
      const savedSkip = () => Object.values(current.sections).flat().find((item) => item.id === id)?.skip || {};
      const fillSkip = () => {
        const season = Number(seasonPick.value), own = savedSkip().seasons?.[season];
        scope.replaceChildren(el('option', { value: 'all' }, 'Toda la serie'), el('option', { value: 'season', selected: !!own }, `Solo la temporada ${season}`));
        const times = own || savedSkip();
        introFrom.value = times.intro ? formatClock(times.intro[0]) : '';
        introTo.value = times.intro ? formatClock(times.intro[1]) : '';
        credits.value = times.credits ? formatClock(times.credits) : '';
      };
      seasonPick.addEventListener('change', fillSkip);
      const saveSkip = el('button', { class: 'btn secondary', type: 'button', onclick: async () => {
        try {
          const before = Object.values(current.sections).flat().find((item) => item.id === id);
          if (!before) throw new Error('Guarda primero los enlaces de una temporada.');
          const [from, to, end] = [introFrom, introTo, credits].map((input) => parseClock(input.value));
          if ([from, to, end].some(Number.isNaN)) throw new Error('Escribe los tiempos como 1:45 (minutos:segundos) o 1:02:03.');
          if ((from === null) !== (to === null)) throw new Error('Pon dónde empieza y dónde acaba la intro, o deja los dos vacíos.');
          if (from !== null && to <= from) throw new Error('La intro tiene que acabar después de empezar.');
          const times = { ...(from !== null ? { intro: [from, to] } : {}), ...(end ? { credits: end } : {}) };
          const skip = { ...(before.skip || {}) };
          if (scope.value === 'season') {
            const seasons = { ...(skip.seasons || {}) };
            if (Object.keys(times).length) seasons[seasonPick.value] = times; else delete seasons[seasonPick.value];
            skip.seasons = seasons;
            if (!Object.keys(seasons).length) delete skip.seasons;
          } else {
            delete skip.intro; delete skip.credits;
            Object.assign(skip, times);
          }
          saveSkip.disabled = true; skipNote.textContent = 'Guardando…';
          await upsert(sectionOf(id) || where.value, { ...before, skip });
          skipNote.textContent = `Guardado para ${scope.value === 'season' ? `la temporada ${seasonPick.value}` : 'toda la serie'}: ${times.intro ? `intro de ${formatClock(times.intro[0])} a ${formatClock(times.intro[1])}` : 'sin intro'}, «Siguiente capítulo» en los últimos ${formatClock(times.credits || CREDITS_DEFAULT)}.`;
        } catch (error) { skipNote.textContent = error.message; } finally { saveSkip.disabled = false; }
      } }, 'Guardar tiempos');
      const skipBox = el('details', { class: 'library-skip', open: !!(existing?.skip) },
        el('summary', {}, 'Saltar intro y siguiente capítulo'),
        el('p', { class: 'note' }, `Mientras el capítulo esté entre esos dos tiempos sale «Saltar intro». «Siguiente capítulo» sale durante los créditos (por defecto los últimos ${CREDITS_DEFAULT} segundos). Si una temporada es distinta, elige «Solo la temporada».`),
        el('div', { class: 'library-skip-row' }, field('Intro desde', introFrom), field('hasta', introTo), field('Créditos (duración)', credits)),
        el('div', { class: 'actions' }, scope, saveSkip), skipNote);
      fillSkip();
      editor.replaceChildren(head, field('Temporada', seasonPick, 'Elige la temporada que quieres subir y pega el enlace de cada capítulo. Los capítulos sin enlace no se muestran.'),
        rows, el('div', { class: 'actions' }, save, del, close), note, skipBox);
      await loadSeason();
    } catch (error) { editor.replaceChildren(el('p', { class: 'error' }, error.message)); }
  }

  // ---- LuluStream folders: Peliculas/, Series/<Nombre>/Temporada N/, Documentales/ ----
  const scanNote = el('p', { class: 'note', role: 'status' });
  const scanReport = el('div', { class: 'library-scan-report' });
  const scanButton = el('button', { class: 'btn', type: 'button', onclick: async () => {
    scanButton.disabled = true; scanReport.replaceChildren();
    try {
      if (!settings.lulu) throw new Error('Primero añade la clave de la API de LuluStream en «Configuración».');
      const key = tmdbKey();
      scanNote.textContent = 'Leyendo las carpetas de LuluStream…';
      const scan = await scanLulu(settings.lulu, { onFolder: (name) => { scanNote.textContent = `Leyendo «${name}» en LuluStream…`; } });
      const found = scan.films.length + scan.series.length;
      if (!found) throw new Error('No hay vídeos en las carpetas Peliculas, Series o Documentales.');
      const result = await libraryFromScan(scan, current.sections, key, { onProgress: (n, total, title) => { scanNote.textContent = `Buscando en TMDB ${n} de ${total}: ${title}…`; } });
      scanNote.textContent = 'Publicando…';
      await store(result.sections);
      const { films, shows, episodes, pending } = result.added;
      scanNote.textContent = `Hecho: ${films} ${films === 1 ? 'película o documental' : 'películas y documentales'} y ${shows} ${shows === 1 ? 'serie' : 'series'} (${episodes} capítulos) publicados${pending ? `, y ${pending} sin ficha de TMDB` : ''}. Revisa la lista de abajo; puedes editar o quitar cualquiera.`;
      if (result.unknown.length) scanReport.replaceChildren(el('p', { class: 'note' }, `Para revisar (${result.unknown.length}). Los que están «sin ficha de TMDB» ya se ven con su nombre de archivo: en la lista de abajo pulsa «Buscar en TMDB» y elige su ficha.`),
        el('ul', {}, result.unknown.map((line) => el('li', {}, line))));
    } catch (error) { scanNote.textContent = error.message; } finally { scanButton.disabled = false; }
  } }, 'Leer carpetas de LuluStream');
  // LuluStream moved to luluvido.com: the links saved before (lulustream.com, luluvdo.com…) move there in one go.
  const moveButton = el('button', { class: 'btn secondary', type: 'button', onclick: async () => {
    moveButton.disabled = true;
    try {
      const { changed } = luluvidoLinks(current.sections);
      if (!changed) { scanNote.textContent = 'Todos los enlaces de LuluStream ya están en luluvido.com.'; return; }
      scanNote.textContent = 'Publicando…';
      await store(current.sections);
      scanNote.textContent = `Hecho: ${changed} ${changed === 1 ? 'enlace cambiado' : 'enlaces cambiados'} a luluvido.com (películas, documentales y capítulos).`;
    } catch (error) { scanNote.textContent = error.message; } finally { moveButton.disabled = false; }
  } }, 'Cambiar los enlaces a luluvido.com');

  // ---- A title TMDB did not recognise: search TMDB and choose its record; its links go with it ----
  function openMatcher(sectionKey, item) {
    editor.hidden = false;
    const kind = item.kind === 'tv' ? 'tv' : 'movie';
    const words = el('input', { type: 'search', value: item.title || '', 'aria-label': 'Buscar su ficha en TMDB' });
    const found = el('div', { class: 'library-results' });
    const note = el('p', { class: 'note', role: 'status' });
    const close = el('button', { class: 'ghost', type: 'button', onclick: () => { editor.hidden = true; editor.replaceChildren(); } }, 'Cerrar');
    const del = el('button', { class: 'ghost danger', type: 'button', onclick: async () => {
      if (!confirm(`¿Quitar «${item.title}» de la biblioteca?`)) return;
      try { await remove(item.id); say(`«${item.title}» quitada.`); editor.hidden = true; editor.replaceChildren(); } catch (error) { note.textContent = error.message; }
    } }, 'Quitar');
    const search = async (event) => {
      event?.preventDefault();
      if (!words.value.trim()) return;
      found.replaceChildren(el('p', { class: 'note' }, 'Buscando…'));
      try {
        const results = await searchTmdb(words.value.trim(), kind, tmdbKey());
        found.replaceChildren(...results.map((r) => el('button', { class: 'library-result', type: 'button', onclick: () => choose(r) },
          r.poster ? el('img', { src: r.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
          el('span', {}, el('b', {}, `${r.title}${r.year ? ` (${r.year})` : ''}`), r.overview ? el('small', {}, r.overview) : null))));
        if (!results.length) found.append(el('p', { class: 'note' }, 'Sin resultados. Prueba con otro título.'));
      } catch (error) { found.replaceChildren(el('p', { class: 'error' }, error.message)); }
    };
    const choose = async (r) => {
      found.replaceChildren(); note.textContent = 'Pasando los enlaces a la ficha de TMDB…';
      try {
        const existing = Object.values(current.sections).flat().find((x) => x.id === `${kind === 'tv' ? 's' : 'm'}${r.id}`);
        const next = await matchUnmatched(item, r.id, existing, tmdbKey());
        const sections = Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, (current.sections[s.key] || []).filter((x) => x.id !== item.id && x.id !== next.id)]));
        const where = existing ? sectionOf(existing.id) : sectionKey;
        sections[where] = [...sections[where], next].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), 'es', { sensitivity: 'base' }));
        await store(sections);
        say(`«${item.title}» es ahora «${itemTitle(next)}», con ${kind === 'tv' ? `sus ${item.episodes.length} capítulos` : 'su vídeo'}.`);
        await openEditor(where, r.id, kind);
      } catch (error) { note.textContent = error.message; }
    };
    editor.replaceChildren(
      el('div', { class: 'library-editor-head' }, el('span', { class: 'thumb' }),
        el('div', {}, el('h3', {}, item.title), el('p', { class: 'note' },
          `Sin ficha de TMDB. ${kind === 'tv' ? `Carpeta «${item.folder || item.title}», ${item.episodes.length} capítulos.` : `Archivo «${item.file || item.title}».`} Busca su ficha y elígela: ${kind === 'tv' ? 'los capítulos' : 'el vídeo'} pasarán a ella.`))),
      el('form', { class: 'library-search-form', onsubmit: search }, el('div', { class: 'library-search-row' }, words, el('button', { class: 'btn', type: 'submit' }, 'Buscar'))),
      found, el('div', { class: 'actions' }, del, close), note);
    editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
    search();
  }

  // ---- Portada: a title «En portada» joins the featured slider of the home page ----
  async function toggleFeatured(sectionKey, item, button) {
    button.disabled = true;
    try {
      const { featured, ...rest } = item;
      const next = item.featured ? rest : { ...item, featured: Date.now() };
      await store({ ...current.sections, [sectionKey]: (current.sections[sectionKey] || []).map((x) => (x.id === item.id ? next : x)) });
      say(item.featured ? `«${itemTitle(item)}» ya no sale en la portada.` : `«${itemTitle(item)}» sale en la portada de inicio (web y app).`);
    } catch (error) { say(error.message, true); button.disabled = false; }
  }

  // ---- Top 10 de la semana: TMDB's trending of the week among the library's titles ----
  const TOP_REFRESHED = 'calamar-top-refreshed-v2'; // v2: a top for films and another for series
  const topNote = el('p', { class: 'note', role: 'status' });
  async function refreshTop(quiet = false) {
    const key = tmdbKey();
    if (!quiet) topNote.textContent = 'Consultando las tendencias de la semana en TMDB…';
    const trending = await tmdbTrending(key);
    const titles = Object.values(current.sections).flat().filter((item) => item.tmdb?.id && item.status !== 'unmatched');
    // The same request brings the release date and the platforms of each title (the filters of the lists).
    const popularity = {}, facts = {};
    for (const [n, item] of titles.entries()) {
      if (!quiet) topNote.textContent = `Popularidad y plataformas en TMDB ${n + 1} de ${titles.length}: ${itemTitle(item)}…`;
      const kind = item.kind === 'tv' ? 'tv' : 'movie';
      const found = await tmdbFacts(item.tmdb.id, kind, key).catch(() => null);
      popularity[`${kind}:${item.tmdb.id}`] = found?.popularity || 0;
      if (found) facts[item.id] = found;
    }
    const withFacts = Object.fromEntries(Object.entries(current.sections).map(([section, items]) => [section, items.map((item) => facts[item.id]
      ? { ...item, tmdb: { ...item.tmdb, providers: facts[item.id].providers, ...(facts[item.id].released ? { released: facts[item.id].released } : {}),
        ...(facts[item.id].countries.length ? { countries: facts[item.id].countries } : {}), ...(facts[item.id].language ? { language: facts[item.id].language } : {}),
        logos: facts[item.id].logos, trailer: facts[item.id].trailer, ...(facts[item.id].creators.length ? { creators: facts[item.id].creators } : {}) } } : item)]));
    const ranked = rankTop(withFacts, trending, popularity);
    const changed = JSON.stringify(ranked) !== JSON.stringify(current.sections);
    if (changed) await store(ranked);
    try { localStorage.setItem(TOP_REFRESHED, new Date().toISOString().slice(0, 10)); } catch {}
    const lines = TOP_SECTIONS.map((key) => [LIBRARY_SECTIONS.find((sec) => sec.key === key).label, libraryTop({ sections: ranked }, key)])
      .filter(([, top]) => top.length).map(([label, top]) => `${label}: ${top.map(({ item }, i) => `${i + 1}. ${itemTitle(item)}`).join(' · ')}`);
    topNote.textContent = lines.length ? `Top actualizado. ${lines.join(' — ')}` : 'Todavía no hay películas ni series con ficha de TMDB para el top.';
  }
  const topButton = el('button', { class: 'btn secondary', type: 'button', onclick: async () => {
    topButton.disabled = true;
    try { await refreshTop(); } catch (error) { topNote.textContent = error.message; } finally { topButton.disabled = false; }
  } }, 'Actualizar el top y las plataformas con TMDB');

  // ---- What is in the library ----
  const list = el('div', { class: 'library-admin-list' }, el('p', { class: 'note' }, 'Cargando la biblioteca…'));
  function drawList() {
    list.replaceChildren(...LIBRARY_SECTIONS.flatMap((section) => {
      const items = current.sections[section.key] || [];
      return [el('h3', {}, `${section.label} · ${items.length}`), ...(items.length ? items.map((item) => el('div', { class: 'library-item' },
        el('div', { class: 'library-item-row' },
          item.tmdb?.poster ? el('img', { src: item.tmdb.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
          el('span', { class: 'meta' }, el('b', {}, `${itemTitle(item)}${itemYear(item) ? ` (${itemYear(item)})` : ''}`),
            el('span', { class: 'note' }, `${item.status === 'unmatched' ? 'Sin ficha de TMDB · ' : ''}${item.kind === 'tv' ? `${new Set(item.episodes.map((e) => e.season)).size} temporadas · ${item.episodes.length} capítulos con enlace` : 'Con enlace'}`)),
          el('button', { class: `btn small ${item.featured ? '' : 'secondary'}`, type: 'button', 'aria-pressed': String(!!item.featured),
            title: item.featured ? 'Quitar de la portada' : 'Mostrar en la portada de inicio', onclick: (event) => toggleFeatured(section.key, item, event.currentTarget) },
            item.featured ? '★ En portada' : '☆ Destacar'),
          item.status === 'unmatched'
            ? el('button', { class: 'btn small', type: 'button', onclick: () => openMatcher(section.key, item) }, 'Buscar en TMDB')
            : el('button', { class: 'btn small secondary', type: 'button', onclick: () => openEditor(section.key, item.tmdb?.id, item.kind === 'tv' ? 'tv' : 'movie') }, 'Editar')))) : [el('p', { class: 'note' }, 'Todavía no hay ninguno.')])];
    }));
  }

  (async () => {
    try {
      settings = await readSettings();
      if (settings.tmdb) key.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      if (settings.lulu) luluKey.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      current = await fetchLibrary({ fresh: true });
      drawList();
      // The top follows TMDB by itself: once a day, when the administrator opens this page.
      let last = '';
      try { last = localStorage.getItem(TOP_REFRESHED) || ''; } catch {}
      if (settings.tmdb && last !== new Date().toISOString().slice(0, 10)) refreshTop(true).catch(() => {});
    } catch (error) { say(error.message, true); list.replaceChildren(); }
  })();
  saveKey.addEventListener('click', async () => {
    saveKey.disabled = true; say('Comprobando la clave en TMDB…');
    try {
      if (!key.value.trim()) throw new Error('Pega la clave de TMDB.');
      await checkTmdbKey(key.value.trim());
      const next = { ...settings, tmdb: key.value.trim() };
      await saveSettings(next);
      settings = next; key.value = ''; key.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      say('Clave de TMDB guardada (privada, solo para el administrador).');
    } catch (error) { say(error.message, true); } finally { saveKey.disabled = false; }
  });
  saveLulu.addEventListener('click', async () => {
    saveLulu.disabled = true; say('Comprobando la clave en LuluStream…');
    try {
      if (!luluKey.value.trim()) throw new Error('Pega la clave de la API de LuluStream.');
      const root = await luluFolder(0, luluKey.value.trim());
      const next = { ...settings, lulu: luluKey.value.trim() };
      await saveSettings(next);
      settings = next; luluKey.value = ''; luluKey.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      say(`Clave de LuluStream guardada (privada). Carpetas: ${root.folders.map((f) => f.name).join(', ') || 'ninguna'}.`);
    } catch (error) { say(error.message, true); } finally { saveLulu.disabled = false; }
  });
  return [el('div', { class: 'section-head' }, el('h2', {}, 'Pelis y series')),
    el('label', { class: 'actions library-switch' }, toggle, 'Mostrar Películas, Series y Documentales a los usuarios (web y app)'),
    el('details', { class: 'image-settings' }, el('summary', {}, 'Configuración: claves de TMDB y LuluStream'),
      el('p', { class: 'note' }, 'Crea una clave gratuita en themoviedb.org → Ajustes → API y pégala aquí. Se guarda en Firebase, visible solo para el administrador.'),
      field('Clave de TMDB', key), el('div', { class: 'actions' }, saveKey),
      el('p', { class: 'note' }, 'La clave de la API de LuluStream (LuluStream → API) sirve para leer tus carpetas. También es privada.'),
      field('Clave de LuluStream', luluKey), el('div', { class: 'actions' }, saveLulu)),
    el('h3', {}, 'Leer las carpetas de LuluStream'),
    el('p', { class: 'note' }, 'Peliculas/ con un vídeo por película, Series/Nombre/Temporada 1/ con los capítulos (1x01, S01E01…) y Documentales/. Lo que se reconozca en TMDB se publica; lo demás se lista para añadirlo a mano.'),
    el('div', { class: 'actions' }, scanButton, moveButton), scanNote, scanReport,
    el('h3', {}, 'Portada y Top 10 de películas y series'),
    el('p', { class: 'note' }, 'Pulsa «☆ Destacar» en cualquier título de la lista de abajo para que salga en la portada de inicio, junto a los eventos destacados. La portada muestra el top de la semana de tus películas y el de tus series (hasta 10 de cada, o las que haya), ordenadas por las tendencias de la semana en TMDB y su popularidad; se actualiza solo una vez al día al abrir esta página.'),
    el('div', { class: 'actions' }, topButton), topNote,
    el('h3', {}, 'Añadir una película, serie o documental'), searchForm, results, editor, status, list];
}
