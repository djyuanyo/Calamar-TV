// Multi-screen: several channels or events at once. Two share the screen top and bottom; three or more
// make a grid on a horizontal screen. Every video starts muted except the one with sound, which the
// viewer picks by tapping it. The app applies the same layout (MultiScreen.java).
import { sourceOptions } from './player-sources.js';
import { mountTs } from './ts-player.js';
import { mountRenewable } from './renewable-player.js';
import { expandEventSources, zicoEventApi } from './event-sources.js';
import { isZicoAgendaEvent } from './zico-agenda.js';

export const MULTI_MAX = 4;
export const multiKey = c => `${c.event ? 'e' : 'c'}:${c.eventId || c.id || c.slug}`;

/** Rows and columns for n videos: 2 -> 2x1 (top and bottom), 3-4 -> 2x2; a larger request is clamped to four. */
export function multiGrid(n) {
  n = Math.min(MULTI_MAX, n);
  if (n <= 1) return { rows: 1, cols: 1 };
  if (n === 2) return { rows: 2, cols: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  return { rows: Math.ceil(n / cols), cols };
}

/** True when the browser can play at least one source of the channel or event. */
export const multiPlayable = c => !!c && !c.vod && c.playable && (c.streams.some(zicoEventApi) || sourceOptions(c.streams).some(s => s.available && ['hls', 'ts', 'video'].includes(s.how.kind)));

/** Plays a channel in one tile, trying its sources in order; returns a function that stops it. */
export function playTile(video, channel, onStatus) {
  if (!multiPlayable(channel)) { onStatus('Este contenido no admite multipantalla'); return () => {}; }
  let sources = [];
  const lookup = new AbortController();
  let lookupTimer = null;
  let next = 0, hls = null, stopTs = null, stopRenewable = null, stopped = false, attempt = 0;
  const clear = () => {
    attempt++;
    video.onplaying = video.onerror = null;
    if (stopRenewable) { stopRenewable(); stopRenewable = null; }
    if (stopTs) { stopTs(); stopTs = null; }
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
  };
  const tryNext = () => {
    clear();
    if (stopped) return;
    const source = sources[next++];
    if (!source) { onStatus('No disponible en el navegador'); return; }
    start(source, attempt);
  };
  const start = async (source, mine) => {
    const current = () => !stopped && mine === attempt;
    onStatus('Conectando…');
    video.onplaying = () => { if (current()) onStatus(''); };
    video.onerror = () => { if (current()) tryNext(); };
    if (source.how.renewable) {
      video.onplaying = video.onerror = null;
      stopRenewable = mountRenewable({ page: source.url, video, Hls: window.Hls, preferDirect: !isZicoAgendaEvent(channel),
        onAttach: (instance) => { hls = instance; },
        onStatus: (message) => { if (current()) onStatus(message); },
        onFallback: () => { if (current()) tryNext(); },
      });
      return;
    }
    if (source.how.kind === 'ts') {
      stopTs = mountTs({ library: window.mpegts, video, address: source.url, relay: source.how.relay,
        onFailure: () => { if (current()) tryNext(); }, onRecovering: () => {}, onPlaying: () => { if (current()) onStatus(''); } });
      return;
    }
    const url = source.how.address || source.url;
    if (source.how.kind === 'hls' && window.Hls?.isSupported()) {
      hls = new window.Hls({ lowLatencyMode: false });
      hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data.fatal && current()) tryNext(); });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else video.src = url;
    video.play().catch(() => {});
  };
  const prepare = async () => {
    let streams = channel.streams;
    if (streams.some(zicoEventApi)) {
      onStatus('Consultando fuentes del evento…'); lookupTimer = setTimeout(() => lookup.abort(), 15000);
      const resolved = await expandEventSources(streams, { signal: lookup.signal, preferHosted: isZicoAgendaEvent(channel) });
      clearTimeout(lookupTimer); if (stopped) return;
      streams = resolved.filter(s => !s.error && !s.unavailable).map(s => s.url);
    }
    sources = sourceOptions(streams).filter(s => s.available && ['hls', 'ts', 'video'].includes(s.how.kind));
    if (channel.vod && channel.position > 0) video.addEventListener('loadedmetadata', () => {
      if (!stopped) video.currentTime = channel.position;
    }, { once: true });
    tryNext();
  };
  void prepare();
  return () => { stopped = true; clearTimeout(lookupTimer); lookup.abort(); clear(); };
}

let view = null;

