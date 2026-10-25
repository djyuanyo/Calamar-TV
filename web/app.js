import { fetchMatch, fetchSummary, matchExpired, matchDeadline, shouldPollMatch } from './match-scores.js';
import { parseMatchCenter, renderMatchCenter, eventMatchModel } from './match-center.js';
import { merge, setLogoCopies, events, catalogEvents, PENDING, eventRows, homeHighlights, featured, groups, categoryList, webPlayback, findChannel, explainStreamError, streamFailureReport } from './catalog.js';
import { eventPath, eventShareLink, channelShareLink, EVENT_STATES } from './sports.js';
import { initControls, icon } from './player-controls.js';
import { mountTs, videoFailure } from './ts-player.js';
import { prepareCastSource } from './cast-adapter.js';
import { openMulti, closeMulti, multiPlayable, MULTI_MAX } from './multi-view.js';
import { LIBRARY_SECTIONS, sectionByPage, libraryVisible, fetchLibrary, libraryPage, libraryDetail, libraryEpisode, playable, continueRow,
  loadProgress, saveProgress, recordProgress, removeProgress, progressList, skipButton, withIntroDb } from './library.js';
import { initCast } from './cast-player.js';
import { sourceOptions, selectedSource, renderSourcePicker } from './player-sources.js';
import { audienceTarget, sessionId, visitKey, madridDay, eventLabel, nextStart, HEARTBEAT_MS, COUNT_MS, liveCounts } from './audience.js';

const view = document.getElementById('view');
const search = document.getElementById('search');
let sharedStarted = false;
// Firebase loads on demand so the bundled catalog works even when it cannot be reached.
let firebase = null;
const shared = () => (firebase ||= import('./firebase.js'));
let sharedValue = null;
// True once the live catalog arrived, failed or took too long: until then a link to an event or channel
// missing from the bundled copy is still loading, not missing.
let sharedSettled = false;
const settleShared = () => { if (sharedSettled) return; sharedSettled = true; if (!location.hash.startsWith('#/admin')) route(); };
const state = { tdt: null, custom: null, channels: [], error: '' };

export async function fetchJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function loadCatalog() {
  const [tdt, custom, copies] = await Promise.all([fetchJson('data/tdt.json'), fetchJson('data/custom.json'), fetchJson('data/logos.json').catch(() => ({}))]);
  setLogoCopies(copies);
  state.tdt = tdt;
  state.custom = sharedValue || custom;
  state.channels = merge(tdt, state.custom);
  if (!sharedStarted) {
    sharedStarted = true;
    // Keep the bundled catalog usable even if Firebase cannot be reached.
    setTimeout(settleShared, 12000);
    shared().then(({ watchCatalog }) => watchCatalog(custom, ({ data }) => {
      sharedValue = data;
      sharedSettled = true;
      state.custom = data;
      state.channels = merge(state.tdt, data);
      if (!location.hash.startsWith('#/admin')) route();
    }, settleShared)).catch(settleShared);
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
      title: pick ? `${pick.selected ? 'Quitar' : 'Añadir'} ${c.name}` : c.pending ? `${c.name} · ${PENDING}` : c.playable ? `Ver ${c.name}` : `Abrir la web de ${c.name}` },
    el(
      'span',
      { class: 'art' },
      c.event ? eventCover(c, 'event-cover') : logo(c),
      c.event ? eventBadge(c, 'badge') : null,
      cardAudience(c),
      pick ? el('span', { class: 'pick-mark', 'aria-hidden': 'true' }, pick.selected ? String(pick.selected) : '+') : c.playable ? el('span', { class: 'play-hover' }, icon('play')) : null,
    ),
    el('span', { class: 'name' }, c.name),
    el('span', { class: 'sub' }, c.event ? c.meta || c.channelName : c.region || c.group),
  );
}

/**
 * The cover of an event; without one, the league's background with the home and away crests on top
 * and the league's logo between them (imported matches all share it).
 */
