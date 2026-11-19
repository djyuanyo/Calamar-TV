import { audienceTarget, HEARTBEAT_MS, sessionId } from './audience.js';
import { activeProfile } from './profiles.js';

// This browser tab: its players (multipantalla too) count as one screen of the account.
export const SCREEN = sessionId();

/** A private record starts only when playback begins and survives pauses/source changes. */
export function viewingSession(shared, item, id = sessionId(), publicPresence = false, onLimit = null) {
  let record = null, started = false, publicStarted = false, playing = false, closed = false, checked = false, timer;
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
      profile: String(activeProfile()?.name || '').slice(0, 24), device: 'web', screen: SCREEN,
    };
    // Once per playback: the account's other screens playing, against the limit it has.
    if (!started && !checked && onLimit) {
      checked = true;
      if (await f.screenLimitReached?.(SCREEN)) {
        closed = true;
        clearInterval(timer);
        onLimit();
        return;
      }
    }
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
