import { merge, events, eventRows, homeHighlights, featured, groups, categoryList, webPlayback, findChannel, explainStreamError, streamFailureReport } from './catalog.js';
import { eventPath, eventShareLink, EVENT_STATES } from './sports.js';
import { initControls, icon } from './player-controls.js';
import { mountTs, videoFailure } from './ts-player.js';
import { prepareCastSource } from './cast-adapter.js';
import { prepareHostedVideo } from './video-bridge.js';
import { openMulti, closeMulti, multiPlayable, MULTI_MAX } from './multi-view.js';
import { initCast } from './cast-player.js';
import { sourceOptions, selectedSource, renderSourcePicker } from './player-sources.js';
import { audienceTarget, sessionId, visitKey, madridDay, eventLabel, nextStart, HEARTBEAT_MS, COUNT_MS } from './audience.js';

const view = document.getElementById('view');
const search = document.getElementById('search');
let sharedStarted = false;
// Firebase loads on demand so the bundled catalog works even when it cannot be reached.
let firebase = null;
const shared = () => (firebase ||= import('./firebase.js'));
let sharedValue = null;
const state = { tdt: null, custom: null, channels: [], error: '' };

export async function fetchJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function loadCatalog() {
  const [tdt, custom] = await Promise.all([fetchJson('data/tdt.json'), fetchJson('data/custom.json')]);
  state.tdt = tdt;
  state.custom = sharedValue || custom;
  state.channels = merge(tdt, state.custom);
  if (!sharedStarted) {
    sharedStarted = true;
    // Keep the bundled catalog usable even if Firebase cannot be reached.
    shared().then(({ watchCatalog }) => watchCatalog(custom, ({ data }) => {
      sharedValue = data;
      state.custom = data;
      state.channels = merge(state.tdt, data);
      if (!location.hash.startsWith('#/admin')) route();
    }, () => {})).catch(() => {});
  }
  return state;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
  return node;
}
export { el };

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** A stable hue per channel so every card gets its own colour without any artwork. */
function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function logo(c, cls) {
  const fallback = () => el('span', { class: `initials ${cls || ''}`.trim() }, initials(c.name));
  if (!c.logo) return fallback();
  const img = el('img', { src: c.logo, alt: '', loading: cls ? 'eager' : 'lazy', referrerpolicy: 'no-referrer', class: cls });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

/** A channel or event card; with `pick` it selects for multi-screen instead of opening. */
function card(c, pick = null) {
  return el(
    'button',
    { class: `${c.event ? 'card event-card' : 'card'}${pick?.selected ? ' picked' : ''}`, type: 'button', style: c.color && !c.event ? `--h:${hue(c.name)};--c:${c.color}` : `--h:${hue(c.name)}`,
      onclick: pick ? pick.toggle : () => open(c), 'aria-pressed': pick ? String(!!pick.selected) : null, 'aria-label': pick ? c.name : null,
      title: pick ? `${pick.selected ? 'Quitar' : 'Añadir'} ${c.name}` : c.playable ? `Ver ${c.name}` : `Abrir la web de ${c.name}` },
    el(
      'span',
      { class: 'art' },
      c.event ? el('img', { class: 'event-cover', src: c.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : logo(c),
      c.event ? eventBadge(c, 'badge') : null,
      pick ? el('span', { class: 'pick-mark', 'aria-hidden': 'true' }, pick.selected ? String(pick.selected) : '+') : c.playable ? el('span', { class: 'play-hover' }, icon('play')) : null,
    ),
    el('span', { class: 'name' }, c.name),
    el('span', { class: 'sub' }, c.event ? c.meta || c.channelName : c.region || c.group),
  );
}

/** Until an event starts its badge shows the date and time; then «En directo». */
function eventBadge(c, cls) {
  const label = eventLabel(c, Date.now(), EVENT_STATES);
  return el('span', { class: `${cls}${label.live ? ' live' : ''}${label.upcoming ? ' upcoming' : ''}` }, label.text);
}

function sectionHead(title, aside) {
  return el('div', { class: 'section-head' }, el('h2', {}, title), aside);
}

/** A horizontal row of cards with previous/next arrows on devices that have a pointer. */
function rail(items, { wide = false, limit = 40 } = {}) {
  const track = el('div', { class: wide ? 'rail wide' : 'rail' }, items.slice(0, limit).map(card));
  const button = (dir, label) => el('button', { class: `rail-btn ${dir}`, type: 'button', 'aria-label': label, hidden: true }, icon(dir === 'prev' ? 'left' : 'right'));
  const prev = button('prev', 'Anteriores');
  const next = button('next', 'Siguientes');
  const sync = () => {
    prev.hidden = track.scrollLeft < 8;
    next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
  };
  const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  if (window.ResizeObserver) new ResizeObserver(sync).observe(track);
  requestAnimationFrame(sync);
  return el('div', { class: 'rail-wrap' }, prev, track, next);
}

let highlightTimer = null, highlightHost = null, highlightItems = [], highlightIndex = 0;
function stopHighlight() { clearTimeout(highlightTimer); highlightTimer = null; highlightHost = null; }
function scheduleHighlight() {
  clearTimeout(highlightTimer);
  if (!highlightHost || highlightItems.length < 2 || document.hidden) return;
  highlightTimer = setTimeout(() => {
    if (!highlightHost?.isConnected || !player.hidden) return;
    showHighlight(highlightIndex + 1);
  }, 5000);
}
function showHighlight(index, user = false) {
  if (!highlightHost) return;
  const focused = highlightHost.contains(document.activeElement);
  highlightIndex = (index + highlightItems.length) % highlightItems.length;
  const dots = highlightItems.length > 1 ? el('div', { class: 'slider-dots', role: 'group', 'aria-label': 'Elegir destacado' },
    highlightItems.map((item, i) => el('button', { type: 'button', 'aria-label': item.name, 'aria-pressed': String(i === highlightIndex), onclick: () => showHighlight(i, true) }))) : null;
  highlightHost.replaceChildren(heroSection(highlightItems, highlightIndex), ...(dots ? [dots] : []));
  if (focused || user) (highlightHost.querySelectorAll('.pick')[highlightIndex] || highlightHost.querySelector('button')).focus({ preventScroll: true });
  scheduleHighlight();
}
/** Moves on its own every 5 seconds; it can also be swiped (touch or mouse) or moved with the arrow keys. */
function highlightSlider(items) {
  highlightItems = items; highlightIndex = 0;
  const host = highlightHost = el('div', { class: 'highlight-slider', 'aria-roledescription': 'carrusel', 'aria-label': 'Destacados de portada' });
  let start = null, swiped = false;
  host.addEventListener('pointerdown', (e) => {
    swiped = false;
    if (highlightItems.length < 2 || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.hero-picks, .slider-dots')) return;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(highlightTimer);
  });
  host.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; showHighlight(highlightIndex + (dx < 0 ? 1 : -1)); }
    else scheduleHighlight();
  });
  host.addEventListener('pointercancel', () => { start = null; scheduleHighlight(); });
  // A swipe that ends over a button must not also open the channel.
  host.addEventListener('click', (e) => { if (swiped) { swiped = false; e.preventDefault(); e.stopPropagation(); } }, true);
  host.addEventListener('dragstart', (e) => e.preventDefault());
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' || highlightItems.length < 2 || e.target.matches('input, textarea, select')) return;
    e.preventDefault(); showHighlight(highlightIndex + (e.key === 'ArrowRight' ? 1 : -1), true);
  });
  showHighlight(0); return host;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(highlightTimer); else scheduleHighlight(); });

