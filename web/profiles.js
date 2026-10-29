// Accounts and profiles, as in Netflix: one account (Google or email and password) with up to five
// profiles, each with its own «Continuar viendo», «Mi lista», likes and favourite channels. Without an
// account everything stays in this browser, as a guest profile. The main profile keeps the original
// «Continuar viendo» of the account (calamarProgress/<uid>), the one the app shows.
import { setProgressScope } from './library.js';
import { setProgressProfile } from './progress-sync.js';

export const MAX_PROFILES = 5;
export const PROFILE_COLORS = ['#e50914', '#f5a623', '#2ea043', '#1f6feb', '#a371f7', '#db61a2'];
export const emptyData = () => ({ list: {}, ratings: {}, favorites: {}, watched: {}, updatedAt: 0 });
export const WATCHED_LIMIT = 200;
export const titleKey = (page, item) => `${page}/${item}`;

/** A new profile with a short id the rules accept («main» for the first one). */
export function newProfile(profiles, name, color, random = Math.random) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) throw Error('Escribe un nombre para el perfil.');
  if (profiles.length >= MAX_PROFILES) throw Error(`Cada cuenta puede tener hasta ${MAX_PROFILES} perfiles.`);
  if (profiles.some((p) => p.name.toLocaleLowerCase('es') === clean.toLocaleLowerCase('es'))) throw Error('Ya hay un perfil con ese nombre.');
  let id = profiles.length ? '' : 'main';
  while (!id || profiles.some((p) => p.id === id)) id = `p${Math.floor(random() * 36 ** 6).toString(36)}`;
  return { id, name: clean, color: PROFILE_COLORS.includes(color) ? color : PROFILE_COLORS[profiles.length % PROFILE_COLORS.length] };
}

