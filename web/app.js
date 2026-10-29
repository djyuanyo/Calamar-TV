import { zicoEventApi, expandEventSources } from './event-sources.js';
import { mountRenewable } from './renewable-player.js';
import { fetchScores, fetchSummary, matchExpired, matchDeadline, shouldPollMatch } from './match-scores.js';
import { parseMatchCenter, renderMatchCenter, eventMatchModel, withPlayerExtras, LINEUPS_ENDPOINT } from './match-center.js';
import { fetchOdds, fetchGoalMarkets, fetchHistory } from './polymarket.js';
import { matchKey, votingOpen, tally, voterId, myPick, rememberPick, fetchVotes, sendVote, VOTES_MS } from './votes.js';
import { findBySlug, leagueSlugs, leagueEvents, merge, setLogoCopies, events, catalogEvents, PENDING, FINISHED, eventRows, liveEvents, thisWeekEvents, LIVE_ROW, homeHighlights, featured, groups, categoryList, webPlayback, findChannel, explainStreamError, streamFailureReport } from './catalog.js';
import { eventPath, eventShareLink, channelShareLink, leagueShareLink, EVENT_STATES } from './sports.js';
import { initControls, icon } from './player-controls.js';
import { mountTs, videoFailure } from './ts-player.js';
import { autoplay, soundChosen } from './autoplay.js';
import { prepareCastSource } from './cast-adapter.js';
import { openMulti, closeMulti, multiPlayable, MULTI_MAX } from './multi-view.js';
import { LIBRARY_SECTIONS, sectionByPage, libraryVisible, fetchLibrary, libraryPage, libraryDetail, libraryEpisode, playable, continueRow,
  cachedLibrary, libraryFeatured, libraryTop, topRow, itemTitle, itemLine, itemPath, halloweenOn, halloweenRow, halloweenPage, HALLOWEEN_PAGE, platformPage, PLATFORM_PAGE,
  loadProgress, saveProgress, recordProgress, removeProgress, progressList, skipButton, withIntroDb, librarySearch, browseCard, similarTitles } from './library.js';
import { startProfiles, onProfilesChanged, needsProfile, profileData, listEntries, lastLiked, toggleMyList, rateTitle, inMyList, ratingOf, isFavorite, toggleFavoriteChannel } from './profiles.js';
import { accountPage, paintAccountButton } from './account.js';
import { initCast } from './cast-player.js';
import { startProgressSync, refreshProgress } from './progress-sync.js';
import { sourceOptions, selectedSource, renderSourcePicker } from './player-sources.js';
import { audienceTarget, sessionId, visitKey, madridDay, eventLabel, nextStart, HEARTBEAT_MS, COUNT_MS, CARDS_MS, CARD_TARGETS } from './audience.js';

const view = document.getElementById('view');
const search = document.getElementById('search');
let sharedStarted = false;
// Firebase loads on demand so the bundled catalog works even when it cannot be reached.
let firebase = null;
// True while the administrator is signed in on this browser (see the library section below).
let libraryAdmin = false;
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
  const starts = new Map();
  for (const e of pollableEvents(state.custom)) if (e.matchUrl && e.matchId) starts.set(String(e.matchId), e.startAt || '');
  for (const n of document.querySelectorAll('[data-match-id]')) if (!starts.get(n.dataset.matchId)) starts.set(n.dataset.matchId, n.dataset.matchStart || '');
  for (const id of [...starts.keys()]) if (!shouldPollMatch(id)) starts.delete(id);
  if (!starts.size) return;
  scoreBusy = true;
  try {
    // One ESPN scoreboard per day for all the cards, not one whole summary per match.
    const results = await fetchScores(starts).catch(() => new Map());
    for (const id of starts.keys()) {
      if (!results.has(id)) continue;
      const result = results.get(id);
      if (result) matchScores.set(id, result); else matchScores.delete(id);
      const shown = result || { text: 'Marcador no disponible', live: false };
      for (const node of document.querySelectorAll('[data-match-id]')) if (node.dataset.matchId === id) {
        const scheduled = shown.state === 'scheduled' && Date.parse(node.dataset.matchStart) > Date.now();
        node.textContent = scheduled ? eventLabel({ startAt: node.dataset.matchStart }, Date.now(), EVENT_STATES).text : shown.text;
        node.classList.toggle('live', shown.live); node.classList.toggle('upcoming', scheduled);
      }
    }
  } finally { scoreBusy = false; syncEventExpiry(); }
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
    // Only the first cards are counted; the others show no number rather than a wrong 0.
    node.hidden = cardsReady && !cardCounts.has(node.dataset.audienceTarget);
    const count = cardsReady ? cardCounts.get(node.dataset.audienceTarget) || 0 : '—';
    node.querySelector('b').textContent = String(count); node.setAttribute('aria-label', count === '—' ? 'Espectadores no disponibles' : `${count} personas viendo`);
  }
}
async function refreshCardAudience() {
  // Not while a player covers the cards: viewers would spend reads on numbers nobody sees.
  if (document.hidden || cardsBusy || !document.querySelector('[data-audience-target]') || document.getElementById('player')?.hidden === false) return;
  const targets = [...new Set([...document.querySelectorAll('[data-audience-target]')].map((n) => n.dataset.audienceTarget))].slice(0, CARD_TARGETS);
  const known = targets.every((t) => cardCounts.has(t));
  if (cardsCheckedAt && known && Date.now() - cardsCheckedAt < CARDS_MS) { paintCardAudience(); return; }
  cardsBusy = true;
  try {
    const f = await shared(), counts = await f.viewersOf(targets);
    cardCounts.clear(); for (const [target, count] of counts) cardCounts.set(target, count); cardsReady = true;
  } catch { cardsReady = false; }
  finally { cardsBusy = false; cardsCheckedAt = Date.now(); paintCardAudience(); }
}
setInterval(refreshCardAudience, CARDS_MS);
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
              p.event || p.libraryHero ? eventCover(p, 'pick-cover') : logo(p),
            ),
          ),
        )
      : null;
  if (c.libraryHero) {
    // A film or series «En portada»: its TMDB backdrop, and play (films) or its page (series).
    const film = c.item.kind !== 'tv' && c.item.url;
    return el('section', { class: 'hero event-hero library-hero', style: `--h:${hue(c.name)}`, 'aria-label': `${c.section.one} destacada` },
      el('div', { class: 'hero-bg' }),
      c.cover ? eventCover(c, 'event-hero-cover') : null,
      el('div', { class: 'hero-body' },
        el('span', { class: 'tag' }, c.section.label),
        el('h1', {}, c.name),
        el('p', { class: 'hero-meta' }, itemLine(c.section, c.item)),
        c.item.tmdb?.overview ? el('p', { class: 'hero-overview' }, c.item.tmdb.overview) : null,
        el('div', { class: 'hero-actions' },
          film ? el('button', { class: 'btn lg', type: 'button', onclick: () => open(playable(c.section, c.item)) }, icon('play'), 'Ver ahora') : null,
          el('a', { class: `btn lg ${film ? 'secondary' : ''}`, href: itemPath(c.section, c.item) }, film ? 'Más información' : 'Ver episodios'))),
      picks);
  }
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