// When an event reaches its start time the home page is redrawn so its badge changes to «En directo».
let startTimer = null;
function scheduleStartRefresh(list) {
  clearTimeout(startTimer);
  const wait = nextStart(list);
  if (wait === null) return;
  startTimer = setTimeout(() => {
    if (player.hidden && !location.hash.startsWith('#/admin') && !search.value.trim()) route();
    else scheduleStartRefresh(list);
  }, Math.min(wait + 500, 6 * 3600000));
}

function heroSection(list, index = 0) {
  const c = list[index];
  const picks =
    list.length > 1
      ? el(
          'div',
          { class: 'hero-picks', role: 'group', 'aria-label': 'Canales destacados' },
          list.map((p, i) =>
            el(
              'button',
              {
                class: 'pick',
                type: 'button',
                title: p.name,
                'aria-label': p.name,
                'aria-pressed': String(i === index),
                onclick: () => {
                  showHighlight(i, true);
                },
              },
              p.event ? el('img', { src: p.cover, alt: '', class: 'pick-cover' }) : logo(p),
            ),
          ),
        )
      : null;
  let section = el(
    'section',
    { class: c.event ? 'hero event-hero' : 'hero', style: `--h:${hue(c.name)}`, 'aria-label': 'Canal destacado' },
    el('div', { class: 'hero-bg' }),
    c.event ? el('img', { class: 'event-hero-cover', src: c.cover, alt: '', referrerpolicy: 'no-referrer' }) : logo(c, 'hero-art'),
    el(
      'div',
      { class: 'hero-body' },
      c.event ? eventBadge(c, 'event-state') : null,
      el('h1', {}, c.name),
      el('p', { class: 'hero-meta' }, c.event ? c.meta || c.channelName : [c.group, c.region, c.own ? 'Canal de Calamar TV' : 'Emisión oficial en abierto'].filter(Boolean).join(' · ')),
      el(
        'div',
        { class: 'hero-actions' },
        el('button', { class: 'btn lg', type: 'button', onclick: () => open(c) }, icon('play'), 'Ver ahora'),
      ),
    ),
    picks,
  );
  return section;
}

