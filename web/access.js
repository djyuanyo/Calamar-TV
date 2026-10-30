import { DEFAULT_SCREENS, HEARTBEAT_MS, limitMessage } from './access-lease.js';
export { DEFAULT_SCREENS, limitMessage };
let firebase = null, user = null, admin = false, access = null;
let settingsKnown = false, authKnown = false, rightsKnown = false, required = true;
let stopRights = null, generation = 0, beating = null, expiryTimer = null, watching = false, claimGeneration = 0;
const listeners = new Set(), lostListeners = new Set();
let answered;
const firstAnswer = new Promise(resolve => { answered = resolve; });
const newHolder = () => {
  const id = new Uint8Array(16); crypto.getRandomValues(id);
  return Array.from(id, n => n.toString(16).padStart(2, '0')).join('');
};
let activeHolder = null, claimTail = Promise.resolve();
const changed = () => {
  if (accessKnown()) answered();
  for (const listener of listeners) listener();
};
export const accessKnown = () => settingsKnown && authKnown && rightsKnown;
export const registrationRequired = () => required;
export const playbackAllowed = () => accessKnown() && !expiredSince() && (watching || (!required && !user));
export const accessAdmin = () => admin;
export const screenLimit = () => access?.screens || DEFAULT_SCREENS;
export const accessExpires = () => access?.expires || null;
export const expiredSince = (now = Date.now()) => access?.expires && access.expires <= now ? access.expires : null;
export const onAccessChanged = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const onPlaybackAccessLost = listener => { lostListeners.add(listener); return () => lostListeners.delete(listener); };
function lose(reason) {
  const wasWatching = watching;
  stopWatching();
  if (wasWatching) for (const listener of lostListeners) listener(reason);
}
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const expires = accessExpires();
  if (!expires) return;
  const wait = expires - Date.now();
  if (wait <= 0) { lose('Tu acceso ha caducado. Habla con el administrador para renovarlo.'); return; }
  expiryTimer = setTimeout(() => { scheduleExpiry(); changed(); }, Math.min(wait, 2147483647));
}
export function startAccess(shared) {
  shared().then(f => {
    firebase = f;
    f.watchAccessSettings(value => { required = value.requireRegistration; settingsKnown = true; if (required && !user) lose('Entra con tu cuenta para ver Calamar TV.'); changed(); }, () => {
      settingsKnown = false; lose('No se pudo comprobar el acceso. Revisa la conexión.'); changed();
    });
    f.watchAuth(signed => {
      const request = ++generation;
      stopRights?.(); stopRights = null;
      if ((user?.uid || '') !== (signed?.uid || '')) lose('La cuenta ha cambiado. Vuelve a abrir el contenido.');
      user = signed || null; admin = !!user && f.administrator(user); access = null;
      authKnown = true; rightsKnown = !user;
      if (user) {
        f.registerMember().catch(() => {});
        stopRights = f.watchAccess(user.uid, rights => {
          if (request !== generation) return;
          access = rights; rightsKnown = true; scheduleExpiry(); changed();
        }, () => {
          if (request !== generation) return;
          rightsKnown = false; lose('No se pudo comprobar tu cuenta. Revisa la conexión.'); changed();
        });
      }
      scheduleExpiry(); changed();
    });
  }).catch(() => { settingsKnown = false; lose('No se pudo conectar con las cuentas.'); changed(); });
  if (typeof addEventListener !== 'undefined') addEventListener('pagehide', stopWatching);
}
/** One claim covers the actual number of players, including Multipantalla. No media starts before it succeeds. */
async function releaseActive() {
  clearInterval(beating); beating = null;
  const holder = activeHolder; activeHolder = null; watching = false;
  if (holder && firebase) await firebase.endSession(holder).catch(() => {});
}
export function startWatching(title, profile = '', count = 1) {
  const request = ++claimGeneration;
  const run = async () => {
    if (request !== claimGeneration) return { ok: false, reason: 'Reproducción cancelada.' };
    await releaseActive();
    if (!accessKnown()) await Promise.race([firstAnswer, new Promise(resolve => setTimeout(resolve, 12000))]);
    if (request !== claimGeneration) return { ok: false, reason: 'Reproducción cancelada.' };
    if (!accessKnown() || !firebase) return { ok: false, reason: 'No se pudo comprobar tu cuenta. Revisa la conexión y vuelve a intentarlo.' };
    if (!user) return required ? { ok: false, reason: 'Entra con tu cuenta para ver Calamar TV.' } : { ok: true };
    if (expiredSince()) return { ok: false, reason: 'Tu acceso ha caducado. Habla con el administrador para renovarlo.' };
    const holder = newHolder();
    try {
      await firebase.claimSessions(holder, { title, profile, count });
      if (request !== claimGeneration) { await firebase.endSession(holder); return { ok: false, reason: 'Reproducción cancelada.' }; }
    } catch (error) {
      return { ok: false, reason: error.code === 'screens-limit' ? error.message : /caducad/.test(error.message || '') ? error.message
        : 'No se pudo reservar una pantalla. Revisa la conexión y vuelve a intentarlo.' };
    }
    watching = true; activeHolder = holder;
    beating = setInterval(() => firebase.beatSession(holder).catch(() => { if (activeHolder === holder) lose('Esta reproducción ya no dispone de acceso. Revisa la caducidad y el límite de pantallas.'); }), HEARTBEAT_MS);
    scheduleExpiry();
    return { ok: true };
  };
  const result = claimTail.then(run, run); claimTail = result.catch(() => {}); return result;
}
export function stopWatching() { ++claimGeneration; return releaseActive(); }