function eventCover(c, cls) {
  if (c.cover) return el('img', { class: cls, src: c.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  const crest = (src, side) => src ? el('img', { class: `crest ${side}`, src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: `crest ${side} crest-empty` });
  return el('span', { class: `${cls} event-generic`, style: c.background ? `background-image:url("${c.background}")` : null, 'aria-hidden': 'true' },
    crest(c.homeLogo, 'home'),
    c.leagueLogo ? el('span', { class: 'crest-league' }, el('img', { src: c.leagueLogo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })) : el('span', { class: 'crest-vs' }, 'VS'),
    crest(c.awayLogo, 'away'));
}

/** Until an event starts its badge shows the date and time; then «En directo». */
const matchScores = new Map();
function eventBadge(c, cls) {
  const label = eventLabel(c, Date.now(), EVENT_STATES);
  const score = matchScores.get(c.matchId);
  const upcoming = label.upcoming && (!score || score.state === 'scheduled');
  const badge = el('span', { class: `${cls}${(score || label).live ? ' live' : ''}${upcoming ? ' upcoming' : ''}`, 'data-match-id': c.matchUrl && c.matchId ? c.matchId : null, 'data-match-start': c.matchUrl ? c.startAt : null, title: c.matchUrl ? 'Resultados: ESPN' : null }, upcoming ? label.text : score?.text || (c.matchUrl ? 'Consultando marcador…' : label.text));
  return badge;
}

/**
 * Events whose score is followed: all events (a finished one comes back if ESPN corrects it), and of the
 * imported matches only those of the coming days, not the whole season.
 */
const pollableEvents = (custom, now = Date.now()) => catalogEvents(custom).filter((e) => !e.imported
  || (Date.parse(e.startAt) <= now + 7 * 86400000 && Date.parse(e.startAt) + 86400000 > now));
let scoreBusy = false;
async function refreshScores() {
  if (scoreBusy || document.hidden) return;
  const ids = [...new Set([...pollableEvents(state.custom).filter(e => e.matchUrl && e.matchId).map(e => e.matchId), ...[...document.querySelectorAll('[data-match-id]')].map(n => n.dataset.matchId)])].filter(id => shouldPollMatch(id));
  scoreBusy = true;
  try { await Promise.allSettled(ids.map(async id => {
    let result;
    try { result = await fetchMatch(id); matchScores.set(id, result); }
    catch { result = { text: 'Marcador no disponible', live: false }; matchScores.delete(id); }
    for (const node of document.querySelectorAll('[data-match-id]')) if (node.dataset.matchId === id) {
      const scheduled = result.state === 'scheduled' && Date.parse(node.dataset.matchStart) > Date.now();
      node.textContent = scheduled ? eventLabel({ startAt: node.dataset.matchStart }, Date.now(), EVENT_STATES).text : result.text;
      node.classList.toggle('live', result.live); node.classList.toggle('upcoming', scheduled);
    }
  })); } finally { scoreBusy = false; syncEventExpiry(); }
}
let expiryTimer, expiredEvents = '';
function syncEventExpiry() {
  clearTimeout(expiryTimer);
  const now = Date.now(), ids = catalogEvents(state.custom).filter(e => e.matchUrl && e.matchId).map(e => String(e.matchId));
  const fingerprint = ids.filter(id => matchExpired(id, now)).sort().join('|');
  const changed = fingerprint !== expiredEvents; expiredEvents = fingerprint;
  const next = Math.min(...ids.map(matchDeadline).filter(time => time > now));
  if (Number.isFinite(next)) expiryTimer = setTimeout(syncEventExpiry, Math.min(next - now + 1, 2147483647));
  if (changed && !location.hash.startsWith('#/admin') && player.hidden) route();
}
setInterval(refreshScores, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncEventExpiry(); refreshScores(); } });
new MutationObserver(records => { if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches('[data-match-id]') || n.querySelector('[data-match-id]'))))) refreshScores(); }).observe(view, { childList: true, subtree: true });

