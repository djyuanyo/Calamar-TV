// Custom controls for the web player: play/pause, volume, live edge, quality, picture in picture
// and full screen. The video element keeps no native controls, so everything here is accessible
// through buttons, the keyboard and touch.

const ICONS = {
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M17.8 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  muted: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8 4.5-1.9.4a6.9 6.9 0 0 1-.7 1.7l1.1 1.6-1.7 1.7-1.6-1.1c-.5.3-1.1.5-1.7.7L13 20h-2l-.4-1.9a6.9 6.9 0 0 1-1.7-.7l-1.6 1.1-1.7-1.7 1.1-1.6c-.3-.5-.5-1.1-.7-1.7L4 13v-2l1.9-.4c.1-.6.4-1.2.7-1.7L5.5 7.3l1.7-1.7 1.6 1.1c.5-.3 1.1-.5 1.7-.7L11 4h2l.4 1.9c.6.1 1.2.4 1.7.7l1.6-1.1 1.7 1.7-1.1 1.6c.3.5.5 1.1.7 1.7L20 11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  pip: '<path d="M4 6h16v12H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 11h6v4h-6z"/>',
  enter: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // The paths above are constants of this file, never data.
  svg.innerHTML = ICONS[name];
  return svg;
}

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const formatTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* Private mode or blocked storage: the preference just is not remembered. */
  }
  return null;
}

