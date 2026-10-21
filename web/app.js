import { merge, events, featured, groups, webPlayback, findChannel, explainStreamError, streamFailureReport } from './catalog.js';
import { initControls, icon } from './player-controls.js';
import { mountTs, videoFailure } from './ts-player.js';
import { prepareCastSource } from './cast-adapter.js';
import { initCast } from './cast-player.js';
import { sourceOptions, selectedSource, renderSourcePicker } from './player-sources.js';

const view = document.getElementById('view');
const search = document.getElementById('search');
let sharedStarted = false;
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
    import('./firebase.js').then(({ watchCatalog }) => watchCatalog(custom, ({ data }) => {
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

function card(c) {
  return el(
    'button',
    { class: c.event ? 'card event-card' : 'card', type: 'button', style: `--h:${hue(c.name)}`, onclick: () => open(c), title: c.playable ? `Ver ${c.name}` : `Abrir la web de ${c.name}` },
    el(
      'span',
      { class: 'art' },
      c.event ? el('img', { class: 'event-cover', src: c.cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : logo(c),
      el('span', { class: c.playable ? 'badge live' : 'badge' }, c.playable ? 'EN DIRECTO' : 'SU WEB'),
      c.playable ? el('span', { class: 'play-hover' }, icon('play')) : null,
    ),
    el('span', { class: 'name' }, c.name),
    el('span', { class: 'sub' }, c.region || c.group),
  );
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

function heroSection(list, index = 0) {
  const c = list[index];
  const picks =
    list.length > 1
      ? el(
          'div',
          { class: 'hero-picks', role: 'group', 'aria-label': 'Canales destacados' },
          list.slice(0, 6).map((p, i) =>
            el(
              'button',
              {
                class: 'pick',
                type: 'button',
                title: p.name,
                'aria-label': p.name,
                'aria-pressed': String(i === index),
                onclick: () => {
                  const next = heroSection(list, i);
                  section.replaceWith(next);
                  section = next;
                  next.querySelectorAll('.pick')[i].focus();
                },
              },
              logo(p),
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
      el('span', { class: 'live-pill' }, 'EN DIRECTO'),
      el('h1', {}, c.name),
      el('p', { class: 'hero-meta' }, [c.group, c.region, c.event ? 'Evento' : c.own ? 'Canal de Calamar TV' : 'Emisión oficial en abierto'].filter(Boolean).join(' · ')),
      el(
        'div',
        { class: 'hero-actions' },
        el('button', { class: 'btn lg', type: 'button', onclick: () => open(c) }, icon('play'), 'Ver ahora'),
        el('a', { class: 'btn secondary lg', href: '#/canales' }, 'Todos los canales'),
      ),
    ),
    picks,
  );
  return section;
}

function home() {
  const matches = events(state.channels, state.custom);
  const list = featured(state.channels, state.custom, 8);
  const nodes = [];
  if (matches.length) nodes.push(heroSection(matches), sectionHead('Eventos'), rail(matches, { wide: true, limit: matches.length }));
  else if (list[0]) nodes.push(heroSection(list));
  if (matches.length && list.length) nodes.push(sectionHead('Destacados'), rail(list, { wide: true }));
  else if (list.length > 1) nodes.push(sectionHead('Destacados'), rail(list.slice(1), { wide: true }));
  for (const [group, channels] of groups(state.channels)) {
    nodes.push(sectionHead(group, el('a', { href: `#/canales/${encodeURIComponent(group)}` }, `Ver ${channels.length} canales`)), rail(channels));
  }
  return nodes;
}

function channelsPage(selected) {
  const map = groups(state.channels);
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
    nodes.push(sectionHead(group, el('span', {}, `${channels.length} canales`)));
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

// Every channel has a link of its own: its id is the slug (#/canal/la-1).
let current = null;
let pushed = false;
const channelLink = (c) => `${location.origin}${location.pathname}#/canal/${encodeURIComponent(c.slug)}`;

function open(c, fromRoute = false) {
  if (!c.playable) {
    window.open(c.web, '_blank', 'noopener');
    return;
  }
  if (!fromRoute) {
    history.pushState(null, '', `#/canal/${encodeURIComponent(c.slug)}`);
    pushed = true;
  }
  if (player.hidden) returnFocus = document.activeElement;
  current = c;
  playerTitle.textContent = c.name;
  playerLogo.hidden = !c.logo;
  if (c.logo) playerLogo.src = c.logo;
  player.hidden = false;
  document.body.style.overflow = 'hidden';
  for (const n of behind()) n.inert = true;
  controls.wake();
  document.getElementById('player-close').focus();
  playSource(c, 0);
}

function hidePlayer() {
  if (controls.isFullscreen()) controls.leaveFullscreen();
  stop();
  current = null;
  player.hidden = true;
  document.body.style.overflow = '';
  for (const n of behind()) n.inert = false;
  if (returnFocus) returnFocus.focus();
}

function closePlayer() {
  hidePlayer();
  if (!location.hash.startsWith('#/canal/')) return;
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

// ---- Routing ---------------------------------------------------------------------------------

let routeVersion = 0;
async function route() {
  const version = ++routeVersion;
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
  if (page !== 'canal' && !player.hidden) hidePlayer();
  if (page === 'canal') {
    const c = findChannel(state.channels, arg);
    // Moving from an open channel to one that cannot be played here must not leave the old one running.
    if ((!c || !c.playable) && !player.hidden) hidePlayer();
    view.replaceChildren(
      ...(c && !c.playable
        ? [el('p', { class: 'status' }, `${c.name} solo tiene emisión en su web oficial: `, el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'abrir su web')), ...home()]
        : c
          ? home()
          : [el('p', { class: 'error' }, `No existe el canal «${arg || ''}». Si es nuevo, espera unos segundos y recarga.`), ...home()]),
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
