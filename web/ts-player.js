import { autoplay } from './autoplay.js';
/** HTTPS transport for public HTTP IPTV streams using the owner's hosting. */
export const TS_RELAY = 'https://calamarmenciano.com/calamar-tv-relay.php?stream=1';

export function tsRequest(address, relay = false) {
  if (!relay) return { url: address, headers: {} };
  // A header keeps path credentials out of the relay's URL and standard access logs.
  const bytes = new TextEncoder().encode(address);
  return { url: TS_RELAY, headers: { 'X-Calamar-Source': btoa(String.fromCharCode(...bytes)) } };
}

export function videoFailure(error) {
  const code = Number(error?.code) || 0;
  if (code === 1) return null; // Intentional aborts while replacing a MediaSource are not failures.
  return { details: code === 2 ? 'mediaNetworkError' : code === 3 ? 'mediaDecodeError'
    : code === 4 ? 'codecUnsupported' : 'mediaElementError', mediaCode: code,
    response: { code: 0 } };
}

export function mountTs({ library, video, address, relay = false, onFailure, onPlaying,
  onRecovering, timers = globalThis }) {
  if (!library?.getFeatureList().mseLivePlayback) {
    onFailure({ details: 'codecUnsupported' });
    return () => {};
  }
  let current = null, timer = null, active = true, serial = 0, retries = 0, wantsPlay = true;
  // Once the channel has played, a cut is never final: it reconnects (1.5 s, 3 s, 6 s, then every 10 s)
  // until the viewer leaves. Before that, two tries, so a dead link moves on to the next one.
  let played = false, watch = null, lastTime = -1, still = 0;
  const clear = () => {
    timers.clearTimeout(timer);
    timer = null;
    serial++;
    const old = current;
    current = null; // Teardown may synchronously emit pause/error callbacks.
    if (old) { old.pause(); old.destroy(); }
  };
  const fail = (request, network, data) => {
    if (!active || request !== serial || !current) return;
    if (network && (played || retries < 2)) {
      const wait = Math.min(10000, 1500 * 2 ** Math.min(retries++, 3));
      clear();
      onRecovering?.();
      timer = timers.setTimeout(start, wait);
      return;
    }
    clear();
    onFailure(data);
  };
  const start = () => {
    if (!active) return;
    clear();
    const request = serial;
    const source = tsRequest(address, relay);
    try {
      const player = library.createPlayer({ type: 'mpegts', isLive: true, url: source.url }, {
        enableWorker: false, enableStashBuffer: false, lazyLoad: false,
        headers: source.headers,
      });
      current = player;
      player.on(library.Events.ERROR, (type, detail, info) => {
        // Some TS signals overflow the browser demuxer's parser. Reconnecting to the same
        // bytes cannot fix that: let the caller request the hosting's compatible HLS instead.
        const parserFailure = detail === 'Exception' && /call stack size exceeded/i.test(info?.msg || '');
        const network = !parserFailure && (type === library.ErrorTypes?.NETWORK_ERROR || /network/i.test(type));
        fail(request, network, { details: network ? 'fragLoadError' : 'codecUnsupported',
          response: { code: Number.isInteger(info?.code) ? info.code : 0 } });
      });
      player.on(library.Events.LOADING_COMPLETE, () => {
        if (!active || request !== serial) return;
        const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : video.currentTime;
        timer = timers.setTimeout(start, Math.max(250, (end - video.currentTime - 0.5) * 1000));
      });
      player.attachMediaElement(video);
      player.load();
      if (wantsPlay) autoplay(video, () => player.play()).catch(() => {});
    } catch {
      if (active && request === serial) {
        clear();
        onFailure({ details: 'codecUnsupported' });
      }
    }
  };
  // A picture frozen 20 s with no error (the connection hangs open) also reconnects.
  const check = () => {
    if (!active) return;
    if (wantsPlay && current && !video.paused && video.currentTime === lastTime) still++;
    else still = 0;
    lastTime = video.currentTime;
    if (still >= 4) { still = 0; onRecovering?.(); start(); }
    watch = timers.setTimeout(check, 5000);
  };
  const playing = () => {
    if (!active) return;
    retries = 0; wantsPlay = true;
    if (!played) { played = true; watch = timers.setTimeout(check, 5000); }
    onPlaying?.();
  };
  const play = () => { if (active) wantsPlay = true; };
  const pause = () => {
    if (active && current && !video.ended && !video.error && video.readyState >= 2) wantsPlay = false;
  };
  const mediaError = () => {
    if (!active || !current || !video.error) return;
    const data = videoFailure(video.error);
    if (!data) return;
    const request = serial;
    // Let the engine process the same event first; its retries invalidate this callback.
    queueMicrotask(() => fail(request, data.mediaCode === 2, data));
  };
  for (const [name, listener] of [['playing', playing], ['play', play], ['pause', pause], ['error', mediaError]]) {
    video.addEventListener(name, listener);
  }
  start();
  return () => {
    active = false;
    timers.clearTimeout(watch);
    clear();
    for (const [name, listener] of [['playing', playing], ['play', play], ['pause', pause], ['error', mediaError]]) {
      video.removeEventListener(name, listener);
    }
  };
}
