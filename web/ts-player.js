/** HTTPS transport for public HTTP IPTV streams using the owner's hosting. */
export const TS_RELAY = 'https://calamarmenciano.com/calamar-tv-relay.php?stream=1';

export function tsRequest(address, relay = false) {
  if (!relay) return { url: address, headers: {} };
  // A header keeps path credentials out of the relay's URL and standard access logs.
  const bytes = new TextEncoder().encode(address);
  return { url: TS_RELAY, headers: { 'X-Calamar-Source': btoa(String.fromCharCode(...bytes)) } };
}

export function mountTs({ library, video, address, relay = false, onFailure, onPlaying,
  timers = globalThis }) {
  if (!library?.getFeatureList().mseLivePlayback) {
    onFailure({ details: 'codecUnsupported' });
    return () => {};
  }
  let current = null, timer = null, active = true, serial = 0, retries = 0, first = true;
  const clear = () => {
    timers.clearTimeout(timer);
    timer = null;
    serial++;
    if (current) { current.pause(); current.destroy(); current = null; }
  };
  const start = () => {
    if (!active) return;
    const resume = first || !video.paused;
    first = false;
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
        if (!active || request !== serial) return;
        const network = type === library.ErrorTypes?.NETWORK_ERROR || /network/i.test(type);
        if (network && retries++ < 2) {
          clear();
          timer = timers.setTimeout(start, 1500);
          return;
        }
        clear();
        onFailure({ details: network ? 'fragLoadError' : 'codecUnsupported',
          response: { code: Number.isInteger(info?.code) ? info.code : 0 } });
      });
      player.on(library.Events.LOADING_COMPLETE, () => {
        if (!active || request !== serial) return;
        // The hosting caps each connection. Drain its buffer before opening the next one.
        const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : video.currentTime;
        timer = timers.setTimeout(start, Math.max(250, (end - video.currentTime - 0.5) * 1000));
      });
      player.attachMediaElement(video);
      player.load();
      if (resume) player.play()?.catch(() => {}); // Respect a user pause across relay renewal.
    } catch {
      clear();
      onFailure({ details: 'codecUnsupported' });
    }
  };
  const playing = () => { if (active) { retries = 0; onPlaying?.(); } };
  video.addEventListener('playing', playing);
  start();
  return () => { active = false; clear(); video.removeEventListener('playing', playing); };
}