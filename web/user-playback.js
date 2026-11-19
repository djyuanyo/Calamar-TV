import { audienceTarget, HEARTBEAT_MS, sessionId } from './audience.js';
import { activeProfile } from './profiles.js';

/** A private record starts only when playback begins and survives pauses/source changes. */
export function viewingSession(shared, item, id = sessionId(), publicPresence = false) {
  let record = null, started = false, publicStarted = false, playing = false, closed = false, timer;
  const target = audienceTarget(item);
  let queue = Promise.resolve();
  const write = action => {
    queue = queue.then(async () => {
      const f = await shared();
      await action(f);
    }).catch(() => {});
  };
  const beat = () => write(async f => {
    if (!playing || closed) return;
    if (publicPresence) {
      publicStarted = true;
      f.beat(id, target).catch(() => {});
    }
    const user = f.auth.currentUser;
    if (!user || user.isAnonymous) return;
    record ||= {
      uid: user.uid, id, target, title: String(item.name || '').slice(0, 250),
      profile: String(activeProfile()?.name || '').slice(0, 24), device: 'web',
    };
    if (record.uid === user.uid && await f.showViewing(record, !started)) started = true;
  });
  const hide = finished => write(async f => {
    if (publicStarted) f.leave(id).catch(() => {});
    if (started) await f.hideViewing(record, finished);
  });
  return {
    watching(value) {
      if (closed || playing === value) return;
      playing = value;
      clearInterval(timer);
      if (playing) {
        beat();
        timer = setInterval(beat, HEARTBEAT_MS);
      } else hide(false);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      hide(true);
    },
  };
}

export const viewerDevice = device => ({ web: 'Web', android: 'Android', tv: 'Android TV' })[device] || 'Dispositivo desconocido';
