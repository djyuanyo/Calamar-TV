// Who may watch: every viewer has an account (registered in calamarMembers), until the date the administrator
// sets (calamarAccess.expires; none: no end), on as many screens at a time as he allows (calamarAccess.screens;
// none: one). Each tab that plays says so every 30 seconds (calamarStreams/<uid>/sessions/<tab>); a new screen
// beyond the limit gets «Se ha superado el límite de reproducciones simultáneas». The administrator has no limits.
export const DEFAULT_SCREENS = 1;
const FRESH = 90000, BEAT = 30000;

let firebase = null, user = null, admin = false, access = null, known = false, beating = null, watching = false;
const listeners = new Set();
let answered;
// The first answer of the sign-in: a channel opened from a link before it comes waits for it.
const firstAnswer = new Promise((resolve) => { answered = resolve; });
const changed = () => { answered(); for (const listener of listeners) listener(); };
const tab = (() => {
  const letters = 'ABCDEFGHIJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 20; i++) id += letters[Math.floor(Math.random() * letters.length)];
  return id;
})();

export const onAccessChanged = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
/** The sign-in has been answered at least once (signed in or not). */
export const accessKnown = () => known;
export const accessAdmin = () => admin;
export const screenLimit = () => (admin ? Infinity : access?.screens || DEFAULT_SCREENS);
/** The day the account stopped being able to watch (ms), or null while it can. */
export function expiredSince(now = Date.now()) {
  return !admin && access?.expires && access.expires <= now ? access.expires : null;
}
export const accessExpires = () => (admin ? null : access?.expires || null);

/** «Se ha superado el límite…» with the screens watching now, or null when one more fits. */
export function limitMessage(limit, live) {
  if (live.length < limit) return null;
  const where = [...new Set(live.map((s) => s.title).filter(Boolean))].slice(0, 3).join(', ');
  return `Se ha superado el límite de reproducciones simultáneas de tu cuenta (${limit} ${limit === 1 ? 'pantalla' : 'pantallas'}).`
    + (where ? ` Ahora se está viendo: ${where}.` : '') + ' Cierra la otra reproducción y vuelve a intentarlo.';
}

export function startAccess(shared) {
  shared().then((f) => {
    firebase = f;
    f.watchAuth(async (signed) => {
      user = signed || null;
      admin = !!user && f.administrator(user);
      access = null;
      if (user) {
        f.registerMember().catch(() => {});
        access = await f.readAccess().catch(() => null);
      }
      known = true;
      changed();
    });
  }).catch(() => { known = true; changed(); });
  // A closed tab frees its screen at once (otherwise after 90 seconds).
  addEventListener('pagehide', () => { if (watching) firebase?.endSession(tab); });
}

/** Before playing: { ok } or { ok: false, reason } (expired, or no screen left). Keeps the screen until stopWatching(). */
export async function startWatching(title, profile = '') {
  await firstAnswer;
  if (!firebase || !user) return { ok: false, reason: 'Entra con tu cuenta para ver Calamar TV.' };
  if (!admin) {
    access = await firebase.readAccess().catch(() => access);
    const since = expiredSince();
    if (since) return { ok: false, reason: `Tu acceso caducó el ${new Date(since).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}. Habla con el administrador para renovarlo.` };
    const live = await firebase.liveSessions(tab, FRESH).catch(() => []);
    const blocked = limitMessage(screenLimit(), live);
    if (blocked) return { ok: false, reason: blocked };
  }
  try { await firebase.beatSession(tab, { profile, title }); }
  catch { if (!admin) return { ok: false, reason: 'No se pudo comprobar tu cuenta. Revisa la conexión y vuelve a intentarlo.' }; }
  watching = true;
  clearInterval(beating);
  beating = setInterval(() => firebase.beatSession(tab, { profile, title }).catch(() => {}), BEAT);
  return { ok: true };
}

export function stopWatching() {
  clearInterval(beating);
  beating = null;
  if (watching && firebase) firebase.endSession(tab);
  watching = false;
}
