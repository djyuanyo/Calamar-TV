// «Continuar viendo» on every device of the signed-in account: this browser's row (library.js) joined
// with the copy in Firestore (calamarProgress/<uid>, also written by the app) when the account signs in,
// when the home page is shown (at most every 30 s) and after each change here (15 s later, or at once
// when the page is hidden). Without an account nothing leaves the browser.
import { loadProgress, loadRemoved, saveProgress, onProgressSaved, progressToCloud, progressFromCloud, mergeProgress } from './library.js';

const PULL_EVERY = 30000, PUSH_AFTER = 15000;
let firebase = null, user = null, pulledAt = 0, pushTimer = null, busy = null, changedHere = () => {}, profile = 'main', ready = false;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Joins the two copies, keeps the result in both, and says whether this browser's row changed. */
async function sync() {
  // Only once a profile is chosen: before that this browser's row is not the account's (a guest's or another account's).
  if (!firebase || !user || !ready) return false;
  if (busy) return busy;
  busy = (async () => {
    const from = profile;
    const local = progressToCloud(loadProgress(), loadRemoved());
    const cloud = await firebase.readCloudProgress(from);
    if (from !== profile) return false; // The profile changed meanwhile: its own sync follows.
    const merged = mergeProgress(local, cloud || {});
    pulledAt = Date.now();
    const { store, removed } = progressFromCloud(merged);
    const shown = (row) => Object.keys(row).sort().map((k) => [k, row[k].at, row[k].position]);
    const changed = !same(shown(store), shown(loadProgress()));
    saveProgress(store, { quiet: true, removed });
    if (!same(merged, cloud)) await firebase.writeCloudProgress(merged, from);
    return changed;
  })().catch(() => false).finally(() => { busy = null; });
  return busy;
}

function pushSoon(delay = PUSH_AFTER) {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; sync(); }, delay);
}

/** Starts following the account: `changed` is called when another device changed the row shown here. */
export function startProgressSync(shared, changed) {
  changedHere = changed;
  onProgressSaved(() => pushSoon());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pushTimer) { clearTimeout(pushTimer); pushTimer = null; sync(); } });
  shared().then((f) => {
    firebase = f;
    // The profiles (profiles.js) say which row to follow once the account and its profile are known.
    f.watchAuth((signed) => { user = signed || null; ready = false; });
  }).catch(() => {});
}

/** On the home page: brings what other devices did (at most every 30 s). */
export async function refreshProgress() {
  if (!user || Date.now() - pulledAt < PULL_EVERY) return;
  if (await sync()) changedHere();
}

/** The profile watching was chosen (or another one): its row is read from its own copy in the cloud. */
export async function setProgressProfile(id = 'main') {
  profile = id;
  clearTimeout(pushTimer); pushTimer = null; pulledAt = 0;
  if (busy) await busy;
  ready = !!user;
  if (user && await sync()) changedHere();
}
