import { audienceTarget, HEARTBEAT_MS, sessionId } from './audience.js';
import { activeProfile } from './profiles.js';

/** A private record starts only when playback begins and survives pauses/source changes. */
export function viewingSession(shared, item, id = sessionId()) {
  let record = null, started = false, playing = false, closed = false, timer;
  let queue = Promise.resolve();
  const write = action => {
    queue = queue.then(async () => {
      const f = await shared();
      await action(f);
    }).catch(() => {});
  };
  const beat = () => write(async f => {
    if (!playing || closed) return;
    const user = f.auth.currentUser;
    if (!user || user.isAnonymous) return;
    record ||= {
      uid: user.uid, id, target: audienceTarget(item), title: String(item.name || '').slice(0, 250),
      profile: String(activeProfile()?.name || '').slice(0, 24), device: 'web',
    };
    if (record.uid === user.uid && await f.showViewing(record, !started)) started = true;
  });
  return {
    watching(value) {
      if (closed || playing === value) return;
      playing = value;
      clearInterval(timer);
      if (playing) {
        beat();
        timer = setInterval(beat, HEARTBEAT_MS);
      } else write(f => started && f.hideViewing(record, false));
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      write(f => started && f.hideViewing(record, true));
    },
  };
}

export const viewerDevice = device => ({ web: 'Web', android: 'Android', tv: 'Android TV' })[device] || 'Dispositivo desconocido';