export function initControls({ root, video, onClose, canClose = () => true }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const els = {
    play: $('ctl-play'),
    mute: $('ctl-mute'),
    volume: $('ctl-volume'),
    seek: $('ctl-seek'),
    time: $('ctl-time'),
    live: $('ctl-live'),
    pill: $('player-pill'),
    quality: $('ctl-quality'),
    menu: $('ctl-menu'),
    pip: $('ctl-pip'),
    full: $('ctl-full'),
    center: $('ctl-center'),
    chrome: root.querySelectorAll('.player-top, .player-bottom, .player-status'),
  };
  let hls = null;
  let idleTimer = 0;
  let clickTimer = 0;
  const touch = matchMedia('(hover: none)');

  els.play.replaceChildren(icon('play'));
  els.mute.replaceChildren(icon('volume'));
  els.quality.replaceChildren(icon('settings'));
  els.pip.replaceChildren(icon('pip'));
  els.full.replaceChildren(icon('enter'));
  els.center.replaceChildren(icon('play'));

  // ---- Play and pause ----
  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  const setPlaying = () => {
    const paused = video.paused;
    els.play.replaceChildren(icon(paused ? 'play' : 'pause'));
    els.play.setAttribute('aria-label', paused ? 'Reproducir' : 'Pausar');
    root.classList.toggle('is-paused', paused);
    wake();
  };
  els.play.addEventListener('click', toggle);
  els.center.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  video.addEventListener('play', setPlaying);
  video.addEventListener('pause', setPlaying);
  video.addEventListener('loadedmetadata', setPlaying);
  video.addEventListener('waiting', () => root.classList.add('is-buffering'));
  for (const name of ['playing', 'canplay', 'seeked']) video.addEventListener(name, () => root.classList.remove('is-buffering'));

  // ---- Volume ----
  const stored = store('calamar-volume');
  const saved = stored === null ? NaN : Number(stored);
  video.volume = saved >= 0 && saved <= 1 ? saved : 1;
  video.muted = store('calamar-muted') === '1';
  const showVolume = () => {
    const silent = video.muted || video.volume === 0;
    els.mute.replaceChildren(icon(silent ? 'muted' : 'volume'));
    els.mute.setAttribute('aria-label', silent ? 'Activar sonido' : 'Silenciar');
    els.volume.value = silent ? 0 : video.volume;
  };
  video.addEventListener('volumechange', () => {
    showVolume();
    store('calamar-volume', String(video.volume));
    store('calamar-muted', video.muted ? '1' : '0');
  });
  els.mute.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  });
  els.volume.addEventListener('input', () => {
    video.volume = Number(els.volume.value);
    video.muted = video.volume === 0;
  });
  showVolume();

  // ---- Progress (video on demand) and live edge ----
  // hls.js reports a finite duration for a live stream, so ask its playlist; plain files have no playlist
  // and are live only when the browser says the duration is infinite.
  let hlsLive = null;
  const isLive = () => (hls && hlsLive !== null ? hlsLive : !Number.isFinite(video.duration));
  const refreshTime = () => {
    const live = isLive();
    root.classList.toggle('is-live', live);
    els.live.hidden = !live;
    els.pill.hidden = !live;
    els.seek.hidden = live;
    els.time.hidden = live;
    if (!live) {
      els.seek.max = String(video.duration || 0);
      if (!els.seek.matches(':active')) els.seek.value = String(video.currentTime);
      els.seek.style.setProperty('--progress', `${video.duration ? (video.currentTime / video.duration) * 100 : 0}%`);
      els.time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    } else {
      els.live.classList.toggle('behind', behindLive() > 12);
    }
  };
  function liveEdge() {
    if (hls && Number.isFinite(hls.liveSyncPosition)) return hls.liveSyncPosition;
    const r = video.seekable;
    return r && r.length ? r.end(r.length - 1) : NaN;
  }
  function behindLive() {
    const edge = liveEdge();
    return Number.isFinite(edge) ? edge - video.currentTime : 0;
  }
  els.live.addEventListener('click', () => {
    const edge = liveEdge();
    if (Number.isFinite(edge)) video.currentTime = edge;
    video.play().catch(() => {});
  });
  els.seek.addEventListener('input', () => {
    video.currentTime = Number(els.seek.value);
    refreshTime();
  });
  for (const name of ['timeupdate', 'durationchange', 'loadedmetadata', 'emptied']) video.addEventListener(name, refreshTime);

  // ---- Quality (HLS levels) ----
  const closeMenu = () => {
    els.menu.hidden = true;
    els.quality.setAttribute('aria-expanded', 'false');
  };
  function buildMenu() {
    const levels = hls ? hls.levels || [] : [];
    els.quality.hidden = levels.length < 2;
    els.menu.replaceChildren();
    if (levels.length < 2) return;
    const options = [{ label: 'Automática', level: -1 }];
    levels
      .map((l, level) => ({ label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} kbps`, level, height: l.height || 0 }))
      .sort((a, b) => b.height - a.height || b.level - a.level)
      .forEach((o) => options.push(o));
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(hls.autoLevelEnabled ? o.level === -1 : hls.currentLevel === o.level));
      b.textContent = o.label;
      b.addEventListener('click', () => {
        hls.currentLevel = o.level;
        buildMenu();
        closeMenu();
        els.quality.focus();
      });
      els.menu.append(b);
    }
  }
  els.quality.addEventListener('click', () => {
    const open = els.menu.hidden;
    if (open) buildMenu();
    els.menu.hidden = !open;
    els.quality.setAttribute('aria-expanded', String(open));
    if (open) els.menu.querySelector('[aria-checked="true"]')?.focus();
  });
  els.menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
      els.quality.focus();
    }
  });

  // ---- Picture in picture ----
  const pipSupported = !!document.pictureInPictureEnabled && !video.disablePictureInPicture;
  els.pip.hidden = !pipSupported;
  els.pip.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* The browser refused (no active video yet, or a policy). */
    }
  });

  // ---- Full screen ----
  const canFullscreen = !!(root.requestFullscreen || root.webkitRequestFullscreen || video.webkitEnterFullscreen);
  els.full.hidden = !canFullscreen;
  async function enterFullscreen() {
    try {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone: only the video can go full screen
      try {
        // On phones the video is almost always better in landscape.
        if (screen.orientation && screen.orientation.lock && touch.matches) await screen.orientation.lock('landscape');
      } catch {
        /* Desktop browsers and some phones do not allow locking. */
      }
    } catch {
      /* Refused by the browser; the button stays as it was. */
    }
  }
  async function leaveFullscreen() {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch {
      /* Already out. */
    }
    try {
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch {
      /* Not locked. */
    }
  }
  const toggleFullscreen = () => (fullscreenElement() ? leaveFullscreen() : enterFullscreen());
  const showFullscreen = () => {
    const on = !!fullscreenElement();
    els.full.replaceChildren(icon(on ? 'exit' : 'enter'));
    els.full.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa');
    els.full.setAttribute('aria-pressed', String(on));
    root.classList.toggle('is-fullscreen', on);
    wake();
  };
  els.full.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', showFullscreen);
  document.addEventListener('webkitfullscreenchange', showFullscreen);
  showFullscreen();

  // ---- Showing and hiding the controls ----
  function hideNow() {
    if (video.paused || !els.menu.hidden) return;
    // Keep the controls while someone uses them: keyboard focus inside them, or a real mouse over them.
    // (A touch screen leaves :hover stuck on the last thing tapped, and the focus given to the Back
    // button when the player opens is not a reason to keep them on screen.)
    const active = document.activeElement;
    if (active?.id === 'player-source-select') return;
    const keyboardInside = keyboardUser && !!active && [...els.chrome].some((n) => n.contains(active));
    const hovering = !touch.matches && [...els.chrome].some((n) => n.matches(':hover'));
    if (keyboardInside || hovering) return;
    root.classList.add('idle');
  }
  function wake() {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(hideNow, 3200);
  }
  // :focus-visible cannot tell us this: a browser shows it on the Back button even when the player
  // was opened from a shared link and nobody has touched the keyboard.
  let keyboardUser = false;
  let wasIdleAtPress = false;
  root.addEventListener('pointermove', wake);
  root.addEventListener('pointerdown', () => {
    // Remembered because wake() below clears it before the click arrives.
    wasIdleAtPress = root.classList.contains('idle');
    keyboardUser = false;
    wake();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') keyboardUser = true;
    wake();
  });

  // Desktop: click pauses, double click toggles full screen. Touch: a tap shows or hides the controls.
  root.querySelector('.player-stage').addEventListener('click', (e) => {
    if (e.target.closest('button, input, select, a')) return;
    if (touch.matches) {
      // A tap on a hidden control bar shows it (pointerdown already did); a tap on a visible one hides it.
      if (!wasIdleAtPress) {
        root.classList.add('idle');
        clearTimeout(idleTimer);
      }
      return;
    }
    clearTimeout(clickTimer);
    if (e.detail > 1) return;
    clickTimer = setTimeout(toggle, 230);
  });
  root.querySelector('.player-stage').addEventListener('dblclick', (e) => {
    if (touch.matches || e.target.closest('button, input, select, a')) return; // On touch, two taps must not jump to full screen.
    clearTimeout(clickTimer);
    toggleFullscreen();
  });

  // ---- Keyboard ----
  function onKey(e) {
    if (root.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const onButton = tag === 'BUTTON';
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      // Full screen is left by the browser itself; only a second Escape closes the player.
      if (!els.menu.hidden) closeMenu();
      else if (!fullscreenElement() && canClose()) onClose();
      return;
    }
    // Space on a focused button already activates that button.
    if (key === 'k' || (key === ' ' && !onButton)) toggle();
    else if (key === 'f') toggleFullscreen();
    else if (key === 'm') video.muted = !video.muted;
    else if (e.key === 'ArrowUp') {
      video.muted = false;
      video.volume = Math.min(1, video.volume + 0.05);
    } else if (e.key === 'ArrowDown') video.volume = Math.max(0, video.volume - 0.05);
    else if (e.key === 'ArrowRight' && !isLive()) video.currentTime += 10;
    else if (e.key === 'ArrowLeft' && !isLive()) video.currentTime -= 10;
    else return;
    e.preventDefault();
    wake();
  }
  document.addEventListener('keydown', onKey);

  return {
    /** Called each time a new source starts. `instance` is the hls.js object, or null. */
    attach(instance) {
      hls = instance;
      closeMenu();
      els.quality.hidden = true;
      root.classList.remove('is-buffering');
      hlsLive = null;
      if (instance && window.Hls) {
        instance.on(window.Hls.Events.LEVEL_LOADED, (_event, data) => {
          hlsLive = !!(data && data.details && data.details.live);
          refreshTime();
        });
        instance.on(window.Hls.Events.MANIFEST_PARSED, buildMenu);
        instance.on(window.Hls.Events.LEVEL_SWITCHED, () => els.menu.hidden || buildMenu());
      }
      refreshTime();
      wake();
    },
    reset() {
      hls = null;
      hlsLive = null;
      closeMenu();
      els.quality.hidden = true;
      root.classList.remove('is-buffering', 'idle');
      refreshTime();
    },
    enterFullscreen,
    leaveFullscreen,
    isFullscreen: () => !!fullscreenElement(),
    wake,
  };
}
