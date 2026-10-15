import { merge, featured, groups, webPlayback, findChannel, streamExpiry, explainStreamError } from './catalog.js';
import { initControls, icon } from './player-controls.js';

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
    { class: 'card', type: 'button', style: `--h:${hue(c.name)}`, onclick: () => open(c), title: c.playable ? `Ver ${c.name}` : `Abrir la web de ${c.name}` },
    el(
      'span',
      { class: 'art' },
      logo(c),
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
    { class: 'hero', style: `--h:${hue(c.name)}`, 'aria-label': 'Canal destacado' },
    el('div', { class: 'hero-bg' }),
    logo(c, 'hero-art'),
    el(
      'div',
      { class: 'hero-body' },
      el('span', { class: 'live-pill' }, 'EN DIRECTO'),
      el('h1', {}, c.name),
      el('p', { class: 'hero-meta' }, [c.group, c.region, c.own ? 'Canal de Calamar TV' : 'Emisión oficial en abierto'].filter(Boolean).join(' · ')),
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
  const list = featured(state.channels, state.custom, 8);
  const nodes = [];
  if (list[0]) nodes.push(heroSection(list));
  if (list.length > 1) nodes.push(sectionHead('Destacados'), rail(list.slice(1), { wide: true }));
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
  const found = state.channels.filter((c) => norm(`${c.name} ${c.region} ${c.group}`).includes(q));
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
let returnFocus = null;
const controls = initControls({ root: player, video, onClose: () => closePlayer(), canClose: () => !player.hidden });
// While the player is open nothing behind it can be reached with the keyboard or a screen reader.
const behind = () => document.querySelectorAll('.skip, .top, main, .foot');

function stop() {
  if (hls) hls.destroy();
  hls = null;
  video.removeAttribute('src');
  video.load();
  controls.reset();
}

function playSource(c, index) {
  stop();
  const candidates = c.streams.map((url) => ({ url, how: webPlayback(url), expiry: streamExpiry(url) })).filter((s) => s.how.ok);
  // A signed link past its time cannot work, so do not even try it.
  const playable = candidates.filter((s) => !s.expiry || s.expiry > Date.now());
  playerSources.replaceChildren(
    ...(playable.length > 1
      ? playable.map((s, i) => el('button', { class: 'ghost', type: 'button', 'aria-pressed': String(i === index), onclick: () => playSource(c, i) }, `Fuente ${i + 1}`))
      : []),
  );
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
  const source = playable[index];
  const next = (data) => {
    if (index + 1 < playable.length) {
      playerStatus.textContent = 'Esta fuente no responde. Probando la siguiente…';
      playSource(c, index + 1);
    } else {
      const reason = data ? explainStreamError({ details: data.details, code: data.response && data.response.code }) : 'No se pudo reproducir esta emisión en el navegador.';
      playerStatus.replaceChildren(`${reason} `, c.web ? el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'Ver en su web oficial') : 'Prueba en la app Calamar TV.');
    }
  };
  playerStatus.textContent = 'Conectando…';
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
  video.onplaying = () => (playerStatus.textContent = '');
  video.onerror = () => next();
  video.play().catch(() => (playerStatus.textContent = 'Pulsa ▶ para empezar.'));
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

const copyButton = document.getElementById('player-copy');

/** Copies text; resolves true only when the browser really accepted it. */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* Fall back to the older method below. */
    }
  }
  const box = el('textarea', { 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px' });
  box.value = text;
  player.append(box);
  box.focus();
  box.select();
  box.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  box.remove();
  return ok;
}

copyButton.addEventListener('click', async () => {
  if (!current) return;
  const link = channelLink(current);
  if (await copyText(link)) {
    copyButton.textContent = 'Enlace copiado';
    setTimeout(() => (copyButton.textContent = 'Copiar enlace'), 2000);
    return;
  }
  // The browser refused: show the link selected so it can be copied by hand.
  const field = el('input', { class: 'link-field', readonly: true, value: link, 'aria-label': 'Enlace del canal' });
  playerStatus.replaceChildren('No se pudo copiar automáticamente. Copia este enlace: ', field);
  field.focus();
  field.select();
});
document.getElementById('player-close').addEventListener('click', closePlayer);

// ---- Routing ---------------------------------------------------------------------------------

let routeVersion = 0;
async function route() {
  const version = ++routeVersion;
  const previousFootball = document.querySelector('#football-view');
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [page, arg] = hash.split('/');
  for (const a of document.querySelectorAll('[data-route]'))
    a.toggleAttribute('aria-current', a.dataset.route === (page || 'inicio'));
  for (const a of document.querySelectorAll('[aria-current]')) a.setAttribute('aria-current', 'page');
  if (page !== 'futbol' && previousFootball) {
    const mod = await import('./football.js');
    if (version !== routeVersion) return;
    mod.leaveFootball();
  }
  if (page === 'futbol') {
    if (!player.hidden) hidePlayer();
    const mod = await import('./football.js');
    if (version !== routeVersion || !location.hash.startsWith('#/futbol')) return;
    await mod.renderFootball(view);
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