const cardCounts = new Map();
let cardsReady = false, cardsBusy = false, cardsCheckedAt = 0;
function eyeIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>';
  return svg;
}
function cardAudience(c) {
  const target = audienceTarget(c), count = cardsReady ? cardCounts.get(target) || 0 : '—';
  return el('span', { class: 'card-viewers', 'data-audience-target': target, 'aria-label': `${count} personas viendo` }, eyeIcon(), el('b', {}, String(count)));
}
function paintCardAudience() {
  for (const node of document.querySelectorAll('[data-audience-target]')) {
    const count = cardsReady ? cardCounts.get(node.dataset.audienceTarget) || 0 : '—';
    node.querySelector('b').textContent = String(count); node.setAttribute('aria-label', count === '—' ? 'Espectadores no disponibles' : `${count} personas viendo`);
  }
}
async function refreshCardAudience() {
  if (document.hidden || cardsBusy || !document.querySelector('[data-audience-target]')) return;
  if (cardsCheckedAt && Date.now() - cardsCheckedAt < COUNT_MS) { paintCardAudience(); return; }
  cardsBusy = true;
  try {
    const f = await shared(), counts = liveCounts(await f.audience());
    cardCounts.clear(); for (const [target, count] of counts) cardCounts.set(target, count); cardsReady = true;
  } catch { cardsReady = false; }
  finally { cardsBusy = false; cardsCheckedAt = Date.now(); paintCardAudience(); }
}
setInterval(refreshCardAudience, COUNT_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { cardsCheckedAt = 0; refreshCardAudience(); } });
new MutationObserver(records => { if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches('[data-audience-target]') || n.querySelector('[data-audience-target]'))))) refreshCardAudience(); }).observe(view, { childList: true, subtree: true });

function sectionHead(title, aside) {
  return el('div', { class: 'section-head' }, el('h2', {}, title), aside);
}

/** A horizontal row of cards with previous/next arrows on devices that have a pointer. */
function rail(items, { wide = false, limit = 40 } = {}) {
  const track = el('div', { class: wide ? 'rail wide' : 'rail' }, items.slice(0, limit).map(c => card(c)));
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
              p.event ? eventCover(p, 'pick-cover') : logo(p),
            ),
          ),
        )
      : null;
  let section = el(
    'section',
    { class: c.event ? 'hero event-hero' : 'hero', style: `--h:${hue(c.name)}`, 'aria-label': 'Canal destacado' },
    el('div', { class: 'hero-bg' }),
    c.event ? eventCover(c, 'event-hero-cover') : logo(c, 'hero-art'),
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
  // Films and episodes left half watched in this browser come right under the featured slider.
  const unfinished = libraryShown() ? progressList(loadProgress()) : [];
  if (unfinished.length) nodes.push(...continueRow(el, unfinished, { open: resumeEntry,
    remove: (entry) => { saveProgress(removeProgress(loadProgress(), entry.key)); route(); } }));
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
  return [sectionHead(`Resultados para «${query}»`, el('span', {}, `${found.length} canales`)), found.length ? el('div', { class: 'grid' }, found.map(c => card(c))) : el('p', { class: 'status' }, 'No hay canales con ese nombre.')];
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
const controls = initControls({ root: player, video, onClose: () => closePlayer(), canClose: () => !player.hidden, onDemand: () => !!current?.vod });
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

/**
 * Automatic recovery: when the last source of a channel fails, it starts again from the first, up to
 * three rounds every two minutes. A player page read by the hosting is asked again with the round
 * number, so the hosting starts from another of its videos (CDN 2, CDN 3…).
 */
const recovery = { key: '', rounds: 0, since: 0 };
function recoveryRound(c, now = Date.now()) {
  if (recovery.key !== c.id || now - recovery.since > 120000) Object.assign(recovery, { key: c.id, rounds: 0, since: now });
  return ++recovery.rounds <= 3 ? recovery.rounds : 0;
}
const roundOf = (c) => (recovery.key === c.id && Date.now() - recovery.since <= 120000 ? recovery.rounds : 0);

function playSource(c, index) {
  stop();
  // An imported match without a channel yet: the match page alone, with no video.
  if (c.pending) {
    renderSourcePicker(playerSources, [], 0, () => {});
    playerStatus.textContent = `${PENDING}. El partido se verá aquí en cuanto tenga canal.`;
    return;
  }
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
    } else if (recoveryRound(c)) {
      // Back to the first source: a server that failed a moment ago often answers again.
      if (hls) hls.stopLoad();
      if (stopTs) { stopTs(); stopTs = null; }
      playerStatus.textContent = playable.length > 1 ? 'Ninguna fuente responde. Volviendo a probar desde la primera…' : 'La emisión se ha cortado. Reconectando…';
      setTimeout(() => {
        if (generation !== playbackGeneration) return;
        const latest = state.channels.find((item) => item.id === c.id) || c;
        playSource(latest, playable[0].index);
      }, 2000);
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
  // LuluStream videos come through the hosting (source.how.address): LuluStream only serves who opened its page.
  const round = roundOf(c);
  const address = source.how.page && round ? `${source.how.address}&intento=${round}` : source.how.address || source.url;
  if (source.how.kind === 'hls' && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ lowLatencyMode: false });
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      // The hosting answers 409 while LuluStream is still converting a video just uploaded.
      if (data.fatal && source.how.address && !source.how.page && data.response?.code === 409) data.userMessage = 'Este vídeo todavía se está procesando en LuluStream. Prueba de nuevo en un rato.';
      // Player pages read by the hosting (calamar-player.php): what failed, in plain words.
      if (data.fatal && source.how.page && /^manifest/i.test(data.details || '')) data.userMessage = pagePlaybackError(data.response?.code);
      if (data.fatal) next(data);
    });
    hls.loadSource(address);
    hls.attachMedia(video);
  } else {
    video.src = address;
  }
  controls.attach(hls);
  video.onplaying = () => { if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = ''; };
  video.onerror = () => { const failure = videoFailure(video.error); if (failure) next(failure); };
  video.play().catch(() => {
    if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = 'Pulsa ▶ para empezar.';
  });
}

