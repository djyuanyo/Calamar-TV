import { streamExpiry, renewablePage, PLAYER_ENDPOINT, PLAYER_ALTERNATE_ENDPOINT, playerEndpoint } from './catalog.js';
import { hostedRequest, hostedUrl, expandHostedSources } from './hosted-sources.js';
import { autoplay } from './autoplay.js';
import { watchPlaybackStall } from './playback-stall.js';
import { zicoChannelPlayer } from './zico-channel.js';
import { hlsContinuity } from './hls-continuity.js';

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
        if (!s || s.locked || s.off || s.hidden || typeof s.url !== 'string') continue;
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
    const u = new URL(address), page = u.searchParams.get('page');
    if (playerEndpoint(address) && renewablePage(page)) return page;
  } catch { /* Not a hosting choice. */ }
  return null;
}

/** Use the 2.20.67 device route, with signed hosting as an independent fallback. */
export function mountRenewable({ page, video, Hls, onAttach = () => {}, onStatus = () => {}, onFallback = () => {}, onSources = null,
  fetcher = globalThis.fetch, timers = globalThis, now = Date.now, preferDirect = true }) {
  const original = hostedPage(page);
  let stopped = false, request = null, menu = null, menuTimer = null, refreshTimer = null, engine = null;
  let address = '', failures = 0, loaded = false, recovering = false, menuStarted = false, deviceRoute = false, continuity = null;
  const selected = new URL(original && !renewablePage(page) ? page : hostedRequest(original || ''));
  selected.searchParams.set('cast', '1');
  const automatic = !selected.searchParams.has('src') && !selected.searchParams.has('source_id');
  let alternateHosting = selected.hostname === 'www.calamarmenciano.com';
  deviceRoute = preferDirect && automatic;
  const clearRefresh = () => { timers.clearTimeout(refreshTimer); refreshTimer = null; };
  const schedule = delay => { clearRefresh(); refreshTimer = timers.setTimeout(() => { void refresh(); }, delay); };
  const destroyEngine = () => { if (engine) engine.destroy(); engine = null; onAttach(null); };
  const retry = (networkFailure = false) => {
    if (stopped || recovering) return;
    if (!request && networkFailure && !deviceRoute && !alternateHosting) alternateHosting = true;
    else if (!request && automatic && networkFailure) deviceRoute = !deviceRoute;
    failures++; recovering = true;
    onStatus('Probando otra señal disponible…');
    // Initial source failures switch promptly. Backoff only protects a continuing provider outage.
    if (!request) schedule(failures <= 3 ? 250 : Math.min(10000, 1000 * 2 ** Math.min(failures - 3, 4)));
  };
  const install = url => {
    const shouldPlay = !loaded || !video.paused;
    loaded = true; destroyEngine(); address = url;
    continuity = hlsContinuity(url);
    if (Hls?.isSupported()) {
      const session = continuity;
      const instance = engine = new Hls({ lowLatencyMode: false, maxBufferLength: 30,
        xhrSetup(xhr, uri) { const next = session.resolve(uri); if (next !== uri) xhr.open('GET', next, true); },
        manifestLoadingTimeOut: 30000, levelLoadingTimeOut: 30000, fragLoadingTimeOut: 45000 });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        const networkFailure = data.response?.code === 0 || (!data.response?.code && data.type === 'networkError');
        if (!stopped && engine === instance && (data.fatal || [401, 403].includes(data.response?.code))) retry(networkFailure);
      });
      for (const name of ['MANIFEST_LOADED', 'LEVEL_LOADED', 'FRAG_LOADED']) if (Hls.Events[name])
        instance.on(Hls.Events[name], () => { if (engine === instance) watch.download(); });
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
      if (alternateHosting) target.hostname = new URL(PLAYER_ALTERNATE_ENDPOINT).hostname;
      if (automatic && failures) target.searchParams.set('intento', String(Math.min(9, failures)));
      let url;
      if (deviceRoute && automatic) {
        const player = zicoChannelPlayer(original) || original;
        const response = await fetcher(player, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw Error(`Proveedor HTTP ${response.status}`);
        const sources = pageSources(await response.text(), response.url || player).filter(url => !streamExpiry(url) || streamExpiry(url) > now());
        if (!sources.length) throw Error('No hay señales públicas disponibles.');
        let index = sources.findIndex(url => address && new URL(url).host === new URL(address).host);
        if (recovering && index >= 0) index = (index + 1) % sources.length;
        url = sources[Math.max(0, index)];
      } else {
        let response;
        try { response = await fetcher(target.href, { cache: 'no-store', credentials: 'omit', signal: controller.signal }); }
        catch (error) {
          // A network failure is different from a rejected or invalid hosting response.
          if (!stopped && (error instanceof TypeError || error.name === 'AbortError')) {
            if (!alternateHosting) alternateHosting = true;
            else if (automatic) deviceRoute = true;
          }
          throw error;
        }
        const data = await response.json();
        if (!response.ok) throw Error(data.error || `Hosting HTTP ${response.status}`);
        url = hostedUrl(data.url, target.href);
      }
      if (stopped || controller.signal.aborted) return;
      if (!loaded || recovering) install(url);
      else if (url !== address) {
        // Metadata refreshes must never replace a healthy decoder or discard its buffer.
        if (engine) {
          const playlist = await fetcher(url, {cache:'no-store',credentials:'omit',signal:controller.signal});
          if (!playlist.ok) throw Error('No se pudo renovar la lista HLS.');
          const text = await playlist.text();
          if (stopped || controller.signal.aborted) return;
          if (continuity.update(url, text)) address = url;
          else { schedule(30000); return; } // A different CDN is a standby, not an automatic channel switch.
        } else { schedule(30000); return; } // Native browser HLS keeps playing until actual recovery is needed.
      }
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
      if (loaded && !recovering) { schedule(15000); return; }
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
  const watch = watchPlaybackStall(video, failed, { timers });
  video.addEventListener('playing', playing);
  video.addEventListener('error', failed);
  function cleanup() {
    stopped = true; request?.abort(); menu?.abort(); clearRefresh(); timers.clearTimeout(menuTimer); watch.stop(); destroyEngine();
    video.removeEventListener('playing', playing);
    video.removeEventListener('error', failed);
  }
  onStatus('Conectando con la primera señal disponible…'); void refresh(); return cleanup;
}