/** «Mi lista»: added (with when) or taken out. */
export function toggleList(data, page, item, now = Date.now()) {
  const list = { ...data.list }, key = titleKey(page, item);
  if (list[key]) delete list[key]; else list[key] = { page, item, at: now };
  return { ...data, list, updatedAt: now };
}
/** 1 «Me gusta», -1 «No me gusta»; the same again clears it. */
export function rate(data, page, item, value, now = Date.now()) {
  const ratings = { ...data.ratings }, key = titleKey(page, item);
  if (ratings[key]?.value === value || !value) delete ratings[key]; else ratings[key] = { page, item, value, at: now };
  return { ...data, ratings, updatedAt: now };
}
export function toggleFavorite(data, channel, now = Date.now()) {
  const favorites = { ...data.favorites };
  if (favorites[channel]) delete favorites[channel]; else favorites[channel] = { at: now };
  return { ...data, favorites, updatedAt: now };
}
/** What the profile has played (one entry per film or series, the latest 200), for «Recomendado para ti». */
export function markWatched(data, page, item, now = Date.now()) {
  const watched = { ...(data.watched || {}), [titleKey(page, item)]: { page, item, at: now } };
  for (const old of Object.entries(watched).sort((a, b) => b[1].at - a[1].at).slice(WATCHED_LIMIT)) delete watched[old[0]];
  return { ...data, watched, updatedAt: now };
}
export const watchedEntries = (data) => Object.values(data?.watched || {}).sort((a, b) => b.at - a.at);
export const listEntries = (data) => Object.values(data?.list || {}).sort((a, b) => b.at - a.at);
/** The title liked last, for «Porque te gustó…». */
export const lastLiked = (data) => Object.values(data?.ratings || {}).filter((r) => r.value > 0).sort((a, b) => b.at - a.at)[0] || null;
/** The copy changed last wins (this browser's or the account's). */
export const newerData = (a, b) => ((b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a) || emptyData();
const validData = (value) => (value && typeof value === 'object' ? { ...emptyData(), ...value } : emptyData());

// ---- This browser ---------------------------------------------------------------------------------
let firebase = null, user = null, account = null, activeId = null, data = emptyData(), saveTimer = null;
const listeners = new Set();
const changed = () => { for (const listener of listeners) listener(); };
const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const dataKey = () => (user && activeId ? `calamar-profile-data:${user.uid}:${activeId}` : 'calamar-profile-data:guest');
// The account's profiles are remembered in this browser, so «Elige tu perfil» shows at once when the web
// opens, before Firebase confirms the sign-in (a second later); the account's own copy then replaces them.
const ACCOUNT_CACHE = 'calamar-account-cache';
let cachedUid = null, early = null;
const uidNow = () => user?.uid || cachedUid;
const activeKey = () => `calamar-profile:${uidNow()}`;

export const onProfilesChanged = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const signedUser = () => user || (cachedUid ? { uid: cachedUid, pending: true } : null);
export const accountProfiles = () => account?.profiles || [];
export const activeProfile = () => accountProfiles().find((p) => p.id === activeId) || null;
export const profileData = () => data;
/** Signed in but no profile chosen yet in this browser: «¿Quién está viendo?». */
export const needsProfile = () => !!signedUser() && !!account && !activeProfile();

async function loadData() {
  const local = validData(read(dataKey()));
  data = local;
  changed();
  if (!user || !activeId) return;
  const id = activeId;
  const cloud = await firebase.readProfileData(id).catch(() => null);
  if (id !== activeId) return;
  data = newerData(local, cloud && validData(cloud));
  write(dataKey(), data);
  if (!cloud || local.updatedAt > (cloud.updatedAt || 0)) saveSoon(0);
  changed();
}

function saveSoon(delay = 2000) {
  write(dataKey(), data);
  if (!user || !activeId) return;
  clearTimeout(saveTimer);
  const id = activeId, snapshot = data;
  saveTimer = setTimeout(() => firebase.writeProfileData(id, snapshot).catch(() => {}), delay);
}
function update(next) { data = next; saveSoon(); changed(); }

/** Chosen in this visit already: «Elige tu perfil» is shown once each time the web is opened. */
const pickedKey = () => `calamar-profile-picked:${uidNow()}`;
export const pickedThisVisit = () => { try { return sessionStorage.getItem(pickedKey()) === '1'; } catch { return true; } };
/** `picked`: chosen by the person in «Elige tu perfil» (not restored from the last visit). */
export async function chooseProfile(id, picked = true) {
  if (!accountProfiles().some((p) => p.id === id)) return;
  if (picked) try { sessionStorage.setItem(pickedKey(), '1'); } catch {}
  activeId = id;
  write(activeKey(), id);
  // Chosen before Firebase confirmed the sign-in: its data loads once it does.
  if (!user) { early = id; changed(); return; }
  setProgressScope(id === 'main' ? '' : `${user.uid}:${id}`);
  await setProgressProfile(id);
  await loadData();
}

async function saveAccount(next) {
  await firebase.writeAccount(next);
  account = next;
  if (user) write(ACCOUNT_CACHE, { uid: user.uid, profiles: next.profiles });
  changed();
}
export async function addProfile(name, color) {
  const profile = newProfile(accountProfiles(), name, color);
  await saveAccount({ ...account, profiles: [...accountProfiles(), profile] });
  return profile;
}
export async function editProfile(id, name, color) {
  const others = accountProfiles().filter((p) => p.id !== id);
  const edited = { ...newProfile(others, name, color), id };
  await saveAccount({ ...account, profiles: accountProfiles().map((p) => (p.id === id ? edited : p)) });
}
export async function removeProfile(id) {
  if (id === 'main') throw Error('El perfil principal no se puede borrar.');
  await saveAccount({ ...account, profiles: accountProfiles().filter((p) => p.id !== id) });
  await firebase.deleteProfileData(id);
  if (activeId === id) await chooseProfile('main', false);
}

export const toggleMyList = (page, item) => update(toggleList(data, page, item));
export const rateTitle = (page, item, value) => update(rate(data, page, item, value));
export const toggleFavoriteChannel = (channel) => update(toggleFavorite(data, channel));
export const rememberWatched = (page, item) => update(markWatched(data, page, item));
export const inMyList = (page, item) => !!data.list[titleKey(page, item)];
export const ratingOf = (page, item) => data.ratings[titleKey(page, item)]?.value || 0;
export const isFavorite = (channel) => !!data.favorites[channel];

/** Follows the sign-in: the account's profiles, the one chosen in this browser and its data. */
export function startProfiles(shared) {
  const cached = read(ACCOUNT_CACHE);
  if (cached?.uid && Array.isArray(cached.profiles) && cached.profiles.length) { cachedUid = cached.uid; account = { profiles: cached.profiles }; }
  loadData();
  shared().then((f) => {
    firebase = f;
    f.watchAuth(async (signed) => {
      user = signed || null;
      const remembered = cachedUid;
      cachedUid = null;
      setProgressScope('');
      if (!user) {
        account = null; activeId = null; early = null;
        try { localStorage.removeItem(ACCOUNT_CACHE); } catch {}
        await setProgressProfile('main'); await loadData(); return;
      }
      let fresh = await f.readAccount().catch(() => null);
      if (!fresh?.profiles?.length) {
        const first = newProfile([], String(user.displayName || user.email || 'Yo').split(/[\s@]/)[0] || 'Yo', PROFILE_COLORS[0]);
        fresh = { profiles: [first] };
        await f.writeAccount(fresh).catch(() => {});
      }
      account = fresh;
      write(ACCOUNT_CACHE, { uid: user.uid, profiles: fresh.profiles });
      const wanted = early && remembered === user.uid ? early : read(activeKey());
      early = null; activeId = null;
      if (accountProfiles().some((p) => p.id === wanted)) await chooseProfile(wanted, false);
      else if (accountProfiles().length === 1) await chooseProfile(accountProfiles()[0].id, false);
      else changed();
    });
  }).catch(() => {});
}