function pagePlaybackError(code) {
  if (code === 403) return 'El hosting solo abre reproductores de canales del catálogo publicado. Si acabas de añadir el enlace, espera un minuto y pulsa Refrescar.';
  if (code === 404) return 'No se encontró el vídeo en la página del reproductor, o falta subir calamar-player.php al hosting.';
  if (code === 400) return 'Este enlace de reproductor no es válido.';
  return 'La página del reproductor no responde o ninguna de sus fuentes funciona ahora. Pulsa Refrescar en un momento.';
}

// ---- Audience -------------------------------------------------------------------------------
// While the player is open this tab reports what it watches once a minute and shows how many
// people are watching the same channel or event. Nothing about the viewer is stored.
const viewersBadge = document.getElementById('player-viewers');
let watching = null;
function showViewers(count) {
  viewersBadge.hidden = !Number.isInteger(count) || count < 0;
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
  if (!c.playable && !c.pending) {
    window.open(c.web, '_blank', 'noopener');
    return;
  }
  if (!fromRoute) {
    history.pushState(null, '', c.path || (c.event ? eventPath(c) : `#/canal/${encodeURIComponent(c.slug)}`));
    pushed = true;
  }
  if (player.hidden) returnFocus = document.activeElement;
  current = c;
  // Channels and events are shared through their preview page; films and episodes are not.
  shareButton.hidden = !!c.vod;
  // An imported match without a channel has no video: only its match page and the notice.
  player.classList.toggle('pending', !!c.pending);
  // Films and episodes have no «Refrescar»: it is for live channels and events.
  document.getElementById('player-refresh').hidden = !!c.vod;
  playerTitle.textContent = c.name;
  refreshScores();
  playerLogo.hidden = !c.logo;
  if (c.logo) playerLogo.src = c.logo;
  player.hidden = false;
  document.body.style.overflow = 'hidden';
  for (const n of behind()) n.inert = true;
  controls.wake();
  document.getElementById('player-close').focus();
  // Pressing «Ver» opens the video in full screen, as in the app. Browsers only allow it right after a
  // tap, so a link opened directly (fromRoute) starts in the normal player. Events with a Google match
  // link stay in the page instead, with the match's information, statistics and line-ups under the video.
  const withMatch = showMatchCenter(c);
  if (!fromRoute && !withMatch && !controls.isFullscreen()) controls.enterFullscreen();
  // Viewers and visits are counted per channel and event; films and episodes are not.
  if (!c.vod && !c.pending) startAudience(c);
  // Intro and credits of this episode from TheIntroDB, where none were typed in the admin page.
  if (c.skip && c.skipSource) withIntroDb(c.skip, c.skipSource).then((marks) => { if (current === c) { c.skip = marks; paintSkip(); } });
  playSource(c, 0);
  // Films and episodes continue where this browser left them.
  const resume = c.vod && !c.restart ? loadProgress()[c.progress?.key]?.position || 0 : 0;
  if (resume > 0) video.addEventListener('loadedmetadata', () => {
    if (current === c && (!Number.isFinite(video.duration) || video.duration > resume + 5)) video.currentTime = resume;
  }, { once: true });
  lastSaved = 0;
}