/** The library for the home page: what is already here, downloaded in the background the first time. */
let homeLibraryAsked = false;
function homeLibrary() {
  if (!libraryShown()) return null;
  const library = cachedLibrary();
  if (!library && !homeLibraryAsked) {
    homeLibraryAsked = true;
    fetchLibrary().then(() => { if (!location.hash.replace(/^#\/?/, '') && !search.value.trim()) route(); }).catch(() => {});
  }
  return library;
}
/** A film or series «En portada», as an entry of the featured slider. */
const libraryHero = ({ section, item }) => ({ name: itemTitle(item), libraryHero: true, section, item, cover: item.tmdb?.backdrop || item.tmdb?.poster || '' });

function home() {
  const matches = events(state.channels, state.custom);
  const library = homeLibrary();
  // Films and series marked «En portada» join the featured events and channels.
  const list = [...homeHighlights(state.channels, state.custom), ...libraryFeatured(library).map(libraryHero)];
  scheduleStartRefresh(matches);
  const nodes = [];
  if (list.length) nodes.push(highlightSlider(list));
  // «Eventos En Directo»: today's events with something to play, the first row of all.
  const live = liveEvents(matches);
  // The same events stay in their league's row too: the cards are copies of the same event.
  if (live.length) {
    const liveRail = rail(live, { wide: true, limit: live.length });
    liveRail.classList.add('live-rail');
    // Its heading opens #/directo: every one of today's events, by competition.
    nodes.push(sectionHead(el('a', { class: 'league-head', href: '#/directo', title: 'Todos los eventos en directo, por competición' }, LIVE_ROW),
      el('span', {}, live.length === 1 ? '1 evento' : `${live.length} eventos`)), liveRail);
  }
  // Films and episodes left half watched come right under the featured slider: those of this browser,
  // and with an account signed in, those of its other devices too.
  const unfinished = libraryShown() ? progressList(loadProgress()) : [];
  if (libraryShown()) refreshProgress();
  const tops = [['movies', 'películas'], ['series', 'series']].map(([key, what]) => [libraryTop(library, key), what]);
  if (unfinished.length) nodes.push(...continueRow(el, unfinished, { open: resumeEntry,
    remove: (entry) => { saveProgress(removeProgress(loadProgress(), entry.key)); route(); } }));
  // The profile's own rows: «Mi lista» and «Porque te gustó…», as in Netflix.
  if (libraryShown() && library) nodes.push(...profileRows(library));
  // The weekly top of films and of series (set from TMDB in the admin page), as many as there are.
  for (const [top, what] of tops) if (top.length) nodes.push(...topRow(el, top, what));
  // «Especial Halloween» until 2 November: every horror title, with «Descubrir todo».
  if (libraryShown() && halloweenOn()) nodes.push(...halloweenRow(el, library));
  // The favourite channels of the profile watching.
  const favorites = state.channels.filter((c) => isFavorite(c.id));
  if (favorites.length) nodes.push(sectionHead('Tus canales favoritos', el('span', {}, favorites.length === 1 ? '1 canal' : `${favorites.length} canales`)), rail(favorites, { limit: favorites.length }));
  // Only events on the home page: one row per league, each in date order (soonest first), with this
  // week's events only: a league whose next matches are in two weeks does not appear yet.
  for (const row of eventRows(thisWeekEvents(matches), state.custom)) {
    // The league's name opens its page: every match of the league that has a channel.
    const head = [row.logo ? el('img', { src: row.logo, alt: '', referrerpolicy: 'no-referrer' }) : null, row.name];
    nodes.push(sectionHead(row.slug ? el('a', { class: 'league-head', href: `#/liga/${encodeURIComponent(row.slug)}`, title: `Todos los partidos de ${row.name}` }, ...head)
      : el('span', { class: 'league-head' }, ...head),
      el('span', {}, row.events.length === 1 ? '1 evento' : `${row.events.length} eventos`)), rail(row.events, { wide: true, limit: row.events.length }));
  }
  if (!matches.length) nodes.push(el('p', { class: 'status' }, 'Todavía no hay eventos. ', el('a', { href: '#/canales' }, 'Ver los canales')));
  return nodes;
}

/** «Mi lista» and «Porque te gustó «X»» of the profile watching (only titles still in the library). */
function profileRows(library) {
  const find = ({ page, item }) => {
    const section = sectionByPage(page);
    const found = section && (library.sections?.[section.key] || []).find((i) => i.id === item);
    return found ? { section, item: found } : null;
  };
  const nodes = [];
  const mine = listEntries(profileData()).map(find).filter(Boolean);
  if (mine.length) nodes.push(sectionHead('Mi lista', el('span', {}, mine.length === 1 ? '1 título' : `${mine.length} títulos`)),
    el('div', { class: 'rail browse-rail' }, mine.map(({ section, item }) => browseCard(el, section, item))));
  const liked = lastLiked(profileData()), title = liked && find(liked);
  const like = title ? similarTitles(library, title.section, title.item).filter((i) => ratingOf(title.section.page, i.id) >= 0) : [];
  if (like.length) nodes.push(sectionHead(`Porque te gustó «${itemTitle(title.item)}»`),
    el('div', { class: 'rail browse-rail' }, like.map((i) => browseCard(el, title.section, i))));
  return nodes;
}

/** «+ Mi lista», «Me gusta» and «No me gusta» on a title's page; they change in place. */
function titleExtras(section, item) {
  const mark = (button, on, label) => { button.setAttribute('aria-pressed', String(on)); button.lastChild.textContent = label; };
  const list = el('button', { class: 'title-action', type: 'button', onclick: () => { toggleMyList(section.page, item.id); paint(); } },
    el('span', { 'aria-hidden': 'true' }, '+'), el('span', {}, 'Mi lista'));
  const up = el('button', { class: 'title-action', type: 'button', onclick: () => { rateTitle(section.page, item.id, 1); paint(); } },
    el('span', { 'aria-hidden': 'true' }, '👍'), el('span', {}, 'Me gusta'));
  const down = el('button', { class: 'title-action', type: 'button', onclick: () => { rateTitle(section.page, item.id, -1); paint(); } },
    el('span', { 'aria-hidden': 'true' }, '👎'), el('span', {}, 'No me gusta'));
  const paint = () => {
    const saved = inMyList(section.page, item.id), rating = ratingOf(section.page, item.id);
    mark(list, saved, saved ? 'En mi lista' : 'Mi lista'); list.firstChild.textContent = saved ? '✓' : '+';
    mark(up, rating > 0, 'Me gusta'); mark(down, rating < 0, 'No me gusta');
  };
  paint();
  return [list, up, down];
}

/** #/directo: every event of «Eventos En Directo» in a grid per competition, in the order of the leagues. */
function livePage() {
  const live = liveEvents(events(state.channels, state.custom));
  const nodes = [el('section', { class: 'live-page-head' }, el('h1', {}, LIVE_ROW),
    el('p', { class: 'note' }, live.length === 1 ? '1 evento hoy, ordenado por competición' : `${live.length} eventos hoy, ordenados por competición`))];
  for (const row of eventRows(live, state.custom)) {
    const head = [row.logo ? el('img', { src: row.logo, alt: '', referrerpolicy: 'no-referrer' }) : null, row.name];
    nodes.push(sectionHead(row.slug ? el('a', { class: 'league-head', href: `#/liga/${encodeURIComponent(row.slug)}`, title: `Todos los partidos de ${row.name}` }, ...head)
      : el('span', { class: 'league-head' }, ...head), el('span', {}, row.events.length === 1 ? '1 evento' : `${row.events.length} eventos`)),
      el('div', { class: 'grid league-grid' }, row.events.map((c) => card(c))));
  }
  if (!live.length) nodes.push(el('p', { class: 'status' }, 'Ahora mismo no hay eventos en directo. ', el('a', { href: '#/canales' }, 'Ver los canales')));
  return nodes;
}

/** A league's page (#/liga/<slug>): its logo on its background, a share button and every match of the league with a channel, in a grid. */
function leaguePage(slug) {
  const slugs = leagueSlugs(state.custom);
  const league = (state.custom?.leagues || []).find((l) => slugs.get(l.id) === slug);
  if (!league) return [el('p', { class: 'error' }, `No existe la liga «${slug || ''}».`), ...home()];
  // Only today's matches (Madrid day; one past midnight still on air too), as «Eventos En Directo».
  const list = liveEvents(leagueEvents(state.channels, state.custom, league.id));
  const image = (v) => (typeof v === 'string' && (v.startsWith('https://') || v.startsWith('data:image/')) ? v : '');
  const art = image(league.background);
  const status = el('span', { class: 'note', role: 'status' });
  const share = el('button', { class: 'btn secondary', type: 'button', onclick: async () => {
    const url = leagueShareLink(slug);
    try {
      if (navigator.share) await navigator.share({ title: league.name, url });
      else { await navigator.clipboard.writeText(url); status.textContent = 'Enlace copiado.'; }
    } catch (error) { if (error?.name !== 'AbortError') status.textContent = `Copia este enlace: ${url}`; }
  } }, '⤴ Compartir');
  return [el('section', { class: 'league-hero', style: art ? `--league-art:url("${art.replace(/"/g, '%22')}")` : null },
      image(league.logo) ? el('img', { class: 'league-hero-logo', src: image(league.logo), alt: '', referrerpolicy: 'no-referrer' }) : null,
      el('h1', {}, league.name),
      el('p', {}, list.length === 1 ? '1 partido hoy con canal' : `${list.length} partidos hoy con canal`),
      el('div', { class: 'league-hero-actions' }, share, status)),
    list.length ? el('div', { class: 'grid league-grid' }, list.map((c) => card(c)))
      : el('p', { class: 'status' }, 'Hoy no hay partidos de esta liga con canal asignado.')];
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
  // Films, series and documentaries too, under the channels, once the library has loaded.
  const titles = el('div', { class: 'search-titles' });
  if (libraryShown()) {
    const version = routeVersion;
    fetchLibrary().then((library) => {
      if (version !== routeVersion) return;
      const hits = librarySearch(library, query);
      if (hits.length) titles.replaceChildren(sectionHead('Películas, series y documentales', el('span', {}, `${hits.length} títulos`)),
        el('div', { class: 'rail browse-rail search-posters' }, hits.map(({ section, item }) => browseCard(el, section, item))));
    }).catch(() => {});
  }
  return [sectionHead(`Resultados para «${query}»`, el('span', {}, `${found.length} canales`)), found.length ? el('div', { class: 'grid' }, found.map(c => card(c))) : el('p', { class: 'status' }, 'No hay canales con ese nombre.'), titles];
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

let stopRenewable = null, sourceLookup = null;
function stop() {
  playbackGeneration++;
  if (sourceLookup) { sourceLookup.abort(); sourceLookup = null; }
  if (stopRenewable) { stopRenewable(); stopRenewable = null; }
  video.onerror = null;
  video.onplaying = null;
  if (stopTs) { stopTs(); stopTs = null; }
  if (hls) hls.destroy();
  hls = null;
  video.removeAttribute('src');
  video.load();
  controls.reset();
  // A picture muted only because the browser blocked the sound gets it back on the next start (autoplay.js).
  if (video.dataset.autoMuted) { soundChosen(video); video.muted = false; }
  document.getElementById('player-frame')?.remove();
  player.classList.remove('framed');
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

async function playSource(c, index) {
  stop();
  // An imported match without a channel yet: the match page alone, with no video.
  if (c.pending) {
    renderSourcePicker(playerSources, [], 0, () => {});
    playerStatus.textContent = c.channelName === FINISHED ? 'El partido ha terminado. Aquí tienes el resultado, las estadísticas y las alineaciones.'
      : `${PENDING}. El partido se verá aquí en cuanto tenga canal.`;
    return;
  }
  const generation = playbackGeneration;
  if (c.streams.some(zicoEventApi) && !c.eventSourcesExpanded) {
    playerStatus.textContent = 'Consultando fuentes del evento…';
    renderSourcePicker(playerSources, [], 0, () => {});
    const lookup = sourceLookup = new AbortController();
    const timeout = setTimeout(() => lookup.abort(), 15000);
    const requested = c.streams[index];
    const resolved = await expandEventSources(c.streams, { signal: lookup.signal });
    clearTimeout(timeout);
    if (generation !== playbackGeneration) return;
    sourceLookup = null;
    c = { ...c, streams: resolved.map(s => s.url), eventSourcesExpanded: true,
      sourceNames: Object.fromEntries(resolved.map(s => [s.url, s.name])),
      sourceErrors: Object.fromEntries(resolved.filter(s => s.error).map(s => [s.url, s.error])),
      originalStreams: c.streams };
    index = Math.max(0, resolved.findIndex(s => s.url === requested || s.origin === requested));
  }
  const allSources = sourceOptions(c.streams).map(s => ({ ...s, label: c.sourceNames?.[s.url] || s.label }));
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
      } }, '↻ Reintentar');
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
  const showFrame = () => {
    // The page's own player, straight from its servers: nothing passes through the hosting.
    const frame = el('iframe', { id: 'player-frame', class: 'player-frame', src: source.how.address || source.url, title: c.name,
      allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: '' });
    document.querySelector('#player .player-stage').append(frame);
    player.classList.add('framed');
    controls.attach(null);
    playerStatus.textContent = '';
  };
  if (source.how.kind === 'event') {
    const message = c.sourceErrors?.[source.url] || 'No se pudieron obtener las fuentes de este evento.';
    playerStatus.replaceChildren(message, ' ', el('button', { type: 'button', class: 'ghost', onclick: () => {
      playSource({ ...c, streams: c.originalStreams || c.streams, eventSourcesExpanded: false }, 0);
    } }, '↻ Consultar de nuevo'));
    return;
  }
  if (source.how.renewable) {
    stopRenewable = mountRenewable({ page: source.url, video, Hls: window.Hls,
      onAttach: (instance) => { hls = instance; controls.attach(instance); },
      onStatus: (message) => { if (generation === playbackGeneration) playerStatus.textContent = message; },
      onFallback: () => { if (generation === playbackGeneration) { video.pause(); video.removeAttribute('src'); video.load(); playerStatus.textContent = 'Este navegador no admite la reproducción HLS. Prueba con un navegador compatible.'; } },
    });
    return;
  }
  if (source.how.kind === 'frame') { showFrame(); return; }
  if (source.how.kind === 'ts') {
    controls.attach(null);
    // The hosting's adapted HLS of the channel (calamar-cast.php): one continuous connection to the
    // provider shared by every viewer, so the picture does not jump each time a browser connection ends.
    const adapted = async (data, message) => {
      if (stopTs) { stopTs(); stopTs = null; }
      video.removeAttribute('src');
      video.load();
      playerStatus.textContent = message;
      const compatible = await prepareCastSource(source.url, {
        isCurrent: () => generation === playbackGeneration,
        onStatus: () => { if (generation === playbackGeneration) playerStatus.textContent = message; },
      });
      if (generation !== playbackGeneration || !compatible) return;
      video.onplaying = () => { if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = ''; };
      video.onerror = () => { const failure = videoFailure(video.error); if (failure) next(failure); };
      if (window.Hls?.isSupported()) {
        // 10 s behind the live edge (5 pieces of 2 s): a slow piece from the hosting does not stop the picture.
        hls = new window.Hls({ lowLatencyMode: false, liveSyncDurationCount: 5, liveMaxLatencyDurationCount: 7 });
        hls.on(window.Hls.Events.ERROR, (_event, failure) => { if (failure.fatal) next(failure); });
        hls.loadSource(compatible.url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = compatible.url;
      else { next({ ...data, details: 'codecUnsupported' }); return; }
      controls.attach(hls);
      autoplay(video).catch(() => {
        if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = 'Pulsa ▶ para empezar.';
      });
    };
    const direct = () => {
      video.onplaying = () => { if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = ''; };
      video.onerror = null; // mountTs owns media errors and retries; do not preempt it.
      controls.attach(null);
      stopTs = mountTs({ library: window.mpegts, video, address: source.url, relay: source.how.relay,
        onFailure: (data) => queueMicrotask(async () => {
          if (generation !== playbackGeneration) return;
          if (!source.how.relay || !/codec|decode|buffer/i.test(data?.details || '')) { next(data); return; }
          try { await adapted(data, 'Adaptando el vídeo para este navegador…'); }
          catch (error) {
            if (generation === playbackGeneration) next({ ...data, userMessage: error.message || 'No se pudo adaptar el vídeo en el hosting.' });
          }
        }),
        onRecovering: () => { if (generation === playbackGeneration) playerStatus.textContent = 'Reconectando con la emisión…'; },
        onPlaying: () => { if (generation === playbackGeneration) playerStatus.textContent = ''; },
      });
    };
    // The relay first: the hosting stops its own FFmpeg process after about 30 seconds, so the shared
    // adapted HLS only serves channels the browser cannot decode (HEVC), as before.
    direct();
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
  autoplay(video).catch(() => {
    if (generation === playbackGeneration && !failureHandled) playerStatus.textContent = 'Pulsa ▶ para empezar.';
  });
}

function pagePlaybackError(code) {
  if (code === 403) return 'El hosting solo abre reproductores de canales del catálogo publicado. Si acabas de añadir el enlace, espera un minuto y pulsa Reintentar.';
  if (code === 404) return 'No se encontró el vídeo en la página del reproductor, o falta subir calamar-player.php al hosting.';
  if (code === 400) return 'Este enlace de reproductor no es válido.';
  return 'La página del reproductor no responde o ninguna de sus fuentes funciona ahora. Pulsa Reintentar en un momento.';
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
  if (c.vod) viewersBadge.hidden = true;
  const live = () => watching === session;
  // Films and series count in the statistics too, but their player shows no «people watching».
  const count = () => c.vod ? Promise.resolve() : shared().then((f) => f.viewers(target)).then((n) => { if (live()) showViewers(n); }).catch(() => {});
  const beat = () => shared().then((f) => f.beat(session.id, target)).catch(() => {});
  beat().then(() => { if (live()) count(); });
  session.timers.push(setInterval(beat, HEARTBEAT_MS));
  if (!c.vod) session.timers.push(setInterval(count, COUNT_MS));
  // One visit per opening; refreshes of the same player are not new visits. An event also counts
  // as a visit to the channel it plays on. The rules accept one counter per write, so each goes alone.
  if (visit) {
    const day = madridDay();
    const keys = c.vod ? [visitKey('library', c.libraryId || c.id)]
      : c.event ? [visitKey('event', c.eventId), visitKey('channel', c.channelId)] : [visitKey('channel', c.id)];
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
  paintFavorite();
  // An imported match without a channel has no video: only its match page and the notice.
  player.classList.toggle('pending', !!c.pending);
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
  // Films and series count in the statistics too (startAudience shows them no «people watching»).
  if (!c.pending) startAudience(c);
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
// Players' photos and ratings, asked only with the line-ups open and at most every 5 minutes
// (the hosting keeps them too: API-Football's free plan has 100 requests a day).
const playerExtras = { key: '', at: 0, data: null, busy: false };
function loadPlayerExtras() {
  const m = matchModel;
  if (matchTab !== 'lineups' || !m?.lineups?.length || !m.home?.name || !m.away?.name || !m.date) return;
  const key = `${m.home.name}|${m.away.name}|${m.date.slice(0, 10)}`;
  if (playerExtras.busy || (playerExtras.key === key && Date.now() - playerExtras.at < 300000)) return;
  Object.assign(playerExtras, { key, at: Date.now(), busy: true });
  const url = `${LINEUPS_ENDPOINT}?home=${encodeURIComponent(m.home.name)}&away=${encodeURIComponent(m.away.name)}&date=${m.date.slice(0, 10)}`;
  fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((data) => {
    playerExtras.busy = false;
    if (playerExtras.key !== key) return;
    playerExtras.data = data?.teams ? data : null;
    if (playerExtras.data) paintMatch();
  });
}
// Polymarket's odds of the match (home, draw, away), asked at most every 2 minutes until it ends.
const matchOdds = { key: '', at: 0, data: null, busy: false };
function loadOdds() {
  const m = matchModel;
  if (!m?.home?.name || !m.away?.name || !m.date || m.state === 'finished' || m.source === 'event') return;
  const key = `${m.home.name}|${m.away.name}|${m.date}`;
  if (matchOdds.busy || (matchOdds.key === key && Date.now() - matchOdds.at < 120000)) return;
  if (matchOdds.key !== key) matchOdds.data = null;
  Object.assign(matchOdds, { key, at: Date.now(), busy: true });
  fetchOdds(m.home.name, m.away.name, m.date).catch(() => null).then(async (found) => {
    // The goals markets and how the chances moved come with it (they fail alone, without hiding the rest).
    const [goals, history] = found ? await Promise.all([fetchGoalMarkets(found.slug).catch(() => []), fetchHistory(found.tokens).catch(() => null)]) : [[], null];
    const odds = found && { ...found, goals, history };
    matchOdds.busy = false;
    if (matchOdds.key !== key) return;
    const changed = JSON.stringify(odds) !== JSON.stringify(matchOdds.data);
    matchOdds.data = odds;
    if (changed && matchTab === 'general') paintMatch();
  });
}
// The visitors' 1X2 poll (kept on the hosting): the totals are asked every 2 minutes with the General tab open.
const matchPoll = { key: '', at: 0, totals: null, busy: false, sending: false, error: '' };
function loadVotes(force = false) {
  const key = matchModel ? matchKey(matchModel.home?.name, matchModel.away?.name, matchModel.date) : '';
  if (!key || matchTab !== 'general') return;
  if (matchPoll.key !== key) Object.assign(matchPoll, { key, at: 0, totals: null, error: '' });
  if (matchPoll.busy || (!force && Date.now() - matchPoll.at < VOTES_MS)) return;
  Object.assign(matchPoll, { at: Date.now(), busy: true });
  fetchVotes(key).catch(() => null).then((totals) => {
    matchPoll.busy = false;
    if (matchPoll.key !== key || !totals) return;
    const changed = JSON.stringify(totals) !== JSON.stringify(matchPoll.totals);
    matchPoll.totals = totals;
    if (changed && matchTab === 'general') paintMatch();
  });
}
function vote(pick) {
  const key = matchPoll.key;
  if (!key || matchPoll.sending || !votingOpen(matchModel)) return;
  Object.assign(matchPoll, { sending: true, error: '' });
  paintMatch();
  sendVote(voterId(), key, pick).then((totals) => {
    rememberPick(key, pick);
    Object.assign(matchPoll, { sending: false, at: Date.now(), totals: matchPoll.key === key ? totals : matchPoll.totals });
    paintMatch();
    document.getElementById(`mc-vote-${pick}`)?.focus();
  }, (error) => {
    Object.assign(matchPoll, { sending: false, error: error.message || 'No se ha podido guardar el voto. Inténtalo de nuevo.' });
    paintMatch();
  });
}
const PORRA_COLLAPSED = 'calamar-porra-collapsed';
function porraCollapsed() { try { return localStorage.getItem(PORRA_COLLAPSED) === '1'; } catch { return false; } }
function togglePorra() {
  try { localStorage.setItem(PORRA_COLLAPSED, porraCollapsed() ? '0' : '1'); } catch {}
  paintMatch();
}
function pollModel() {
  const key = matchModel ? matchKey(matchModel.home?.name, matchModel.away?.name, matchModel.date) : '';
  if (!key || matchPoll.key !== key) return null;
  return { open: votingOpen(matchModel), pick: myPick(key), tally: matchPoll.totals ? tally(matchPoll.totals) : null,
    busy: matchPoll.sending, error: matchPoll.error, choose: vote, collapsed: porraCollapsed(), toggle: togglePorra };
}
function paintMatch() {
  if (!matchModel) return;
  loadPlayerExtras();
  loadOdds();
  loadVotes();
  const focused = matchPanel.contains(document.activeElement) ? document.activeElement.id : '';
  const extras = playerExtras.key === `${matchModel.home?.name}|${matchModel.away?.name}|${String(matchModel.date || '').slice(0, 10)}` ? playerExtras.data : null;
  const odds = matchOdds.key === `${matchModel.home?.name}|${matchModel.away?.name}|${matchModel.date}` ? matchOdds.data : null;
  matchPanel.replaceChildren(...renderMatchCenter(el, { ...withPlayerExtras(matchModel, extras), odds, votes: pollModel() }, matchTab, (tab, focus) => {
    matchTab = tab; paintMatch();
    if (focus) document.getElementById(`mc-tab-${tab}`)?.focus();
  }).filter(Boolean));
  if (focused) document.getElementById(focused)?.focus();
}
// The administrator watching an event gets «Seleccionar canal» at the end of its page.
const eventAdmin = el('section', { class: 'event-admin', hidden: true, 'aria-label': 'Administración del evento' });
matchPanel.after(eventAdmin);
function showEventAdmin(c) {
  eventAdmin.hidden = true; eventAdmin.replaceChildren();
  if (!c?.event) return;
  const id = String(c.eventId || c.id);
  // Only for the administrator signed in on this browser: the admin page's code loads just then.
  shared().then(async (f) => { await f.ready; return f.administrator() ? import('./admin.js') : null; })
    .then((admin) => admin && admin.eventChannelPanel(id, state)).then((panel) => {
    if (!panel || matchShown !== id) return;
    eventAdmin.replaceChildren(panel); eventAdmin.hidden = false;
  }).catch(() => {});
}
/** Shows the match of an event under the video; true when it did (events only). */
function showMatchCenter(c) {
  // Only events with a match link show the match under the video; the rest open in full screen
  // (for the administrator too, so the event page has its «Seleccionar canal» at the end).
  const key = c?.event && (c.matchUrl || libraryAdmin) ? String(c.eventId || c.id) : '';
  if (key && key === matchShown) return true;
  clearInterval(matchTimer);
  matchShown = key; matchModel = null; matchTab = 'general';
  player.classList.toggle('with-match', !!key);
  matchPanel.hidden = !key;
  player.scrollTop = 0;
  showEventAdmin(key ? c : null);
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

document.getElementById('player-close').addEventListener('click', closePlayer);
// Events and channels are shared through their preview page, so WhatsApp and others show their card.
// A channel's ♡: the favourite channels of the profile watching (a row on the home page).
const favoriteButton = document.getElementById('player-favorite');
function paintFavorite() {
  favoriteButton.hidden = !current || !!current.vod || !!current.event;
  const on = !favoriteButton.hidden && isFavorite(current.id);
  favoriteButton.setAttribute('aria-pressed', String(on));
  favoriteButton.title = on ? 'Quitar de favoritos' : 'Añadir a favoritos';
  favoriteButton.setAttribute('aria-label', favoriteButton.title);
}
favoriteButton.addEventListener('click', () => { if (current && !current.vod && !current.event) { toggleFavoriteChannel(current.id); paintFavorite(); } });
const shareButton = document.getElementById('player-share');
shareButton.addEventListener('click', async () => {
  if (!current || current.vod) return;
  const url = current.event ? eventShareLink(current) : channelShareLink(current);
  try {
    if (navigator.share) await navigator.share({ title: current.name, url });
    else { await navigator.clipboard.writeText(url); playerStatus.textContent = 'Enlace copiado.'; setTimeout(() => { if (playerStatus.textContent === 'Enlace copiado.') playerStatus.textContent = ''; }, 2500); }
  } catch (error) {
    if (error?.name !== 'AbortError') playerStatus.textContent = `Copia este enlace para compartir: ${url}`;
  }
});

// ---- Films, series and documentaries --------------------------------------------------------------
// Shown in the menu while the administrator has the catalog switched on (libraryVisible); the
// administrator, signed in on this browser, always sees it, to prepare it before showing it to everyone.
let userName = '';
shared().then((f) => f.watchAuth((user) => {
  // «Seguir viendo para Juan» in the film and series pages.
  userName = String(user?.displayName || '').trim().split(/\s+/)[0] || '';
  const was = libraryAdmin;
  libraryAdmin = f.administrator(user);
  if (was === libraryAdmin) return;
  syncLibraryNav();
  // Also the home page: while the library is hidden only the administrator sees its rows (Continuar viendo,
  // the titles «En portada» and the tops), and the home page was drawn before knowing who was signed in.
  const page = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/')[0];
  if (sectionByPage(page) || !page) route();
})).catch(() => {});
const libraryShown = () => libraryVisible(state.custom) || libraryAdmin;
// Another device of the account changed «Continuar viendo»: the home page shows it at once.
startProgressSync(shared, () => { if (!location.hash.replace(/^#\/?/, '')) route(); });
function syncLibraryNav() {
  for (const link of document.querySelectorAll('[data-library]')) link.hidden = !libraryShown();
}
// What a section page needs for «Seguir viendo para …»: this browser's unfinished titles and the user's name.
const browseOptions = () => ({ watching: progressList(loadProgress()), name: userName, open: resumeEntry, platforms: state.custom?.platforms || [],
  remove: (entry) => { saveProgress(removeProgress(loadProgress(), entry.key)); route(); } });
async function halloweenRoute(version) {
  if (!libraryShown()) { view.replaceChildren(el('p', { class: 'status' }, 'El Especial Halloween no está disponible ahora.')); return; }
  view.replaceChildren(el('p', { class: 'status', role: 'status' }, 'Cargando el Especial Halloween…'));
  let library;
  try { library = await fetchLibrary(); }
  catch (error) { if (version === routeVersion) view.replaceChildren(el('p', { class: 'error' }, error.message)); return; }
  if (version === routeVersion) view.replaceChildren(...halloweenPage(el, library));
}
async function platformRoute(name, version) {
  if (!libraryShown()) { view.replaceChildren(el('p', { class: 'status' }, 'Las películas y series no están disponibles ahora.')); return; }
  view.replaceChildren(el('p', { class: 'status', role: 'status' }, `Cargando ${name || 'la plataforma'}…`));
  let library;
  try { library = await fetchLibrary(); }
  catch (error) { if (version === routeVersion) view.replaceChildren(el('p', { class: 'error' }, error.message)); return; }
  if (version === routeVersion) view.replaceChildren(...platformPage(el, library, name || '', Math.random, state.custom?.platforms || []));
}
async function libraryRoute(page, [itemId, sub, episodeId], version) {
  const section = sectionByPage(page);
  // While the library is hidden its lists are not public, but a film's or series' own link still opens it.
  if (!libraryShown() && !itemId) { view.replaceChildren(el('p', { class: 'status' }, `${section.label} no está disponible ahora.`)); return; }
  if (!itemId) view.replaceChildren(el('p', { class: 'status', role: 'status' }, `Cargando ${section.label.toLowerCase()}…`));
  let library;
  try { library = await fetchLibrary(); }
  catch (error) { if (version === routeVersion) view.replaceChildren(el('p', { class: 'error' }, error.message)); return; }
  if (version !== routeVersion) return;
  // Only the administrator gets here while it is hidden: say so, so it is not mistaken for public.
  const hiddenNote = libraryVisible(state.custom) || !libraryAdmin ? null
    : el('p', { class: 'note library-hidden-note' }, 'Oculto para los usuarios: solo lo ves tú, como administrador. Actívalo en Administración → Pelis y series.');
  if (!itemId) { view.replaceChildren(...[hiddenNote, ...libraryPage(el, section, library, browseOptions())].filter(Boolean)); return; }
  const item = (library.sections[section.key] || []).find((i) => i.id === itemId);
  if (!item) { view.replaceChildren(el('p', { class: 'error' }, 'Este título ya no está en el catálogo.'), ...(libraryShown() ? libraryPage(el, section, library) : [])); return; }
  const play = (target, episode, restart = false) => open({ ...playable(section, target, episode), restart });
  const progress = loadProgress();
  const saved = (id) => progress[id] || null;
  if (sub === 'capitulo') {
    const episode = item.episodes?.find((e) => e.id === episodeId);
    if (episode) { view.replaceChildren(...libraryEpisode(el, section, library, item, episode, play, saved)); return; }
  }
  view.replaceChildren(...libraryDetail(el, section, library, item, play, saved, sub === 'temporada' ? Number(episodeId) : null, titleExtras(section, item)));
  if (sub === 'ver') {
    const episode = episodeId ? item.episodes?.find((e) => e.id === episodeId) : null;
    const c = playable(section, item, episode);
    if (player.hidden || current?.id !== c.id) open(c, true);
  }
}

// ---- Routing ---------------------------------------------------------------------------------

let routeVersion = 0;
let accountEditing = null;
// Accounts and profiles: the header button, «¿Quién está viendo?» after signing in, and the pages that
// show the profile's rows drawn again when the profile or its data change.
const accountLink = document.getElementById('account-link');
startProfiles(shared);
let profileRedraw = 0;
onProfilesChanged(() => {
  paintAccountButton(el, accountLink);
  const page = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/')[0];
  if (needsProfile() && page !== 'cuenta' && page !== 'admin') { location.hash = '#/cuenta'; return; }
  if (page === 'cuenta' || (!page && !search.value.trim())) { clearTimeout(profileRedraw); profileRedraw = setTimeout(route, 50); }
});
async function route() {
  const version = ++routeVersion;
  stopHighlight();
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [page, arg] = hash.split('/');
  // Films, series and documentaries have their own search box: the channels and events one hides there.
  search.closest('.search').hidden = !!sectionByPage(page) || page === HALLOWEEN_PAGE || page === PLATFORM_PAGE;
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
  if (page === 'cuenta') {
    if (!player.hidden) hidePlayer();
    try {
      const f = await shared();
      if (version !== routeVersion) return;
      view.replaceChildren(...accountPage(el, f, { rerender: route, editing: accountEditing, setEditing: (value) => { accountEditing = value; },
        chosen: () => { accountEditing = null; location.hash = '#/'; } }));
    } catch {
      view.replaceChildren(el('p', { class: 'error' }, 'No se pudo conectar con las cuentas. Comprueba la conexión y recarga.'));
    }
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
  if (page === HALLOWEEN_PAGE) { await halloweenRoute(version); return; }
  if (page === PLATFORM_PAGE) { await platformRoute(hash.split('/').slice(1).join('/'), version); return; }
  if (page === 'canal' || page === 'evento') {
    // An event's own link keeps working after the match: it is only gone from the home page.
    const all = page === 'evento' ? events(state.channels, state.custom, Date.now(), { allWeeks: true, finished: true }) : [];
    const c = page === 'evento' ? (findBySlug(all, arg) || all.find(e => e.eventId === arg)) : findChannel(state.channels, arg);
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
  view.replaceChildren(...(query ? results(query) : page === 'canales' ? channelsPage(arg) : page === 'liga' ? leaguePage(arg) : page === 'directo' ? livePage() : home()));
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
  const list = events(state.channels, state.custom, Date.now(), { allWeeks: true, finished: true });
  const item = findBySlug(list, key) || list.find(c => c.id === key);
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