function home() {
  const matches = events(state.channels, state.custom);
  const list = homeHighlights(state.channels, state.custom);
  scheduleStartRefresh(matches);
  const nodes = [];
  if (list.length) nodes.push(highlightSlider(list));
  // Only events on the home page: one row per league, each in date order (soonest first).
  for (const row of eventRows(matches, state.custom)) {
    nodes.push(sectionHead(el('span', { class: 'league-head' }, row.logo ? el('img', { src: row.logo, alt: '', referrerpolicy: 'no-referrer' }) : null, row.name),
      el('span', {}, row.events.length === 1 ? '1 evento' : `${row.events.length} eventos`)), rail(row.events, { wide: true, limit: row.events.length }));
  }
  if (!matches.length) nodes.push(el('p', { class: 'status' }, 'Todavía no hay eventos. ', el('a', { href: '#/canales' }, 'Ver los canales')));
  return nodes;
}

function channelsPage(selected) {
  const map = groups(state.channels, categoryList(state.custom).map((c) => c.name));
  const chips = el(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Categorías' },
    ['Todos', ...map.keys()].map((g) =>
      el('a', { class: 'chip', href: g === 'Todos' ? '#/canales' : `#/canales/${encodeURIComponent(g)}`, 'aria-pressed': String(g === (selected || 'Todos')) }, g),
    ),
  );
  const nodes = [chips];
  for (const [group, channels] of map) {
    if (selected && selected !== group) continue;
    nodes.push(sectionHead(group, el('span', {}, channels.length === 1 ? '1 canal' : `${channels.length} canales`)));
    const sorted = [...channels].sort((a, b) => a.region.localeCompare(b.region, 'es') || Number(b.playable) - Number(a.playable));
    let region = null;
    let grid = null;
    for (const c of sorted) {
      if (c.region && c.region !== region) {
        region = c.region;
        nodes.push(el('p', { class: 'region' }, region.toUpperCase()));
        grid = null;
      }
      if (!grid) nodes.push((grid = el('div', { class: 'grid' })));
      grid.append(card(c));
    }
  }
  return nodes;
}