// ---- Continuar viendo: position of films and episodes, and the next episode when one ends ----------
let lastSaved = 0;
function rememberPosition(force = false) {
  if (!current?.vod || !current.progress || video.seeking) return;
  if (!force && Date.now() - lastSaved < 5000) return;
  lastSaved = Date.now();
  saveProgress(recordProgress(loadProgress(), current.progress, video.currentTime, video.duration));
}
video.addEventListener('timeupdate', () => rememberPosition());
video.addEventListener('pause', () => rememberPosition(true));
function playNext() {
  if (!current?.vod) return;
  saveProgress(removeProgress(loadProgress(), current.progress?.key));
  const following = current.next?.();
  if (!following) return;
  // The URL follows the episode on screen without adding a step to the browser history.
  history.replaceState(null, '', following.path);
  open(following, true);
  playerStatus.textContent = `Siguiente: ${following.name}`;
}
video.addEventListener('ended', playNext);

// «Saltar intro» while the intro set for the series plays; «Siguiente capítulo» with a 10-second count
// during the credits (✕ keeps watching them; the next one still starts when the episode ends).
const skipIntro = document.getElementById('player-skip-intro'), nextButton = document.getElementById('player-next'),
  nextDismiss = document.getElementById('player-next-dismiss');
const NEXT_COUNT = 10;
let nextCount = null, nextDismissed = null;
function paintSkip() {
  const shown = current?.vod ? skipButton(current.skip, video.currentTime, video.duration, current.hasNext) : null;
  skipIntro.hidden = shown !== 'intro';
  const next = shown === 'next' && nextDismissed !== current;
  nextButton.hidden = nextDismiss.hidden = !next;
  if (!next) { nextCount = null; return; }
  if (nextCount === null) nextCount = { left: NEXT_COUNT, at: Date.now() };
  const left = Math.max(0, NEXT_COUNT - Math.floor((Date.now() - nextCount.at) / 1000));
  nextButton.textContent = `Siguiente capítulo · ${left}`;
  if (left === 0 && !video.paused) { nextCount = null; playNext(); }
}
video.addEventListener('timeupdate', paintSkip);
video.addEventListener('emptied', paintSkip);
video.addEventListener('pause', () => { nextCount = null; }); // The count starts again when it plays on.
skipIntro.addEventListener('click', () => { if (current?.skip?.intro) video.currentTime = current.skip.intro[1]; paintSkip(); });
nextButton.addEventListener('click', () => { nextCount = null; playNext(); });
nextDismiss.addEventListener('click', () => { nextDismissed = current; paintSkip(); });
/** Opens a «Continuar viendo» card in the player, where it was left. */
async function resumeEntry(entry) {
  const section = sectionByPage(entry.page);
  try {
    const library = await fetchLibrary();
    const item = (library.sections[section?.key] || []).find((i) => i.id === entry.item);
    const episode = entry.episode ? item?.episodes?.find((e) => e.id === entry.episode) : null;
    if (!item || (entry.episode && !episode)) throw new Error('Este título ya no está en el catálogo.');
    open(playable(section, item, episode));
  } catch (error) {
    view.prepend(el('p', { class: 'error', role: 'alert' }, error.message));
  }
}

