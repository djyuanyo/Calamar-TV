// Films, series and documentaries chosen in TMDB by the administrator, each with its video link
// (LuluStream or a direct video), with synopsis, genres, cast, rating and posters from TMDB. The administrator shows or hides the whole catalog (catalog field
// `libraryVisible`); while hidden the menu does not offer it. Published by the admin page to Firestore (calamarLibrary: an index and parts), read here without
// signing in; the videos play from Google Drive. Nothing depends on the hosting.
import { firebaseConfig } from './firebase-config.js';
import { searchTmdb, tmdbDetails, seasonEpisodes, movieItem, seriesWithSeason, libraryParts, checkTmdbKey } from './library-tmdb.js';
import { luluFolder, scanLulu, libraryFromScan } from './library-lulu.js';
import { lulustreamEmbed, webPlayback } from './catalog.js';

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

/** A link the web or the app can play: LuluStream, or a direct HTTPS video (MP4, HLS…). */
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
    try { await setVisible(toggle.checked); say(toggle.checked ? 'Publicado: Películas, Series y Documentales aparecen en el menú.' : 'Oculto: el menú ya no los muestra.'); }
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
    const next = Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, sections[s.key] || []]));
    await publish(libraryParts(next));
    current = { ...current, sections: next };
    drawList();
  };
  const sectionOf = (id) => LIBRARY_SECTIONS.find((s) => (current.sections[s.key] || []).some((item) => item.id === id))?.key || null;
  const upsert = async (section, item) => {
    const sections = Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, (current.sections[s.key] || []).filter((x) => x.id !== item.id)]));
    sections[section] = [...sections[section], item].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), 'es', { sensitivity: 'base' }));
    await store(sections);
  };
  const remove = async (id) => store(Object.fromEntries(LIBRARY_SECTIONS.map((s) => [s.key, (current.sections[s.key] || []).filter((x) => x.id !== id)])));
  const linkInput = (value, label) => el('input', { type: 'url', value: value || '', placeholder: 'https://lulustream.com/…', 'aria-label': label, class: 'library-link' });
  const checkLinks = (inputs) => {
    const bad = inputs.find((i) => i.value.trim() && !validVideoLink(i.value));
    if (bad) { bad.focus(); throw new Error(`Enlace no válido: ${bad.value.trim()}. Pega el enlace del vídeo de LuluStream (https://lulustream.com/…) o un vídeo MP4/HLS por HTTPS.`); }
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
        editor.replaceChildren(head, field('Enlace del vídeo (LuluStream)', link, 'El enlace de la página del vídeo de LuluStream (lulustream.com, luluvido.com, luluvdo.com…).'),
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
      editor.replaceChildren(head, field('Temporada', seasonPick, 'Elige la temporada que quieres subir y pega el enlace de cada capítulo. Los capítulos sin enlace no se muestran.'),
        rows, el('div', { class: 'actions' }, save, del, close), note);
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
      const { films, shows, episodes } = result.added;
      scanNote.textContent = `Hecho: ${films} ${films === 1 ? 'película o documental' : 'películas y documentales'} y ${shows} ${shows === 1 ? 'serie' : 'series'} (${episodes} capítulos) publicados. Revisa la lista de abajo; puedes editar o quitar cualquiera.`;
      if (result.unknown.length) scanReport.replaceChildren(el('p', { class: 'note' }, `Sin añadir (${result.unknown.length}). Búscalos arriba en TMDB y pega su enlace, o cambia el nombre del archivo en LuluStream y vuelve a leer:`),
        el('ul', {}, result.unknown.map((line) => el('li', {}, line))));
    } catch (error) { scanNote.textContent = error.message; } finally { scanButton.disabled = false; }
  } }, 'Leer carpetas de LuluStream');

  // ---- What is in the library ----
  const list = el('div', { class: 'library-admin-list' }, el('p', { class: 'note' }, 'Cargando la biblioteca…'));
  function drawList() {
    list.replaceChildren(...LIBRARY_SECTIONS.flatMap((section) => {
      const items = current.sections[section.key] || [];
      return [el('h3', {}, `${section.label} · ${items.length}`), ...(items.length ? items.map((item) => el('div', { class: 'library-item' },
        el('div', { class: 'library-item-row' },
          item.tmdb?.poster ? el('img', { src: item.tmdb.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
          el('span', { class: 'meta' }, el('b', {}, `${itemTitle(item)}${itemYear(item) ? ` (${itemYear(item)})` : ''}`),
            el('span', { class: 'note' }, item.kind === 'tv' ? `${new Set(item.episodes.map((e) => e.season)).size} temporadas · ${item.episodes.length} capítulos con enlace` : 'Con enlace')),
          el('button', { class: 'btn small secondary', type: 'button', onclick: () => openEditor(section.key, item.tmdb?.id, item.kind === 'tv' ? 'tv' : 'movie') }, 'Editar')))) : [el('p', { class: 'note' }, 'Todavía no hay ninguno.')])];
    }));
  }

  (async () => {
    try {
      settings = await readSettings();
      if (settings.tmdb) key.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      if (settings.lulu) luluKey.placeholder = 'Clave guardada (escribe otra para cambiarla)';
      current = await fetchLibrary({ fresh: true });
      drawList();
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
    el('div', { class: 'actions' }, scanButton), scanNote, scanReport,
    el('h3', {}, 'Añadir una película, serie o documental'), searchForm, results, editor, status, list];
}