// ---- Multi-screen ------------------------------------------------------------------------------
// Picked channels and events are kept as 'c:<slug>' / 'e:<slug>' keys, in the order they were chosen.
let multiPicks = [];
const multiKey = (c) => (c.event ? `e:${c.slug}` : `c:${c.slug}`);
function multiItems(keys) {
  const list = events(state.channels, state.custom);
  return keys.map((key) => (key.startsWith('e:') ? list.find((e) => e.slug === key.slice(2)) : findChannel(state.channels, key.slice(2)))).filter(Boolean);
}
function multiPage() {
  const query = el('input', { type: 'search', placeholder: 'Buscar canales y eventos', 'aria-label': 'Buscar para la multipantalla' });
  const watch = el('button', { class: 'btn', type: 'button' });
  const clear = el('button', { class: 'ghost', type: 'button' }, 'Quitar selección');
  const grid = el('div', { class: 'grid' });
  const candidates = [...events(state.channels, state.custom), ...state.channels].filter(multiPlayable);
  const norm = (s) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
  const draw = () => {
    multiPicks = multiPicks.filter((key) => candidates.some((c) => multiKey(c) === key));
    watch.textContent = multiPicks.length >= 2 ? `Ver ${multiPicks.length} a la vez` : 'Elige al menos 2';
    watch.disabled = multiPicks.length < 2;
    clear.hidden = !multiPicks.length;
    const q = norm(query.value.trim());
    grid.replaceChildren(...candidates.filter((c) => norm(`${c.name} ${c.group || ''}`).includes(q)).slice(0, 120).map((c) => {
      const position = multiPicks.indexOf(multiKey(c)) + 1;
      return card(c, { selected: position, toggle: () => {
        if (position) multiPicks = multiPicks.filter((key) => key !== multiKey(c));
        else if (multiPicks.length < MULTI_MAX) multiPicks = [...multiPicks, multiKey(c)];
        else { watch.textContent = `Máximo ${MULTI_MAX} a la vez`; return; }
        draw();
      } });
    }));
    if (!grid.children.length) grid.append(el('p', { class: 'status' }, 'No hay canales con ese nombre.'));
  };
  query.addEventListener('input', draw);
  clear.addEventListener('click', () => { multiPicks = []; draw(); });
  // Opening it goes through the address so Back closes the multi-screen.
  watch.addEventListener('click', () => {
    // On phones and tablets three or more videos go full screen and horizontal; browsers only allow
    // turning the screen in full screen, and only from a tap like this one.
    if (multiPicks.length > 2 && matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
    location.hash = `#/multipantalla/${multiPicks.map(encodeURIComponent).join('+')}`;
  });
  draw();
  return [sectionHead('Multipantalla', el('span', {}, `Hasta ${MULTI_MAX}`)),
    el('p', { class: 'note multi-note' }, 'Elige varios canales o eventos para verlos a la vez. Con 2 se reparten arriba y abajo; con más, en cuadrícula en horizontal.'),
    el('div', { class: 'multi-actions' }, el('label', { class: 'search multi-search' }, query), watch, clear), grid];
}
function showMulti(arg) {
  const items = multiItems(arg.split('+').map(decodeURIComponent));
  if (items.length < 1) { history.replaceState(null, '', '#/multipantalla'); return false; }
  multiPicks = items.map(multiKey);
  openMulti(items, {
    onClose: () => { if (history.length > 1) history.back(); else location.hash = '#/multipantalla'; },
    onWatch: (c) => shared().then((f) => f.recordVisit(madridDay(), visitKey(c.event ? 'event' : 'channel', c.event ? c.eventId : c.id))
      .then(() => c.event && f.recordVisit(madridDay(), visitKey('channel', c.channelId)))).catch(() => {}),
  });
  return true;
}

function results(query) {
  const q = query.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
  const norm = (s) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
  const found = [...events(state.channels, state.custom), ...state.channels].filter((c) => norm(`${c.name} ${c.region} ${c.group}`).includes(q));
  return [sectionHead(`Resultados para «${query}»`, el('span', {}, `${found.length} canales`)), found.length ? el('div', { class: 'grid' }, found.map(card)) : el('p', { class: 'status' }, 'No hay canales con ese nombre.')];
}

// ---- Player ----------------------------------------------------------------------------------

const player = document.getElementById('player');
const video = document.getElementById('video');
const playerTitle = document.getElementById('player-title');
const playerStatus = document.getElementById('player-status');
const playerSources = document.getElementById('player-sources');
const playerLogo = document.getElementById('player-logo');
let hls = null;
let stopTs = null;
let returnFocus = null;
let playbackGeneration = 0;
let currentSourceUrl = '';
const controls = initControls({ root: player, video, onClose: () => closePlayer(), canClose: () => !player.hidden });
initCast({
  button: document.getElementById('ctl-cast'),
  toggle: document.getElementById('ctl-cast-toggle'),
  disconnect: document.getElementById('ctl-cast-disconnect'),
  getSource: () => current && currentSourceUrl ? { url: currentSourceUrl, title: current.name, logo: current.logo } : null,
  onSent: stop,
  onStatus: (message) => { playerStatus.textContent = message; },
  onDisconnect: () => { if (current) playSource(current, Math.max(0, current.streams.indexOf(currentSourceUrl))); },
});
// While the player is open nothing behind it can be reached with the keyboard or a screen reader.
const behind = () => document.querySelectorAll('.skip, .top, main, .foot');

function stop() {
  playbackGeneration++;
  video.onerror = null;
  video.onplaying = null;
  if (stopTs) { stopTs(); stopTs = null; }
  if (hls) hls.destroy();
  hls = null;
  video.removeAttribute('src');
  video.load();
  controls.reset();
}

function playSource(c, index) {
  stop();
  const generation = playbackGeneration;
  const allSources = sourceOptions(c.streams);
  const candidates = allSources.filter((source) => source.how.ok);
  // A signed link past its time cannot work, so do not even try it.
  const playable = candidates.filter((s) => !s.expiry || s.expiry > Date.now());
  const source = selectedSource(allSources, index);
  currentSourceUrl = source?.url || '';
  renderSourcePicker(playerSources, allSources, source?.index ?? index, (chosen) => playSource(c, chosen));
  if (candidates.length && !playable.length) {
    const when = new Date(Math.max(...candidates.map((s) => s.expiry))).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    playerStatus.textContent = `El enlace de este canal caducó el ${when}. Los enlaces con token duran pocas horas y el administrador tiene que renovarlo.`;
    return;
  }
  if (!playable.length) {
    const reason = webPlayback(c.streams[0] || '').reason || 'Sin fuente compatible';
    playerStatus.replaceChildren(`${reason}. Disponible en la app Calamar TV.`, c.web ? el('span', {}, ' ', el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'Ver en su web oficial')) : '');
    return;
  }
  const position = playable.findIndex((item) => item.index === source.index);
  let failureHandled = false;
  const next = (data) => {
    if (generation !== playbackGeneration || failureHandled) return;
    failureHandled = true;
    if (position + 1 < playable.length) {
      playerStatus.textContent = 'Esta fuente no responde. Probando la siguiente…';
      playSource(c, playable[position + 1].index);
    } else {
      // A fatal network error is no longer a buffering state. Keep the failure
      // visible and stop outstanding requests until the user retries.
      if (hls) hls.stopLoad();
      if (stopTs) { stopTs(); stopTs = null; }
      video.pause();
      player.classList.remove('is-buffering');
      const failure = {
        details: data?.details || '',
        code: data?.response?.code || 0,
        url: data?.url || data?.frag?.url || source.url,
        expiry: source.expiry,
        mediaCode: data?.mediaCode || 0,
      };
      const reason = data?.userMessage || (data ? explainStreamError(failure) : 'No se pudo reproducir esta emisión en el navegador.');
      const report = streamFailureReport(failure);
      const diagnosis = el('details', {}, el('summary', {}, 'Ver detalle del fallo'),
        el('p', {}, `${report.stage} · ${report.code ? `HTTP ${report.code}` : 'Sin respuesta HTTP'}${report.host ? ` · ${report.host}` : ''}`),
        report.mediaCode ? el('p', {}, `Error de vídeo del navegador: ${report.mediaCode === 3 ? 'decodificación' : report.mediaCode === 2 ? 'conexión interrumpida' : 'formato no compatible'} (código ${report.mediaCode}).`) : null,
        report.expiresAt ? el('p', {}, `Caducidad indicada por el enlace: ${new Date(report.expiresAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} (España).`) : null);
      const retry = el('button', { type: 'button', class: 'ghost', onclick: () => {
        // Firebase may have delivered fresh URLs since playback began.
        const latest = state.channels.find((item) => item.id === c.id) || c;
        playSource(latest, 0);
      } }, '↻ Refrescar');
      // Direct navigation may work even when hls.js fetches from GitHub Pages are
      // rejected by CORS or by the origin policy of the upstream CDN.
      // Use a real link instead of trying to proxy or bypass access controls.
      const direct = el('a', {
        class: 'ghost',
        href: source.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        referrerpolicy: 'no-referrer',
      }, '▶ Abrir emisión directamente');
      playerStatus.replaceChildren(
        `${reason} `,
        retry,
        ' ',
        direct,
        c.web ? el('span', {}, ' ', el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'Web oficial')) : '',
        diagnosis,
      );
    }
  };
  playerStatus.textContent = 'Conectando…';
  if (source.how.kind === 'ts') {
    video.onplaying = () => { if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = ''; };
    video.onerror = null; // mountTs owns media errors and retries; do not preempt it.
    controls.attach(null);
    stopTs = mountTs({ library: window.mpegts, video, address: source.url, relay: source.how.relay,
      onFailure: (data) => queueMicrotask(async () => {
        if (generation !== playbackGeneration) return;
        if (!source.how.relay || !/codec|decode|buffer/i.test(data?.details || '')) { next(data); return; }
        if (stopTs) { stopTs(); stopTs = null; }
        video.removeAttribute('src');
        video.load();
        playerStatus.textContent = 'Adaptando el vídeo para este navegador…';
        try {
          const compatible = await prepareCastSource(source.url, {
            isCurrent: () => generation === playbackGeneration,
            onStatus: () => { if (generation === playbackGeneration) playerStatus.textContent = 'Adaptando el vídeo para este navegador…'; },
          });
          if (generation !== playbackGeneration || !compatible) return;
          video.onerror = () => { const failure = videoFailure(video.error); if (failure) next(failure); };
          if (window.Hls?.isSupported()) {
            hls = new window.Hls({ lowLatencyMode: false });
            hls.on(window.Hls.Events.ERROR, (_event, failure) => { if (failure.fatal) next(failure); });
            hls.loadSource(compatible.url);
            hls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = compatible.url;
          else { next({ details: 'codecUnsupported' }); return; }
          controls.attach(hls);
          video.play().catch(() => {
            if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = 'Pulsa ▶ para empezar.';
          });
        } catch (error) {
          if (generation === playbackGeneration) next({ ...data, userMessage: error.message || 'No se pudo adaptar el vídeo en el hosting.' });
        }
      }),
      onRecovering: () => { if (generation === playbackGeneration) playerStatus.textContent = 'Reconectando con la emisión…'; },
      onPlaying: () => { if (generation === playbackGeneration) playerStatus.textContent = ''; },
    });
    return;
  }
  if (source.how.kind === 'file') {
    // A video file of the hosting: FFmpeg there turns its audio into AAC so the browser can play it.
    playerStatus.textContent = 'Preparando el vídeo…';
    controls.attach(null);
    prepareHostedVideo(source.url, {
      isCurrent: () => generation === playbackGeneration,
      onStatus: (message) => { if (generation === playbackGeneration) playerStatus.textContent = message; },
    }).then((ready) => {
      if (!ready || generation !== playbackGeneration) return;
      video.onplaying = () => { if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = ''; };
      video.onerror = () => { const failure = videoFailure(video.error); if (failure) next(failure); };
      if (window.Hls?.isSupported()) {
        // The playlist grows while the file is converted: start at the beginning, not at its end.
        hls = new window.Hls({ startPosition: 0 });
        hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data.fatal) next(data); });
        hls.loadSource(ready.url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = ready.url;
      else { next({ details: 'codecUnsupported' }); return; }
      controls.attach(hls);
      video.play().catch(() => {
        if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = 'Pulsa ▶ para empezar.';
      });
    }).catch((error) => { if (generation === playbackGeneration) next({ userMessage: error.message }); });
    return;
  }
  if (source.how.kind === 'hls' && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ lowLatencyMode: false });
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) next(data);
    });
    hls.loadSource(source.url);
    hls.attachMedia(video);
  } else {
    video.src = source.url;
  }
  controls.attach(hls);
  video.onplaying = () => { if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = ''; };
  video.onerror = () => { const failure = videoFailure(video.error); if (failure) next(failure); };
  video.play().catch(() => {
    if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = 'Pulsa ▶ para empezar.';
  });
}

