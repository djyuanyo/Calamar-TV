// Films, series and documentaries from Google Drive folders, Plex style, with synopsis, genres, cast,
// rating and posters from TMDB. The administrator shows or hides the whole catalog (catalog field
// `libraryVisible`); while hidden the menu does not offer it. Published by the admin page to Firestore (calamarLibrary: an index and parts), read here without
// signing in; the videos play from Google Drive. Nothing depends on the hosting.
import { firebaseConfig } from './firebase-config.js';
import { driveFolderId, driveVideos, sectionItems, mergeScan, searchTmdb, tmdbDetails, confident, applyMatch, seasonsOf, libraryParts, checkTmdbKey } from './library-drive.js';

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

/** What the player needs to play a film or an episode (the same player as the channels). */
export function playable(section, item, episode = null) {
  const target = episode || item, info = item.tmdb || {};
  return { id: target.id, name: episode ? `${itemTitle(item)} · T${episode.season} · ${episodeTitle(episode)}` : itemTitle(item),
    streams: [target.url], playable: true, vod: true, logo: '', group: section.label, region: '',
    path: `#/${section.page}/${encodeURIComponent(item.id)}/ver${episode ? `/${encodeURIComponent(episode.id)}` : ''}`,
    // Saved in «Continuar viendo»: enough to draw its card and come back without the library.
    progress: { key: target.id, page: section.page, item: item.id, episode: episode?.id || '',
      name: itemTitle(item), sub: episode ? `${seasonLabel(episode)} · ${episodeTitle(episode)}` : String(itemYear(item) || section.label),
      image: episode?.still || info.backdrop || info.poster || '' },
    next: episode ? () => { const n = nextEpisode(item, episode); return n ? playable(section, item, n) : null; } : null };
}

// ---- Continuar viendo --------------------------------------------------------------------------
// Kept in this browser only (localStorage): where each film or episode was left. One entry per
// series (the last episode watched), the 20 most recent, and gone once it has been watched.
export const PROGRESS_STORAGE = 'calamar-progress-v1';
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
export function saveProgress(store) { try { localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(store)); } catch {} }
export const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
const bar = (el, saved) => saved?.duration ? el('span', { class: 'watch-progress', role: 'presentation' }, el('span', { style: `width:${Math.min(100, Math.round(saved.position / saved.duration * 100))}%` })) : null;

/** The first row of the home page: what this browser left half watched, most recent first. */
export function continueRow(el, entries, { open, remove }) {
  return [el('div', { class: 'section-head' }, el('h2', {}, 'Continuar viendo')),
    el('div', { class: 'rail wide continue-rail' }, entries.map((entry) => el('div', { class: 'continue-card' },
      el('a', { href: progressPath(entry), title: entry.name, onclick: (event) => { if (event.button || event.ctrlKey || event.metaKey) return; event.preventDefault(); open(entry); } },
        el('span', { class: 'continue-art' }, entry.image ? el('img', { src: entry.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'poster-fallback' }, entry.name),
          el('span', { class: 'continue-play', 'aria-hidden': 'true' }, '▶'), bar(el, entry)),
        el('span', { class: 'name' }, entry.name),
        el('span', { class: 'sub' }, `${entry.sub}${entry.duration ? ` · quedan ${Math.max(1, Math.round((entry.duration - entry.position) / 60))} min` : ''}`)),
      el('button', { class: 'continue-remove', type: 'button', 'aria-label': `Quitar ${entry.name} de Continuar viendo`, title: 'Quitar', onclick: () => remove(entry) }, '✕'))))];
}

// ---- Public pages -------------------------------------------------------------------------------