// ---- The match under the video --------------------------------------------------------------------
// Events open in the page (not in full screen) with the match under the video: from ESPN when the
// event has a Google match link, otherwise from the event's own teams, league, date and description.
const matchPanel = document.getElementById('match-center');
let matchTab = 'general', matchShown = '', matchModel = null, matchTimer = null;
function paintMatch() {
  if (!matchModel) return;
  const focused = matchPanel.contains(document.activeElement) ? document.activeElement.id : '';
  matchPanel.replaceChildren(...renderMatchCenter(el, matchModel, matchTab, (tab, focus) => {
    matchTab = tab; paintMatch();
    if (focus) document.getElementById(`mc-tab-${tab}`)?.focus();
  }).filter(Boolean));
  if (focused) document.getElementById(focused)?.focus();
}
/** Shows the match of an event under the video; true when it did (events only). */
function showMatchCenter(c) {
  // Only events with a match link show the match under the video; the rest open in full screen.
  const key = c?.event && c.matchUrl ? String(c.eventId || c.id) : '';
  if (key && key === matchShown) return true;
  clearInterval(matchTimer);
  matchShown = key; matchModel = null; matchTab = 'general';
  player.classList.toggle('with-match', !!key);
  matchPanel.hidden = !key;
  player.scrollTop = 0;
  if (!key) { matchPanel.replaceChildren(); return false; }
  const base = eventMatchModel(c, state.custom, eventLabel(c, Date.now(), EVENT_STATES).text);
  const id = c.matchUrl && c.matchId ? String(c.matchId) : '';
  matchModel = id ? { ...base, note: 'Cargando los datos del partido…' } : base;
  paintMatch();
  if (!id) return true;
  const load = async () => {
    try {
      const espn = parseMatchCenter(await fetchSummary(id));
      if (matchShown !== key) return;
      matchModel = { ...espn, league: espn.league || base.league, round: espn.round || base.round, venue: espn.venue || base.venue, description: base.description,
        home: { ...espn.home, logo: espn.home.logo || base.home.logo }, away: { ...espn.away, logo: espn.away.logo || base.away.logo } };
      paintMatch();
    } catch {
      if (matchShown === key && matchModel?.source !== 'espn') { matchModel = { ...base, note: 'No se pudieron cargar los datos del partido. Se volverá a intentar en unos segundos.' }; paintMatch(); }
    }
  };
  load();
  matchTimer = setInterval(load, 30000);
  return true;
}