// ---- Audience -------------------------------------------------------------------------------
// While the player is open this tab reports what it watches once a minute and shows how many
// people are watching the same channel or event. Nothing about the viewer is stored.
const viewersBadge = document.getElementById('player-viewers');
let watching = null;
function showViewers(count) {
  viewersBadge.hidden = !Number.isInteger(count) || count < 1;
  viewersBadge.querySelector('b').textContent = count > 999 ? `${(count / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} mil` : String(count);
  const text = count === 1 ? '1 persona viendo' : `${count} personas viendo`;
  viewersBadge.querySelector('.sr').textContent = text;
  viewersBadge.title = text;
}
function startAudience(c, visit = true) {
  const target = audienceTarget(c);
  if (watching?.target === target) return;
  stopAudience();
  const session = { target, id: sessionId(), timers: [] };
  watching = session;
  const live = () => watching === session;
  const count = () => shared().then((f) => f.viewers(target)).then((n) => { if (live()) showViewers(n); }).catch(() => {});
  const beat = () => shared().then((f) => f.beat(session.id, target)).catch(() => {});
  beat().then(() => { if (live()) count(); });
  session.timers.push(setInterval(beat, HEARTBEAT_MS), setInterval(count, COUNT_MS));
  // One visit per opening; refreshes of the same player are not new visits. An event also counts
  // as a visit to the channel it plays on. The rules accept one counter per write, so each goes alone.
  if (visit) {
    const day = madridDay();
    const keys = c.event ? [visitKey('event', c.eventId), visitKey('channel', c.channelId)] : [visitKey('channel', c.id)];
    shared().then(async (f) => { for (const key of keys) await f.recordVisit(day, key); }).catch(() => {});
  }
}
function stopAudience() {
  if (!watching) return;
  const session = watching;
  watching = null;
  for (const timer of session.timers) clearInterval(timer);
  showViewers(0);
  shared().then((f) => f.leave(session.id)).catch(() => {});
}
window.addEventListener('pagehide', stopAudience);
window.addEventListener('pageshow', (e) => { if (e.persisted && current && !player.hidden) startAudience(current, false); });