/** Full screen grid. Adding or removing a tile leaves the other players running. */
export function openMulti(items, { onClose, onWatch = () => {}, track = () => null, onAdd, onChange = () => {} } = {}) {
  closeMulti();
  const root = document.createElement('div');
  root.className = 'multi idle'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Multipantalla');
  const bar = document.createElement('div'); bar.className = 'multi-bar';
  const button = text => Object.assign(document.createElement('button'), { type: 'button', className: 'pill-btn', textContent: text });
  const close = button('✕ Salir'), full = button('Pantalla completa'), add = button('＋ Añadir evento');
  add.setAttribute('aria-label', 'Añadir evento a multipantalla'); add.hidden = !onAdd;
  const hint = Object.assign(document.createElement('span'), { className: 'multi-hint', textContent: 'Pulsa 🔊 en un vídeo para oírlo' });
  bar.append(close, add, hint, full);
  const grid = document.createElement('div'); grid.className = 'multi-grid'; root.append(grid, bar);
  let hideTimer = null, pointer = '', audible = null;
  const tiles = [];
  const showControls = () => {
    root.classList.remove('idle'); clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!root.querySelector('button:focus-visible')) root.classList.add('idle'); }, 4000);
  };
  const listen = chosen => {
    audible = chosen;
    for (const tile of tiles) {
      const active = tile === chosen; tile.video.muted = !active; tile.node.classList.toggle('active', active);
      tile.sound.textContent = active ? '🔊' : '🔇'; tile.sound.setAttribute('aria-pressed', String(active));
    }
  };
  const snapshot = () => tiles.map(t => ({ ...t.channel, position: t.video.currentTime || 0 }));
  const layout = () => {
    const { rows, cols } = multiGrid(tiles.length);
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`; grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    tiles.forEach((t, i) => { t.node.classList.toggle('top-row', i < cols); t.remove.hidden = tiles.length < 2; });
    add.textContent = `＋ Añadir evento (${tiles.length}/${MULTI_MAX})`; add.disabled = tiles.length >= MULTI_MAX;
  };
  const remove = tile => {
    if (tiles.length < 2) return;
    tile.stop(); tile.node.remove(); tiles.splice(tiles.indexOf(tile), 1);
    if (audible === tile) listen(tiles[0]); layout(); onChange(snapshot()); showControls();
  };
  const append = (channel, changed = true) => {
    if (!multiPlayable(channel) || tiles.length >= MULTI_MAX || tiles.some(t => multiKey(t.channel) === multiKey(channel))) return false;
    const node = document.createElement('div'); node.className = 'multi-tile'; node.setAttribute('role', 'group'); node.setAttribute('aria-label', channel.name);
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true }); video.setAttribute('playsinline', '');
    const name = Object.assign(document.createElement('span'), { className: 'multi-name', textContent: channel.name });
    const status = Object.assign(document.createElement('span'), { className: 'multi-status' });
    const sound = button('🔇'); sound.className = 'multi-sound'; sound.setAttribute('aria-label', `Oír ${channel.name}`);
    const discard = button('✕'); discard.className = 'multi-remove'; discard.setAttribute('aria-label', `Quitar ${channel.name}`);
    const tile = { channel, node, video, sound, remove: discard, stop: () => {} };
    sound.addEventListener('click', e => { e.stopPropagation(); listen(tile); video.play().catch(() => {}); showControls(); });
    discard.addEventListener('click', e => { e.stopPropagation(); remove(tile); });
    node.addEventListener('click', () => {
      if (root.classList.contains('idle') || pointer === 'mouse') showControls(); else { clearTimeout(hideTimer); root.classList.add('idle'); }
    });
    node.append(video, name, status, sound, discard); grid.append(node); tiles.push(tile);
    const viewing = track(channel);
    video.addEventListener('playing', () => viewing?.watching(true));
    for (const event of ['pause', 'ended', 'waiting', 'error']) video.addEventListener(event, () => viewing?.watching(false));
    const stopPlayback = playTile(video, channel, text => { status.textContent = text; status.hidden = !text; });
    tile.stop = () => { viewing?.close(); stopPlayback(); };
    if (!audible) listen(tile); else listen(audible);
    layout(); onWatch(channel); if (changed) { onChange(snapshot()); showControls(); } return true;
  };
  for (const item of items) append(item, false);
  root.addEventListener('pointerdown', e => { pointer = e.pointerType; });
  root.addEventListener('mousemove', e => { if (e.movementX || e.movementY) showControls(); });
  root.addEventListener('focusin', e => { if (e.target !== root) showControls(); });
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await root.requestFullscreen(); if (tiles.length > 2) await screen.orientation?.lock?.('landscape').catch(() => {}); }
    } catch { /* Optional: the grid already fills the viewport. */ }
    showControls();
  };
  full.addEventListener('click', toggleFull);
  add.addEventListener('click', () => { if (tiles.length < MULTI_MAX) onAdd?.(snapshot(), append, root); });
  close.addEventListener('click', () => onClose ? onClose(snapshot()) : closeMulti());
  const keys = e => { if (e.key === 'Escape' && !document.fullscreenElement && !document.querySelector('.multi-event-picker[open]')) close.click(); };
  document.addEventListener('keydown', keys);
  document.body.append(root); document.body.style.overflow = 'hidden'; root.tabIndex = -1;
  view = { root, stops: () => tiles.forEach(t => t.stop()), keys, hideTimer: () => clearTimeout(hideTimer) };
  root.focus({ preventScroll: true });
  return { toggleFull, add: append, items: snapshot };
}

export function closeMulti() {
  if (!view) return;
  view.stops(); view.hideTimer(); document.removeEventListener('keydown', view.keys);
  if (document.fullscreenElement === view.root || document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(() => {});
  screen.orientation?.unlock?.(); view.root.remove(); document.body.style.overflow = ''; view = null;
}
export const multiOpen = () => !!view;
if (typeof window !== 'undefined') window.addEventListener('pagehide', closeMulti);
