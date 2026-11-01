import { streamExpiry, explainStreamError } from './catalog.js';

/** The signed URL stays byte-for-byte intact and is never sent to the hosting server. */
export function readSource(fragment) {
  try {
    const address = decodeURIComponent(fragment.replace(/^#/, ''));
    const url = new URL(address);
    return url.protocol === 'https:' && !url.username && !url.password && /\.m3u8$/i.test(url.pathname)
      ? address : null;
  } catch {
    return null;
  }
}

export function mount({ video, status, play, retry, fragment, Hls }) {
  const address = readSource(fragment);
  let hls = null;
  let generation = 0;
  let failed = false;
  const stop = () => {
    generation++;
    video.onerror = null;
    video.onplaying = null;
    if (hls) hls.destroy();
    hls = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
  const start = () => {
    stop();
    failed = false;
    if (!address) {
      status.textContent = 'Enlace HLS no válido.';
      return;
    }
    const expiry = streamExpiry(address);
    if (expiry && expiry <= Date.now()) {
      status.textContent = 'El enlace ha caducado. Actualízalo en el catálogo.';
      return;
    }
    const request = generation;
    const fail = (data) => {
      if (request !== generation || failed) return;
      failed = true;
      if (hls) hls.stopLoad();
      video.pause();
      status.textContent = data ? explainStreamError({
        details: data.details || '', code: data.response?.code || 0,
        url: data.url || data.frag?.url || address, expiry,
      }) : 'No se pudo reproducir. Comprueba el enlace y la conexión.';
    };
    status.textContent = 'Conectando…';
    video.onerror = () => fail();
    video.onplaying = () => { if (!failed && request === generation) status.textContent = 'En directo'; };
    const begin = () => video.play().catch(() => {
      if (!failed && request === generation) status.textContent = 'Pulsa Reproducir para empezar.';
    });
    if (Hls && Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: false });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(data); });
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!failed && request === generation) begin(); });
      hls.loadSource(address);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = address;
      begin();
    } else {
      status.textContent = 'Actualiza Android System WebView para usar el reproductor web.';
    }
  };
  play.addEventListener('click', () => {
    if (failed) start();
    else if (video.paused) video.play().catch(() => { status.textContent = 'No se pudo iniciar el vídeo.'; });
    else video.pause();
  });
  retry.addEventListener('click', start);
  start();
  play.focus();
  return stop;
}

if (typeof document !== 'undefined') {
  const unmount = mount({
    video: document.getElementById('video'), status: document.getElementById('status'),
    play: document.getElementById('play'), retry: document.getElementById('retry'),
    fragment: location.hash, Hls: window.Hls,
  });
  window.addEventListener('pagehide', unmount, { once: true });
}
