// Multi-screen: several channels or events at once. Two share the screen top and bottom; three or more
// make a grid on a horizontal screen. Every video starts muted except the one with sound, which the
// viewer picks by tapping it. The app applies the same layout (MultiScreen.java).
import { sourceOptions } from './player-sources.js';
import { mountTs } from './ts-player.js';
import { prepareHostedVideo } from './video-bridge.js';

export const MULTI_MAX = 6;

/** Rows and columns for n videos: 2 -> 2x1 (top and bottom), 3-4 -> 2x2, 5-6 -> 2x3. */
export function multiGrid(n) {
  if (n <= 1) return { rows: 1, cols: 1 };
  if (n === 2) return { rows: 2, cols: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  return { rows: Math.ceil(n / cols), cols };
}

/** True when the browser can play at least one source of the channel or event. */
export const multiPlayable = (c) => c.playable && sourceOptions(c.streams).some((s) => s.how.ok);

/** Plays a channel in one tile, trying its sources in order; returns a function that stops it. */
export function playTile(video, channel, onStatus) {
  const sources = sourceOptions(channel.streams).filter((s) => s.how.ok && (!s.expiry || s.expiry > Date.now()));
  let next = 0, hls = null, stopTs = null, stopped = false, attempt = 0;
  const clear = () => {
    attempt++;
    video.onplaying = video.onerror = null;
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
    if (source.how.kind === 'ts') {
      stopTs = mountTs({ library: window.mpegts, video, address: source.url, relay: source.how.relay,
        onFailure: () => { if (current()) tryNext(); }, onRecovering: () => {}, onPlaying: () => { if (current()) onStatus(''); } });
      return;
    }
    let url = source.url, file = false;
    if (source.how.kind === 'file') {
      try {
        const ready = await prepareHostedVideo(source.url, { isCurrent: current, onStatus: (m) => { if (current()) onStatus(m); } });
        if (!ready || !current()) return;
        url = ready.url; file = true;
      } catch (error) { if (current()) { onStatus(error.message); tryNext(); } return; }
    }
    if ((source.how.kind === 'hls' || file) && window.Hls?.isSupported()) {
      hls = new window.Hls(file ? { startPosition: 0 } : { lowLatencyMode: false });
      hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data.fatal && current()) tryNext(); });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else video.src = url;
    video.play().catch(() => {});
  };
  tryNext();
  return () => { stopped = true; clear(); };
}

let view = null;

/** Shows the channels full screen in a grid; `onClose` runs when the viewer leaves it. */
export function openMulti(items, { onClose, onWatch = () => {} } = {}) {
  closeMulti();
  const list = items.slice(0, MULTI_MAX);
  const { rows, cols } = multiGrid(list.length);
  const root = document.createElement('div');
  root.className = 'multi';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Multipantalla');
  // The buttons stay hidden over the videos; a tap shows them for a few seconds (another tap hides
  // them). Sound only changes with each video's own sound button, so a tap never moves the audio.
  root.classList.add('idle');
  const bar = document.createElement('div');
  bar.className = 'multi-bar';
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'pill-btn', textContent: '✕ Salir' });
  const full = Object.assign(document.createElement('button'), { type: 'button', className: 'pill-btn', textContent: 'Pantalla completa' });
  const hint = Object.assign(document.createElement('span'), { className: 'multi-hint', textContent: 'Pulsa 🔊 en un vídeo para oírlo' });
  bar.append(close, hint, full);
  const grid = document.createElement('div');
  grid.className = 'multi-grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  let hideTimer = null, pointer = '';
  root.addEventListener('pointerdown', (event) => { pointer = event.pointerType; });
  const showControls = () => {
    root.classList.remove('idle');
    clearTimeout(hideTimer);
    // They stay while a keyboard user is on one of them; taps and clicks let them hide.
    hideTimer = setTimeout(() => { if (!root.querySelector('button:focus-visible')) root.classList.add('idle'); }, 4000);
  };
  const hideControls = () => { clearTimeout(hideTimer); root.classList.add('idle'); };
  const stops = [], tiles = [];
  const listen = (index) => tiles.forEach((tile, i) => {
    tile.video.muted = i !== index;
    tile.node.classList.toggle('active', i === index);
    tile.sound.textContent = i === index ? '🔊' : '🔇';
    tile.sound.setAttribute('aria-pressed', String(i === index));
  });
  list.forEach((channel, index) => {
    const node = document.createElement('div');
    node.className = index < cols ? 'multi-tile top-row' : 'multi-tile';
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', channel.name);
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    video.setAttribute('playsinline', '');
    const name = Object.assign(document.createElement('span'), { className: 'multi-name', textContent: channel.name });
    const status = Object.assign(document.createElement('span'), { className: 'multi-status' });
    const sound = Object.assign(document.createElement('button'), { type: 'button', className: 'multi-sound' });
    sound.setAttribute('aria-label', `Oír ${channel.name}`);
    sound.addEventListener('click', (event) => { event.stopPropagation(); listen(index); video.play().catch(() => {}); showControls(); });
    node.append(video, name, status, sound);
    // A tap toggles the buttons; with a mouse (which already shows them by moving) a click only shows them.
    node.addEventListener('click', () => (root.classList.contains('idle') || pointer === 'mouse' ? showControls() : hideControls()));
    grid.append(node);
    tiles.push({ node, video, sound });
    stops.push(playTile(video, channel, (text) => { status.textContent = text; status.hidden = !text; }));
    onWatch(channel);
  });
  root.append(grid, bar);
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  listen(0);
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await root.requestFullscreen();
        // Three or more videos read best on a horizontal screen (phones allow the lock in full screen).
        if (list.length > 2) await screen.orientation?.lock?.('landscape').catch(() => {});
      }
    } catch { /* Full screen is optional: the grid already fills the window. */ }
    showControls();
  };
  full.addEventListener('click', toggleFull);
  close.addEventListener('click', () => onClose ? onClose() : closeMulti());
  // Keyboard and mouse users get the controls too: moving the pointer or the focus shows them.
  root.addEventListener('mousemove', (event) => { if (event.movementX || event.movementY) showControls(); });
  root.addEventListener('focusin', (event) => { if (event.target !== root) showControls(); });
  const keys = (event) => { if (event.key === 'Escape' && !document.fullscreenElement) close.click(); };
  document.addEventListener('keydown', keys);
  root.tabIndex = -1;
  view = { root, stops, keys, hideTimer: () => clearTimeout(hideTimer) };
  root.focus({ preventScroll: true });
  return { toggleFull };
}

export function closeMulti() {
  if (!view) return;
  view.stops.forEach((stop) => stop());
  view.hideTimer();
  document.removeEventListener('keydown', view.keys);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  screen.orientation?.unlock?.();
  view.root.remove();
  document.body.style.overflow = '';
  view = null;
}

export const multiOpen = () => !!view;