// Every channel has a link of its own: its id is the slug (#/canal/la-1).
let current = null;
let pushed = false;
const channelLink = (c) => `${location.origin}${location.pathname}${c.event ? eventPath(c) : `#/canal/${encodeURIComponent(c.slug)}`}`;

function open(c, fromRoute = false) {
  if (!c.playable) {
    window.open(c.web, '_blank', 'noopener');
    return;
  }
  if (!fromRoute) {
    history.pushState(null, '', c.event ? eventPath(c) : `#/canal/${encodeURIComponent(c.slug)}`);
    pushed = true;
  }
  if (player.hidden) returnFocus = document.activeElement;
  current = c;
  shareButton.hidden = !c.event;
  playerTitle.textContent = c.name;
  playerLogo.hidden = !c.logo;
  if (c.logo) playerLogo.src = c.logo;
  player.hidden = false;
  document.body.style.overflow = 'hidden';
  for (const n of behind()) n.inert = true;
  controls.wake();
  document.getElementById('player-close').focus();
  startAudience(c);
  playSource(c, 0);
}

function hidePlayer() {
  if (controls.isFullscreen()) controls.leaveFullscreen();
  stop();
  stopAudience();
  current = null;
  player.hidden = true;
  document.body.style.overflow = '';
  for (const n of behind()) n.inert = false;
  if (returnFocus) returnFocus.focus();
}

