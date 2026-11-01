import { streamExpiry, renewablePage, PLAYER_ENDPOINT } from './catalog.js';
import { hostedRequest, hostedUrl, expandHostedSources } from './hosted-sources.js';
import { autoplay } from './autoplay.js';

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

/** A fixed player page or an explicit signal selected from our hosting menu. */
export function hostedPage(address) {
  if (renewablePage(address)) return address;
  try {
    const u = new URL(address), endpoint = new URL(PLAYER_ENDPOINT), page = u.searchParams.get('page');
    if (u.origin === endpoint.origin && u.pathname === endpoint.pathname && !u.username && !u.password && renewablePage(page)) return page;
  } catch { /* Not a hosting choice. */ }
  return null;
}

/** Use the 2.20.67 device route, with signed hosting as an independent fallback. */
export function mountRenewable({ page, video, Hls, onAttach = () => {}, onStatus = () => {}, onFallback = () => {}, onSources = null,
  fetcher = globalThis.fetch, timers = globalThis, now = Date.now, preferDirect = true }) {
  const original = hostedPage(page);
  let stopped = false, request = null, menu = null, menuTimer = null, refreshTimer = null, watchdog = null, engine = null;
  let address = '', failures = 0, loaded = false, recovering = false, menuStarted = false, deviceRoute = false;
  const selected = new URL(original && !renewablePage(page) ? page : hostedRequest(original || ''));
  selected.searchParams.set('cast', '1');
  const automatic = !selected.searchParams.has('src') && !selected.searchParams.has('source_id');
  deviceRoute = preferDirect && automatic;
  const clearRefresh = () => { timers.clearTimeout(refreshTimer); refreshTimer = null; };
  const schedule = delay => { clearRefresh(); refreshTimer = timers.setTimeout(() => { void refresh(); }, delay); };
  const destroyEngine = () => { if (engine) engine.destroy(); engine = null; onAttach(null); };
  const retry = (networkFailure = false) => {
    if (stopped || request || recovering) return;
    if (automatic && networkFailure) deviceRoute = !deviceRoute;
    failures++; recovering = true;
    onStatus('Probando otra señal disponible…');
    // Initial source failures switch promptly. Backoff only protects a continuing provider outage.
    schedule(failures <= 3 ? 250 : Math.min(10000, 1000 * 2 ** Math.min(failures - 3, 4)));
  };
  const install = url => {
    const shouldPlay = !loaded || !video.paused;
    loaded = true; destroyEngine(); address = url;
    if (Hls?.isSupported()) {
      const instance = engine = new Hls({ lowLatencyMode: false, maxBufferLength: 30 });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!stopped && engine === instance && (data.fatal || [401, 403].includes(data.response?.code))) retry(data.response?.code === 0);
      });
      instance.loadSource(url); instance.attachMedia(video); onAttach(instance);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
    else { cleanup(); onFallback(); return; }
    if (shouldPlay) autoplay(video).catch(() => { if (!stopped) onStatus('Pulsa ▶ para empezar.'); });
  };
  async function refresh() {
    if (stopped || request) return;
    clearRefresh();
    const usingDevice = deviceRoute;
    const controller = request = new AbortController();
    const timeout = timers.setTimeout(() => controller.abort(), deviceRoute ? 15000 : 35000);
    try {
      if (!original) throw Error('Enlace de canal no válido.');
      const target = new URL(selected);
      if (automatic && failures) target.searchParams.set('intento', String(Math.min(9, failures)));
      let url;
      if (deviceRoute && automatic) {
        const response = await fetcher(original, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw Error(`Proveedor HTTP ${response.status}`);
        const sources = pageSources(await response.text(), response.url || original).filter(url => !streamExpiry(url) || streamExpiry(url) > now());
        if (!sources.length) throw Error('No hay señales públicas disponibles.');
        let index = sources.findIndex(url => address && new URL(url).host === new URL(address).host);
        if (recovering && index >= 0) index = (index + 1) % sources.length;
        url = sources[Math.max(0, index)];
      } else {
        let response;
        try { response = await fetcher(target.href, { cache: 'no-store', credentials: 'omit', signal: controller.signal }); }
        catch (error) {
          // A network failure is different from a rejected or invalid hosting response.
          if (!stopped && automatic && (error instanceof TypeError || error.name === 'AbortError')) deviceRoute = true;
          throw error;
        }
        const data = await response.json();
        if (!response.ok) throw Error(data.error || `Hosting HTTP ${response.status}`);
        url = hostedUrl(data.url);
      }
      if (stopped || controller.signal.aborted) return;
      if (url !== address || recovering) install(url);
      if (stopped) return;
      recovering = false;
      // Both routes receive fresh provider tokens; renew on expiry and on playback errors.
      let upstream = deviceRoute ? url : '';
      if (!deviceRoute) try {
        const code = new URL(url).searchParams.get('seg').replaceAll('-', '+').replaceAll('_', '/');
        upstream = atob(code.padEnd(Math.ceil(code.length / 4) * 4, '='));
      } catch { /* Unknown token: periodic renewal. */ }
      schedule(renewalDelay(upstream, now()));
    } catch (error) {
      if (stopped) return;
      if (usingDevice) deviceRoute = false;
      failures++;
      const delay = failures <= 3 ? 250 : Math.min(10000, 1000 * 2 ** Math.min(failures - 3, 4));
      onStatus(deviceRoute ? 'El hosting no responde. Probando la conexión directa…' : 'No se pudo conectar con la señal. Reintentando…');
      schedule(delay);
    } finally {
      timers.clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }
  const playing = () => {
    if (stopped) return;
    failures = 0; onStatus('');
    // Populate the optional selector after playback, so metadata never delays the first picture.
    if (!onSources || menuStarted || deviceRoute) return;
    menuStarted = true; menu = new AbortController();
    const mine = menu; menuTimer = timers.setTimeout(() => mine.abort(), 15000);
    void expandHostedSources([original], { fetcher, signal: mine.signal }).then(options => {
      if (!stopped && !mine.signal.aborted && !options.some(option => option.error)) onSources(options);
    }).finally(() => { timers.clearTimeout(menuTimer); });
  };
  const failed = () => { if (!stopped) retry(); };
  const stalled = () => {
    timers.clearTimeout(watchdog);
    watchdog = timers.setTimeout(() => { if (!stopped && !video.paused) failed(); }, 8000);
  };
  const progressing = () => { timers.clearTimeout(watchdog); watchdog = null; };
  video.addEventListener('playing', playing); video.addEventListener('timeupdate', progressing);
  video.addEventListener('error', failed); video.addEventListener('waiting', stalled); video.addEventListener('stalled', stalled);
  function cleanup() {
    stopped = true; request?.abort(); menu?.abort(); clearRefresh(); timers.clearTimeout(menuTimer); timers.clearTimeout(watchdog); destroyEngine();
    for (const [name, listener] of [['playing', playing], ['timeupdate', progressing], ['error', failed], ['waiting', stalled], ['stalled', stalled]]) video.removeEventListener(name, listener);
  }
  onStatus('Conectando con la primera señal disponible…'); void refresh(); return cleanup;
}
