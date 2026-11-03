/** Recover when playback stops advancing, even if the browser is still downloading data. */
export function watchPlaybackStall(video, onStall, { timers = globalThis, document = globalThis.document, delay = 30000 } = {}) {
  let timer = null;
  let position = video.currentTime;
  let started = false;
  const clear = () => {
    timers.clearTimeout(timer);
    timer = null;
  };
  const active = () => !video.paused && !video.ended && !document?.hidden;
  const arm = () => {
    if (timer !== null || !active()) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (!active()) return;
      if (video.currentTime !== position) {
        started = true;
        position = video.currentTime;
        arm();
      } else {
        onStall();
      }
    }, delay);
  };
  const sample = () => {
    if (!active()) { clear(); return; }
    if (video.currentTime !== position) {
      started = true;
      position = video.currentTime;
      clear();
    }
    arm();
  };
  const resume = () => { clear(); position = video.currentTime; arm(); };
  const playing = () => { started = true; sample(); };
  // Some hosting sources take a while to deliver the initial manifest and first segment.
  const download = () => { if (!started && timer !== null) resume(); };
  const emptied = () => { clear(); started = false; position = video.currentTime; };
  const events = [
    ['play', resume], ['playing', playing], ['waiting', sample], ['stalled', sample],
    ['timeupdate', sample], ['pause', clear], ['ended', clear], ['emptied', emptied], ['progress', download],
  ];
  for (const [name, listener] of events) video.addEventListener(name, listener);
  document?.addEventListener('visibilitychange', resume);
  arm();
  const stop = () => {
    clear();
    for (const [name, listener] of events) video.removeEventListener(name, listener);
    document?.removeEventListener('visibilitychange', resume);
  };
  return { stop, download };
}