function hidePlayer() {
  showMatchCenter(null);
  rememberPosition(true);
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
  if (!/^#\/(canal|evento)\/|^#\/(peliculas|series|documentales)\/[^/]+\/ver/.test(location.hash)) return;
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
// Events and channels are shared through their preview page, so WhatsApp and others show their card.
const shareButton = document.getElementById('player-share');
shareButton.addEventListener('click', async () => {
  if (!current || current.vod) return;
  const url = current.event ? eventShareLink(current) : channelShareLink(current);
  try {
    if (navigator.share) await navigator.share({ title: current.name, url });
    else { await navigator.clipboard.writeText(url); shareButton.textContent = 'Enlace copiado'; setTimeout(() => { shareButton.textContent = 'Compartir'; }, 2500); }
  } catch (error) {
    if (error?.name !== 'AbortError') playerStatus.textContent = `Copia este enlace para compartir: ${url}`;
  }
});

// ---- Films, series and documentaries --------------------------------------------------------------
// Shown in the menu while the administrator has the catalog switched on (libraryVisible); the
// administrator, signed in on this browser, always sees it, to prepare it before showing it to everyone.
let libraryAdmin = false;
shared().then((f) => f.watchAuth((user) => {
  const was = libraryAdmin;
  libraryAdmin = f.administrator(user);
  if (was === libraryAdmin) return;
  syncLibraryNav();
  if (sectionByPage(decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/')[0])) route();
})).catch(() => {});
const libraryShown = () => libraryVisible(state.custom) || libraryAdmin;
function syncLibraryNav() {
  for (const link of document.querySelectorAll('[data-library]')) link.hidden = !libraryShown();
}
async function libraryRoute(page, [itemId, sub, episodeId], version) {
  const section = sectionByPage(page);
  if (!libraryShown()) { view.replaceChildren(el('p', { class: 'status' }, `${section.label} no está disponible ahora.`)); return; }
  if (!itemId) view.replaceChildren(el('p', { class: 'status', role: 'status' }, `Cargando ${section.label.toLowerCase()}…`));
  let library;
  try { library = await fetchLibrary(); }
  catch (error) { if (version === routeVersion) view.replaceChildren(el('p', { class: 'error' }, error.message)); return; }
  if (version !== routeVersion) return;
  // Only the administrator gets here while it is hidden: say so, so it is not mistaken for public.
  const hiddenNote = libraryVisible(state.custom) ? null
    : el('p', { class: 'note library-hidden-note' }, 'Oculto para los usuarios: solo lo ves tú, como administrador. Actívalo en Administración → Pelis y series.');
  if (!itemId) { view.replaceChildren(...[hiddenNote, ...libraryPage(el, section, library)].filter(Boolean)); return; }
  const item = (library.sections[section.key] || []).find((i) => i.id === itemId);
  if (!item) { view.replaceChildren(el('p', { class: 'error' }, 'Este título ya no está en el catálogo.'), ...libraryPage(el, section, library)); return; }
  const play = (target, episode, restart = false) => open({ ...playable(section, target, episode), restart });
  const progress = loadProgress();
  const saved = (id) => progress[id] || null;
  if (sub === 'capitulo') {
    const episode = item.episodes?.find((e) => e.id === episodeId);
    if (episode) { view.replaceChildren(...libraryEpisode(el, section, library, item, episode, play, saved)); return; }
  }
  view.replaceChildren(...libraryDetail(el, section, library, item, play, saved, sub === 'temporada' ? Number(episodeId) : null));
  if (sub === 'ver') {
    const episode = episodeId ? item.episodes?.find((e) => e.id === episodeId) : null;
    const c = playable(section, item, episode);
    if (player.hidden || current?.id !== c.id) open(c, true);
  }
}

// ---- Routing ---------------------------------------------------------------------------------

let routeVersion = 0;
async function route() {
  const version = ++routeVersion;
  stopHighlight();
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [page, arg] = hash.split('/');
  // Films, series and documentaries have their own search box: the channels and events one hides there.
  search.closest('.search').hidden = !!sectionByPage(page);
  for (const a of document.querySelectorAll('[data-route]'))
    a.toggleAttribute('aria-current', a.dataset.route === (page || 'inicio'));
  for (const a of document.querySelectorAll('[aria-current]')) a.setAttribute('aria-current', 'page');
  if (page === 'tv') {
    // An app signing in from this phone: its QR / short link (…/tv/K7Q2) opens here.
    const login = await import('./tv-login.js');
    const nodes = await login.render(el, arg, hash.split('/')[2]);
    if (version === routeVersion) view.replaceChildren(...nodes);
    return;
  }
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
  syncLibraryNav();
  const watching = sectionByPage(page) && hash.split('/')[2] === 'ver';
  if (!['canal', 'evento'].includes(page) && !watching && !player.hidden) hidePlayer();
  if (page !== 'multipantalla' || !arg) closeMulti();
  if (page === 'multipantalla') {
    if (arg && showMulti(arg)) { view.replaceChildren(...multiPage()); return; }
    view.replaceChildren(...multiPage());
    return;
  }
  if (sectionByPage(page)) { await libraryRoute(page, hash.split('/').slice(1), version); return; }
  if (page === 'canal' || page === 'evento') {
    const all = page === 'evento' ? events(state.channels, state.custom, Date.now(), { allWeeks: true }) : [];
    const c = page === 'evento' ? (all.find(e => e.slug === arg) || all.find(e => e.eventId === arg)) : findChannel(state.channels, arg);
    // Moving from an open channel to one that cannot be played here must not leave the old one running.
    if ((!c || (!c.playable && !c.pending)) && !player.hidden) hidePlayer();
    view.replaceChildren(
      ...(c && !c.playable && !c.pending
        ? [el('p', { class: 'status' }, `${c.name} solo tiene emisión en su web oficial: `, el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'abrir su web')), ...home()]
        : c
          ? home()
          : !sharedSettled
            ? [el('p', { class: 'status loading-link' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), `Abriendo ${page === 'evento' ? 'el evento' : 'el canal'}…`)]
            : [el('p', { class: 'error' }, `No existe ${page === 'evento' ? 'el evento' : 'el canal'} «${arg || ''}». Si es nuevo, espera unos segundos y recarga.`), ...home()]),
    );
    // A catalog refresh rebuilds the channel objects; compare ids so playback is not restarted.
    if (c && (c.playable || c.pending) && (player.hidden || !current || current.id !== c.id)) open(c, true);
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
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#/evento/"]');
  if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const key = decodeURIComponent(link.hash.split('/')[2] || '');
  const item = events(state.channels, state.custom, Date.now(), { allWeeks: true }).find(c => c.slug === key || c.id === key);
  if (item) { event.preventDefault(); open(item); }
});
window.addEventListener('hashchange', () => {
  // A new section starts at the top, but closing the player must leave the page where it was.
  const closingPlayer = !player.hidden;
  search.value = '';
  if (!closingPlayer && !location.hash.startsWith('#/canal/')) window.scrollTo(0, 0);
  route();
});
route();