function closePlayer() {
  hidePlayer();
  if (!/^#\/(canal|evento)\//.test(location.hash)) return;
  if (pushed) {
    pushed = false;
    history.back();
  } else {
    history.replaceState(null, '', '#/');
    route();
  }
}

document.getElementById('player-refresh').addEventListener('click', () => {
  if (current) playSource(current, Math.max(0, current.streams.indexOf(currentSourceUrl)));
});
document.getElementById('player-close').addEventListener('click', closePlayer);
// Events are shared through their preview page, so WhatsApp and others show the cover and the name.
const shareButton = document.getElementById('player-share');
shareButton.addEventListener('click', async () => {
  if (!current?.event) return;
  const url = eventShareLink(current);
  try {
    if (navigator.share) await navigator.share({ title: current.name, url });
    else { await navigator.clipboard.writeText(url); shareButton.textContent = 'Enlace copiado'; setTimeout(() => { shareButton.textContent = 'Compartir'; }, 2500); }
  } catch (error) {
    if (error?.name !== 'AbortError') playerStatus.textContent = `Copia este enlace para compartir: ${url}`;
  }
});

// ---- Routing ---------------------------------------------------------------------------------

let routeVersion = 0;
async function route() {
  const version = ++routeVersion;
  stopHighlight();
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [page, arg] = hash.split('/');
  for (const a of document.querySelectorAll('[data-route]'))
    a.toggleAttribute('aria-current', a.dataset.route === (page || 'inicio'));
  for (const a of document.querySelectorAll('[aria-current]')) a.setAttribute('aria-current', 'page');
  if (page === 'admin') {
    try {
      const admin = await import('./admin.js');
      if (version !== routeVersion) return;
      const nodes = await admin.render(state);
      if (version !== routeVersion) return;
      view.replaceChildren(...nodes);
    } catch {
      view.replaceChildren(el('p', { class: 'error' }, 'No se pudo conectar con el acceso de Google. Comprueba la conexión y recarga.'));
    }
    return;
  }
  if (!state.tdt) {
    view.replaceChildren(el('div', { class: 'skeleton-hero', 'aria-hidden': 'true' }), el('p', { class: 'status', role: 'status' }, 'Cargando canales…'));
    try {
      await loadCatalog();
    } catch (e) {
      if (version !== routeVersion) return;
      view.replaceChildren(el('p', { class: 'error' }, `No se pudo cargar el catálogo (${e.message}). Recarga la página.`));
      return;
    }
  }
  // A slower initial catalog request must never overwrite a newly selected tab.
  if (version !== routeVersion) return;
  if (!['canal', 'evento'].includes(page) && !player.hidden) hidePlayer();
  if (page !== 'multipantalla' || !arg) closeMulti();
  if (page === 'multipantalla') {
    if (arg && showMulti(arg)) { view.replaceChildren(...multiPage()); return; }
    view.replaceChildren(...multiPage());
    return;
  }
  if (page === 'canal' || page === 'evento') {
    const c = page === 'evento' ? (events(state.channels, state.custom).find(e => e.slug === arg) || events(state.channels, state.custom).find(e => e.eventId === arg)) : findChannel(state.channels, arg);
    // Moving from an open channel to one that cannot be played here must not leave the old one running.
    if ((!c || !c.playable) && !player.hidden) hidePlayer();
    view.replaceChildren(
      ...(c && !c.playable
        ? [el('p', { class: 'status' }, `${c.name} solo tiene emisión en su web oficial: `, el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'abrir su web')), ...home()]
        : c
          ? home()
          : [el('p', { class: 'error' }, `No existe ${page === 'evento' ? 'el evento' : 'el canal'} «${arg || ''}». Si es nuevo, espera unos segundos y recarga.`), ...home()]),
    );
    // A catalog refresh rebuilds the channel objects; compare ids so playback is not restarted.
    if (c && c.playable && (player.hidden || !current || current.id !== c.id)) open(c, true);
    else if (c && !player.hidden) {
      // New links can arrive from the admin while the current video keeps playing.
      current = c;
      renderSourcePicker(playerSources, sourceOptions(c.streams), c.streams.indexOf(currentSourceUrl),
        (chosen) => playSource(c, chosen));
    }
    return;
  }
  const query = search.value.trim();
  view.replaceChildren(...(query ? results(query) : page === 'canales' ? channelsPage(arg) : home()));
}

let typing;
search.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(route, 180);
});
window.addEventListener('hashchange', () => {
  // A new section starts at the top, but closing the player must leave the page where it was.
  const closingPlayer = !player.hidden;
  search.value = '';
  if (!closingPlayer && !location.hash.startsWith('#/canal/')) window.scrollTo(0, 0);
  route();
});
route();