function poster(el, item, cls = 'poster-art') {
  const fallback = () => el('span', { class: `${cls} poster-fallback` }, itemTitle(item));
  if (!item.tmdb?.poster) return fallback();
  const img = el('img', { class: cls, src: item.tmdb.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

/** Poster grid of a section, with a search box. */
export function libraryPage(el, section, library) {
  const items = library.sections[section.key] || [];
  const query = el('input', { type: 'search', placeholder: `Buscar en ${section.label.toLowerCase()}`, 'aria-label': `Buscar en ${section.label.toLowerCase()}` });
  const grid = el('div', { class: 'poster-grid' });
  // Categories: a drop-down with the TMDB genres of the titles in this section; one narrows the grid.
  const genres = [...new Set(items.flatMap((item) => item.tmdb?.genres || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const picker = el('select', { 'aria-label': 'Categoría' }, ['', ...genres].map((g) => el('option', { value: g }, g || 'Todas las categorías')));
  const draw = () => {
    const q = norm(query.value.trim()), genre = picker.value;
    const found = items.filter((item) => (!genre || (item.tmdb?.genres || []).includes(genre))
      && norm(`${itemTitle(item)} ${item.title} ${(item.tmdb?.genres || []).join(' ')}`).includes(q));
    grid.replaceChildren(...found.map((item) => el('a', { class: 'poster-card', href: `#/${section.page}/${encodeURIComponent(item.id)}`, title: itemTitle(item) },
      el('span', { class: 'poster-frame' }, poster(el, item), item.tmdb?.rating ? el('span', { class: 'poster-rating' }, `★ ${item.tmdb.rating.toLocaleString('es-ES')}`) : null),
      el('span', { class: 'name' }, itemTitle(item)),
      el('span', { class: 'sub' }, [itemYear(item), item.kind === 'tv' ? `${item.episodes.length} capítulos` : ''].filter(Boolean).join(' · ')))));
    if (!found.length) grid.append(el('p', { class: 'status' }, !items.length ? `Todavía no hay ${section.label.toLowerCase()}.` : genre && !q ? `No hay títulos de ${genre}.` : 'No hay títulos con ese nombre.'));
  };
  query.addEventListener('input', draw);
  picker.addEventListener('change', draw);
  draw();
  return [el('div', { class: 'section-head' }, el('h2', {}, section.label), el('span', {}, `${items.length} ${items.length === 1 ? section.one : section.label.toLowerCase()}`)),
    el('div', { class: 'library-filters' }, el('label', { class: 'search library-search' }, query), genres.length ? el('label', { class: 'library-genre' }, picker) : null),
    grid, attribution(el, library)];
}

const attribution = (el, library) => el('p', { class: 'note library-credit' }, library.attribution || 'Datos de TMDB.');

/** Detail page: backdrop, poster, synopsis, genres, cast, rating; seasons and episodes for series. */
export function libraryDetail(el, section, library, item, play, saved = () => null, initialSeason = null) {
  const info = item.tmdb || {};
  const facts = [itemYear(item), info.runtime ? `${info.runtime} min` : '', info.rating ? `★ ${info.rating.toLocaleString('es-ES')}${info.votes ? ` (${info.votes.toLocaleString('es-ES')} votos)` : ''}` : ''].filter(Boolean).join(' · ');
  const head = el('section', { class: 'library-hero', style: info.backdrop ? `--backdrop:url("${info.backdrop.replace(/"/g, '')}")` : null },
    poster(el, item, 'library-poster'),
    el('div', { class: 'library-info' },
      el('a', { class: 'library-back', href: `#/${section.page}` }, `‹ ${section.label}`),
      el('h1', {}, itemTitle(item)),
      facts ? el('p', { class: 'library-facts' }, facts) : null,
      info.genres?.length ? el('div', { class: 'library-genres' }, info.genres.map((g) => el('span', { class: 'chip' }, g))) : null,
      el('p', { class: 'library-overview' }, info.overview || 'Sin sinopsis. El administrador puede buscar este título en TMDB.'),
      item.kind === 'movie' ? playButtons(el, saved(item.id), (restart) => play(item, null, restart)) : null,
      item.kind === 'movie' ? soundNote(el, item.file) : null));
  const nodes = [head];
  if (item.kind === 'tv') {
    const seasons = [...new Set(item.episodes.map((e) => e.season))];
    let chosen = seasons.includes(initialSeason) ? initialSeason : seasons[0];
    const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Temporadas' });
    const list = el('div', { class: 'episode-list' });
    const draw = () => {
      chips.replaceChildren(...seasons.map((s) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(s === chosen), onclick: () => { chosen = s; draw(); } }, `Temporada ${s}`)));
      list.replaceChildren(...item.episodes.filter((e) => e.season === chosen).map((e) => el('a', { class: 'episode', href: episodePath(section, item, e) },
        el('span', { class: 'episode-art' }, e.still ? el('img', { class: 'episode-still', src: e.still, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'episode-still episode-number' }, episodeLabel(e)), bar(el, saved(e.id))),
        el('span', { class: 'episode-text' }, el('b', {}, episodeTitle(e)), e.overview ? el('span', {}, e.overview) : null),
        el('span', { class: 'episode-play', 'aria-hidden': 'true' }, '›'))));
    };
    draw();
    nodes.push(el('div', { class: 'section-head' }, el('h2', {}, 'Capítulos'), el('span', {}, `${item.episodes.length}`)), chips, list);
  }
  if (info.cast?.length) {
    nodes.push(el('div', { class: 'section-head' }, el('h2', {}, 'Reparto')),
      el('ul', { class: 'cast-list' }, info.cast.map((c) => el('li', {}, el('b', {}, c.name), c.character ? el('span', {}, c.character) : null))));
  }
  nodes.push(attribution(el, library));
  return nodes;
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

/**
 * The «Pelis y series» admin section. Everything runs in this browser: the Drive folders are read with the
 * Drive API, titles are looked up in TMDB and the library is published to Firestore. `readSettings` and
 * `saveSettings` keep the TMDB key and the folders private; `publish` writes the library parts.
 */
export function libraryAdmin(el, { visible, setVisible, field, readSettings, saveSettings, publish, driveKey: defaultDriveKey }) {
  const status = el('p', { class: 'note', role: 'status' });
  const say = (text, error = false) => { status.textContent = text; status.className = error ? 'error' : 'note'; };
  const toggle = el('input', { type: 'checkbox', checked: visible });
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try { await setVisible(toggle.checked); say(toggle.checked ? 'Publicado: Películas, Series y Documentales aparecen en el menú.' : 'Oculto: el menú ya no los muestra.'); }
    catch (error) { toggle.checked = !toggle.checked; say(error.message, true); }
    finally { toggle.disabled = false; }
  });
  const key = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Clave de la API de TMDB (v3) o token de lectura (v4)' });
  const googleKey = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Opcional: clave de Google propia (AIza…)' });
  const folders = Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, el('input', { placeholder: `https://drive.google.com/drive/folders/… (${s.label.toLowerCase()})` })]));
  const list = el('div', { class: 'library-admin-list' }, el('p', { class: 'note' }, 'Cargando la biblioteca…'));
  const save = el('button', { class: 'btn secondary', type: 'button' }, 'Guardar configuración');
  const scan = el('button', { class: 'btn', type: 'button' }, 'Escanear carpetas de Drive y buscar en TMDB');
  const busy = (on) => { save.disabled = scan.disabled = on; };
  let settings = {}, current = { sections: {} };
  const tmdbKey = () => { if (!settings.tmdb) throw new Error('Añade la clave de TMDB en la configuración.'); return settings.tmdb; };
  const store = async (sections) => {
    current = { ...current, sections };
    await publish(libraryParts(sections));
  };
  const replaceItem = (id, change) => Object.fromEntries(Object.entries(current.sections).map(([section, items]) => [section, items.map((item) => item.id === id ? change(item) : item)]));

  const drawList = () => {
    list.replaceChildren(...LIBRARY_SECTIONS.flatMap((section) => {
      const items = current.sections[section.key] || [];
      return [el('h3', {}, `${section.label} · ${items.length}`), ...items.map((item) => adminRow(section, item))];
    }));
  };
  const adminRow = (section, item) => {
    const found = el('div', { class: 'library-results' });
    const query = el('input', { type: 'search', value: item.title, 'aria-label': `Buscar ${item.title} en TMDB` });
    const search = el('button', { class: 'btn small secondary', type: 'button' }, 'Buscar');
    const pick = async (id, kind) => {
      busy(true); say('Guardando…');
      try {
        const match = id ? await tmdbDetails(id, kind, tmdbKey(), seasonsOf(item)) : null;
        await store(replaceItem(item.id, (old) => applyMatch(old, match)));
        say('Guardado y publicado.'); drawList();
      } catch (error) { say(error.message, true); } finally { busy(false); }
    };
    search.addEventListener('click', async () => {
      search.disabled = true; found.replaceChildren(el('p', { class: 'note' }, 'Buscando…'));
      try {
        const results = await searchTmdb(query.value.trim(), null, section.key === 'series' ? 'tv' : 'movie', tmdbKey());
        found.replaceChildren(...results.map((r) => el('button', { class: 'library-result', type: 'button', onclick: () => pick(r.id, r.kind) },
          r.poster ? el('img', { src: r.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
          el('span', {}, el('b', {}, `${r.title}${r.year ? ` (${r.year})` : ''}`), el('small', {}, r.kind === 'tv' ? 'Serie' : 'Película'), r.overview ? el('small', {}, r.overview) : null))),
          el('button', { class: 'ghost', type: 'button', onclick: () => pick(null) }, 'No es ninguno'));
        if (!results.length) found.prepend(el('p', { class: 'note' }, 'Sin resultados. Prueba con otro título.'));
      } catch (error) { found.replaceChildren(el('p', { class: 'error' }, error.message)); }
      finally { search.disabled = false; }
    });
    const state = item.status === 'matched' ? `✓ ${itemTitle(item)}${itemYear(item) ? ` (${itemYear(item)})` : ''}` : item.status === 'none' ? 'Sin reconocer' : 'Pendiente';
    return el('details', { class: 'library-item' },
      el('summary', {}, item.tmdb?.poster ? el('img', { src: item.tmdb.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
        el('span', { class: 'meta' }, el('b', {}, item.kind === 'tv' ? item.folder : item.file), el('span', { class: item.status === 'matched' ? 'ok' : 'note' }, state))),
      el('div', { class: 'library-search-row' }, query, search), found);
  };

  (async () => {
    try {
      settings = await readSettings();
      if (settings.tmdb) key.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      if (settings.driveKey) googleKey.placeholder = 'Clave de Google propia guardada (escribe otra para cambiarla)';
      for (const s of LIBRARY_SECTIONS) folders[s.key].value = settings.folders?.[s.key] || '';
      current = await fetchLibrary({ fresh: true });
      drawList();
    } catch (error) { say(error.message, true); list.replaceChildren(); }
  })();
  save.addEventListener('click', async () => {
    busy(true); say('Guardando…');
    try {
      const next = { ...settings, folders: {} };
      for (const s of LIBRARY_SECTIONS) {
        const value = folders[s.key].value.trim();
        if (value && !driveFolderId(value)) throw new Error(`El enlace de ${s.label.toLowerCase()} no es de una carpeta de Google Drive.`);
        next.folders[s.key] = value;
      }
      if (key.value.trim()) { await checkTmdbKey(key.value.trim()); next.tmdb = key.value.trim(); }
      if (googleKey.value.trim()) {
        if (!/^AIza[A-Za-z0-9_-]{35}$/.test(googleKey.value.trim())) throw new Error('La clave de Google empieza por AIza y tiene 39 caracteres.');
        next.driveKey = googleKey.value.trim();
      }
      await saveSettings(next);
      settings = next; key.value = ''; googleKey.value = '';
      if (settings.tmdb) key.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      say('Configuración guardada (privada, solo para el administrador).');
    } catch (error) { say(error.message, true); } finally { busy(false); }
  });
  scan.addEventListener('click', async () => {
    busy(true);
    try {
      tmdbKey();
      const drive = settings.driveKey || defaultDriveKey;
      const scanned = {};
      for (const s of LIBRARY_SECTIONS) {
        const folder = driveFolderId(settings.folders?.[s.key]);
        if (!folder) { scanned[s.key] = []; continue; }
        say(`Leyendo la carpeta de ${s.label.toLowerCase()} en Google Drive…`);
        scanned[s.key] = await sectionItems(s.key, folder, await driveVideos(folder, drive));
      }
      let sections = mergeScan(scanned, current);
      await store(sections);
      const todo = Object.values(sections).flat().filter((item) => item.status === 'pending' || item.status === 'refresh');
      say(`Encontrados: ${LIBRARY_SECTIONS.map((s) => `${sections[s.key].length} ${s.label.toLowerCase()}`).join(', ')}. Buscando ${todo.length} en TMDB…`);
      for (const [n, item] of todo.entries()) {
        let match = null;
        if (item.status === 'refresh' && item.tmdb?.id) match = await tmdbDetails(item.tmdb.id, 'tv', tmdbKey(), seasonsOf(item));
        else {
          const kind = item.kind === 'tv' ? 'tv' : 'movie';
          const best = (await searchTmdb(item.title, item.year, kind, tmdbKey()))[0];
          if (best && confident(item.title, best.title)) match = await tmdbDetails(best.id, best.kind, tmdbKey(), seasonsOf(item));
        }
        current = { ...current, sections: replaceItem(item.id, (old) => applyMatch(old, match)) };
        say(`Buscando en TMDB… ${n + 1} de ${todo.length}.`);
        if ((n + 1) % 25 === 0) await store(current.sections); // Progress is kept if the page is closed.
      }
      await store(current.sections);
      say('Biblioteca publicada. Revisa abajo los títulos «Sin reconocer» y búscalos a mano.');
      drawList();
    } catch (error) { say(error.message, true); } finally { busy(false); }
  });
  return [el('div', { class: 'section-head' }, el('h2', {}, 'Pelis y series')),
    el('label', { class: 'actions library-switch' }, toggle, 'Mostrar Películas, Series y Documentales a los usuarios (web y app)'),
    el('details', { class: 'image-settings' }, el('summary', {}, 'Configuración: TMDB y carpetas de Google Drive'),
      el('p', { class: 'note' }, 'Crea una clave gratuita en themoviedb.org → Ajustes → API y pégala aquí. Se guarda en Firebase, visible solo para el administrador.'),
      field('Clave de TMDB', key),
      el('p', { class: 'note' }, 'Carpetas de Google Drive: en Drive, botón derecho sobre cada carpeta → Compartir → Acceso general «Cualquier persona con el enlace» (Lector) → Copiar enlace, y pégalo aquí. Dentro, el mismo sistema: en Series una subcarpeta por serie (y si quieres «Temporada N» dentro).'),
      ...LIBRARY_SECTIONS.map((s) => field(`Carpeta de ${s.label.toLowerCase()}`, folders[s.key])),
      field('Clave de Google para Drive (opcional)', googleKey, 'Vacía: se usa la del proyecto de Firebase, que necesita «Google Drive API» activada en Google Cloud.'), el('div', { class: 'actions' }, save)),
    el('div', { class: 'actions' }, scan), status, list];
}
