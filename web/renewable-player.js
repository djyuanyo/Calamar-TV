import { streamExpiry } from './catalog.js';

/** Read JSON data, never execute scripts from the provider. Locked sources stay locked. */
export function pageSources(html, page) {
  const assignment = /\b(?:var|let|const)\s+ZT_SOURCES\s*=\s*\[/.exec(html);
  if (!assignment) return [];
  const start = assignment.index + assignment[0].lastIndexOf('[');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      const sources = JSON.parse(html.slice(start, i + 1));
      const urls = [];
      for (const s of sources) {
        if (!s || s.locked || typeof s.url !== 'string') continue;
        try {
          const u = new URL(s.url, page);
          if (u.protocol === 'https:' && !u.username && !u.password && /\.m3u8$/i.test(u.pathname) && !urls.includes(u.href)) urls.push(u.href);
        } catch { /* Ignore invalid source data. */ }
      }
      return urls;
    }
  }
  return [];
}

export function renewalDelay(url, now = Date.now()) {
  const expiry = streamExpiry(url);
  // Unknown expiry: ask periodically. A page returning the same token must not cause a tight loop.
  return expiry ? Math.max(15000, expiry - now - 30000) : 300000;
}

/** Per-viewer resolution and renewal; no tokens are persisted in the catalog or sent to our hosting. */
export function mountRenewable({ page, video, Hls, onAttach = () => {}, onStatus = () => {}, onFallback = () => {},
  fetcher = globalThis.fetch, timers = globalThis, now = Date.now }) {
  let stopped = false, request = null, refreshTimer = null, watchdog = null, engine = null;
  let address = '', failures = 0, loaded = false, recovering = false;
  const clearRefresh = () => { timers.clearTimeout(refreshTimer); refreshTimer = null; };
  const schedule = (delay) => { clearRefresh(); refreshTimer = timers.setTimeout(() => { void refresh(); }, delay); };
  const destroyEngine = () => { if (engine) engine.destroy(); engine = null; onAttach(null); };
  const fallback = () => {
    if (stopped) return;
    cleanup();
    onFallback();
  };
  const retry = () => {
    if (stopped || request || recovering) return;
    if (++failures >= 6) { fallback(); return; }
    recovering = true;
    onStatus('La emisión se ha cortado. Renovando enlace y reconectando…');
    schedule(Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
  };
  const install = (url) => {
    const shouldPlay = !loaded || !video.paused;
    loaded = true;
    destroyEngine();
    address = url;
    if (Hls?.isSupported()) {
      const instance = engine = new Hls({ lowLatencyMode: false });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (stopped || engine !== instance) return;
        if (data.fatal || [401, 403].includes(data.response?.code)) retry();
      });
      instance.loadSource(url);
      instance.attachMedia(video);
      onAttach(instance);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
    else { fallback(); return; }
    if (shouldPlay) video.play().catch(() => { if (!stopped) onStatus('Pulsa ▶ para empezar.'); });
  };
  async function refresh() {
    if (stopped || request) return;
    clearRefresh();
    const controller = request = new AbortController();
    const timeout = timers.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(page, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (stopped || controller.signal.aborted) return;
      const sources = pageSources(html, response.url || page).filter(url => !streamExpiry(url) || streamExpiry(url) > now());
      if (!sources.length) { fallback(); return; }
      // Preserve the chosen CDN on renewal; after an error try the next CDN from the fresh page.
      let index = sources.findIndex(url => address && new URL(url).host === new URL(address).host);
      if (recovering && index >= 0) index = (index + 1) % sources.length;
      const url = sources[Math.max(0, index)];
      if (url !== address || recovering) install(url);
      if (stopped) return;
      recovering = false;
      schedule(renewalDelay(url, now()));
    } catch {
      if (stopped) return;
      // If the browser/provider disallows reading the page, use its public embedded player.
      if (!loaded || ++failures >= 6) { fallback(); return; }
      onStatus('No se pudo renovar el enlace. Reintentando…');
      schedule(Math.min(30000, 1000 * 2 ** failures));
    } finally {
      timers.clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }
  const playing = () => { if (!stopped) { failures = 0; onStatus(''); } };
  const failed = () => { if (!stopped) retry(); };
  const stalled = () => {
    timers.clearTimeout(watchdog);
    watchdog = timers.setTimeout(() => { if (!stopped && !video.paused) failed(); }, 20000);
  };
  const progressing = () => { timers.clearTimeout(watchdog); watchdog = null; };
  video.addEventListener('playing', playing);
  video.addEventListener('timeupdate', progressing);
  video.addEventListener('error', failed);
  video.addEventListener('waiting', stalled);
  video.addEventListener('stalled', stalled);
  function cleanup() {
    stopped = true;
    request?.abort();
    clearRefresh();
    timers.clearTimeout(watchdog);
    destroyEngine();
    for (const [name, listener] of [['playing', playing], ['timeupdate', progressing], ['error', failed], ['waiting', stalled], ['stalled', stalled]]) video.removeEventListener(name, listener);
  }
  onStatus('Buscando una fuente de vídeo vigente…');
  void refresh();
  return cleanup;
}
