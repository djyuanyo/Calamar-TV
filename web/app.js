import { merge, featured, groups, webPlayback } from './catalog.js';

const view = document.getElementById('view');
const search = document.getElementById('search');
const state = { tdt: null, custom: null, channels: [], error: '' };

export async function fetchJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function loadCatalog() {
  const [tdt, custom] = await Promise.all([fetchJson('data/tdt.json'), fetchJson('data/custom.json')]);
  state.tdt = tdt;
  state.custom = custom;
  state.channels = merge(tdt, custom);
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

function logo(c, cls) {
  if (!c.logo) return el('span', { class: 'initials' }, initials(c.name));
  const img = el('img', { src: c.logo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', class: cls });
  img.addEventListener('error', () => img.replaceWith(el('span', { class: 'initials' }, initials(c.name))));
  return img;
}

function card(c) {
  return el(
    'button',
    { class: 'card', type: 'button', onclick: () => open(c), title: c.playable ? `Ver ${c.name}` : `Abrir la web de ${c.name}` },
    el('span', { class: 'art' }, logo(c), el('span', { class: c.playable ? 'badge live' : 'badge' }, c.playable ? 'EN DIRECTO' : 'SU WEB')),
    el('span', { class: 'name' }, c.name),
    el('span', { class: 'sub' }, c.region || c.group),
  );
}

function sectionHead(title, aside) {
  return el('div', { class: 'section-head' }, el('h2', {}, title), aside);
}

function home() {
  const list = featured(state.channels, state.custom, 8);
  const nodes = [];
  if (list[0]) {
    const c = list[0];
    nodes.push(
      el(
        'section',
        { class: 'hero' },
        logo(c),
        el('span', { class: 'kicker' }, `● EN DIRECTO / ${c.group}`),
        el('h1', {}, c.name),
        el('p', {}, c.own ? 'Canal de Calamar TV' : 'Emisión oficial en abierto'),
        el('button', { class: 'btn', type: 'button', onclick: () => open(c) }, '▶ Ver ahora'),
      ),
    );
  }
  if (list.length > 1) nodes.push(sectionHead('Destacados'), el('div', { class: 'row' }, list.slice(1).map(card)));
  for (const [group, channels] of groups(state.channels)) {
    nodes.push(
      sectionHead(group, el('a', { href: `#/canales/${encodeURIComponent(group)}` }, `Ver ${channels.length} canales`)),
      el('div', { class: 'row' }, channels.slice(0, 40).map(card)),
    );
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
let hls = null;
let returnFocus = null;

function stop() {
  if (hls) hls.destroy();
  hls = null;
  video.removeAttribute('src');
  video.load();
}

function playSource(c, index) {
  stop();
  const playable = c.streams.map((url) => ({ url, how: webPlayback(url) })).filter((s) => s.how.ok);
  playerSources.replaceChildren(
    ...(playable.length > 1
      ? playable.map((s, i) => el('button', { class: 'ghost', type: 'button', 'aria-pressed': String(i === index), onclick: () => playSource(c, i) }, `Fuente ${i + 1}`))
      : []),
  );
  if (!playable.length) {
    const reason = webPlayback(c.streams[0] || '').reason || 'Sin fuente compatible';
    playerStatus.replaceChildren(`${reason}. Disponible en la app Calamar TV.`, c.web ? el('span', {}, ' ', el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'Ver en su web oficial')) : '');
    return;
  }
  const source = playable[index];
  const next = () => {
    if (index + 1 < playable.length) {
      playerStatus.textContent = 'Esta fuente no responde. Probando la siguiente…';
      playSource(c, index + 1);
    } else {
      playerStatus.replaceChildren('No se pudo reproducir en el navegador. ', c.web ? el('a', { href: c.web, rel: 'noopener', target: '_blank' }, 'Ver en su web oficial') : 'Prueba en la app Calamar TV.');
    }
  };
  playerStatus.textContent = 'Conectando…';
  if (source.how.kind === 'hls' && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ lowLatencyMode: false });
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) next();
    });
    hls.loadSource(source.url);
    hls.attachMedia(video);
  } else {
    video.src = source.url;
  }
  video.onplaying = () => (playerStatus.textContent = `En directo · ${c.name}${c.geo ? ' · solo desde España' : ''}`);
  video.onerror = () => next();
  video.play().catch(() => (playerStatus.textContent = 'Pulsa ▶ para empezar.'));
}

function open(c) {
  if (!c.playable) {
    window.open(c.web, '_blank', 'noopener');
    return;
  }
  returnFocus = document.activeElement;
  playerTitle.textContent = c.name;
  player.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('player-close').focus();
  playSource(c, 0);
}

function closePlayer() {
  stop();
  player.hidden = true;
  document.body.style.overflow = '';
  if (returnFocus) returnFocus.focus();
}
document.getElementById('player-close').addEventListener('click', closePlayer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !player.hidden) closePlayer();
});

// ---- Routing ---------------------------------------------------------------------------------

async function route() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [page, arg] = hash.split('/');
  for (const a of document.querySelectorAll('[data-route]'))
    a.toggleAttribute('aria-current', a.dataset.route === (page || 'inicio'));
  for (const a of document.querySelectorAll('[aria-current]')) a.setAttribute('aria-current', 'page');
  if (page === 'admin') {
    try {
      const admin = await import('./admin.js');
      view.replaceChildren(...(await admin.render(state)));
    } catch {
      view.replaceChildren(el('p', { class: 'error' }, 'No se pudo cargar la administración. Comprueba la conexión y recarga.'));
    }
    return;
  }
  if (!state.tdt) {
    view.replaceChildren(el('p', { class: 'status' }, 'Cargando canales…'));
    try {
      await loadCatalog();
    } catch (e) {
      view.replaceChildren(el('p', { class: 'error' }, `No se pudo cargar el catálogo (${e.message}). Recarga la página.`));
      return;
    }
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
  search.value = '';
  route();
});
route();
