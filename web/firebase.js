import { externalizeImages, imageRequest } from './github-images.js';
import { firebaseConfig } from './firebase-config.js';
import { ADMIN_EMAIL, CATALOG_PATH, validateCatalog } from './shared-catalog.js';
import { AUDIENCE_PATH, VISITS_PATH, presence, liveBeats, liveFrom, minuteOf } from './audience.js';
import { DEVICE_LOGIN_PATH } from './device-login.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, setDoc, deleteDoc, increment, collection, query, where, documentId, getDocs, getCountFromServer, writeBatch, orderBy, limit, startAfter } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);
const catalog = doc(db, CATALOG_PATH);
export const ready = auth.authStateReady();
export const administrator = (user = auth.currentUser) => !!user && user.email === ADMIN_EMAIL && user.emailVerified && user.providerData.some((p) => p.providerId === 'google.com');
const verifiedUser = user => user?.emailVerified === true ? user : null;
export const currentUser = () => verifiedUser(auth.currentUser);
export const watchAuth = (changed) => {
  let previous;
  return onAuthStateChanged(auth, user => {
    const next = verifiedUser(user);
    if (next !== previous) { previous = next; changed(next); }
  });
};
// «Continuar viendo» of the signed-in account (calamarProgress/<uid>), the same document the app uses.
export const PROGRESS_PATH = 'calamarProgress';
// The main profile keeps it there (the app reads it); every other profile in calamarUsers/<uid>/progress/<profile>.
export const USERS_PATH = 'calamarUsers';
const progressDoc = (user, profile) => (!profile || profile === 'main' ? doc(db, PROGRESS_PATH, user.uid) : doc(db, USERS_PATH, user.uid, 'progress', profile));
const readJson = async (ref, fallback) => {
  const snapshot = await getDocFromServer(ref);
  if (!snapshot.exists()) return fallback;
  try { return JSON.parse(snapshot.data().json); } catch { return fallback; }
};
export async function readCloudProgress(profile = 'main') {
  const user = currentUser();
  if (!user) return null;
  return readJson(progressDoc(user, profile), { entries: {}, removed: {} });
}
export async function writeCloudProgress(data, profile = 'main') {
  const user = currentUser();
  if (!user) return;
  await setDoc(progressDoc(user, profile), { json: JSON.stringify(data), updatedAt: serverTimestamp() });
}

// ---- Accounts and profiles: calamarUsers/<uid> (the profiles) and .../profiles/<id> (My list, likes, favourites) ----
/** Any Google account (the admin page asks for the administrator's own). */
export function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}
export async function registerEmail(email, password, name) {
  auth.languageCode = 'es';
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  try {
    if (name) await updateProfile(user, { displayName: name }).catch(() => {});
    // Start recording the pending member while their temporary sign-in is still valid.
    const member = recordMember().catch(() => {});
    const sent = await sendEmailVerification(user).then(() => true, () => false);
    await member;
    return { verification: true, sent };
  } finally {
    if (auth.currentUser?.uid === user.uid) await signOut(auth);
  }
}
export async function loginEmail(email, password, resend = false) {
  auth.languageCode = 'es';
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  if (verifiedUser(user)) return { verification: false };
  try {
    if (resend) await sendEmailVerification(user);
    return { verification: true, sent: resend };
  } finally {
    if (auth.currentUser?.uid === user.uid) await signOut(auth);
  }
}
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export async function readAccount() {
  const user = currentUser();
  return user ? readJson(doc(db, USERS_PATH, user.uid), null) : null;
}
export async function writeAccount(data) {
  const user = currentUser();
  if (user) await setDoc(doc(db, USERS_PATH, user.uid), { json: JSON.stringify(data), updatedAt: serverTimestamp() });
}
export async function readProfileData(profile) {
  const user = currentUser();
  return user ? readJson(doc(db, USERS_PATH, user.uid, 'profiles', profile), null) : null;
}
export async function writeProfileData(profile, data) {
  const user = currentUser();
  if (user) await setDoc(doc(db, USERS_PATH, user.uid, 'profiles', profile), { json: JSON.stringify(data), updatedAt: serverTimestamp() });
}
export async function deleteProfileData(profile) {
  const user = currentUser();
  if (!user) return;
  await deleteDoc(doc(db, USERS_PATH, user.uid, 'profiles', profile)).catch(() => {});
  await deleteDoc(doc(db, USERS_PATH, user.uid, 'progress', profile)).catch(() => {});
}
export const logout = () => signOut(auth);
/**
 * Signs in with Google again to hand the session to an app: the Google ID token goes to
 * calamarDeviceLogins/<key><code>, which the app reads once the code is typed there.
 */
export async function publishDeviceLogin(id) {
  // Any Google account: the app signs in with it (its profiles, its list…), the administrator's too.
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
  if (!idToken) throw new Error('Google no ha devuelto la sesión. Vuelve a intentarlo.');
  await setDoc(doc(db, DEVICE_LOGIN_PATH, id), { idToken, createdAt: serverTimestamp() });
}
/** Calls back with false once the app has used (deleted) the sign-in. */
export const watchDeviceLogin = (id, changed) => onSnapshot(doc(db, DEVICE_LOGIN_PATH, id), (s) => changed(s.exists()), () => changed(null));
export const cancelDeviceLogin = (id) => deleteDoc(doc(db, DEVICE_LOGIN_PATH, id)).catch(() => {});
export function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', login_hint: ADMIN_EMAIL });
  return signInWithPopup(auth, provider);
}
function unpack(snapshot, fallback) {
  if (!snapshot.exists()) return { data: structuredClone(fallback), revision: 0 };
  const value = snapshot.data();
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('Revisión del catálogo no válida.');
  return { data: validateCatalog(JSON.parse(value.json)), revision: value.revision };
}
let migratedImages;
async function imageManifest() {
  if (!migratedImages) migratedImages = fetch(new URL('./images/manifest.json', import.meta.url), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw Error(); return r.json(); }).catch(() => ({}));
  return migratedImages;
}
export async function readCatalog(fallback) {
  const result = unpack(await getDocFromServer(catalog), fallback);
  result.data = await externalizeImages(result.data, { known: await imageManifest() });
  return result;
}
export async function imageService() { return imageRequest(); }
export async function connectImageService(githubToken) {
  if (!administrator()) throw new Error('Entra con la cuenta de administrador.');
  return imageRequest({ action: 'configure', token: githubToken }, await auth.currentUser.getIdToken());
}
export function watchCatalog(fallback, changed, failed) {
  return onSnapshot(catalog, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return;
    try { changed(unpack(snapshot, fallback)); } catch (error) { failed(error); }
  }, failed);
}
export async function publishCatalog(data, expectedRevision) {
  if (!administrator()) throw new Error('Entra con la cuenta de administrador de Google.');
  validateCatalog(data, { checkSize: false });
  const prepared = await externalizeImages(data, { known: await imageManifest(),
    upload: async image => imageRequest({ action: 'upload', image }, await auth.currentUser.getIdToken()) });
  const json = JSON.stringify(validateCatalog(prepared));
  await runTransaction(db, async (tx) => {
    const current = await tx.get(catalog);
    const revision = current.exists() ? current.data().revision : 0;
    if (revision !== expectedRevision) throw new Error('El catálogo cambió en otro dispositivo. Se ha recargado; vuelve a aplicar el cambio.');
    tx.set(catalog, { json, revision: revision + 1, updatedAt: serverTimestamp() });
  });
  Object.assign(data, prepared);
  return expectedRevision + 1;
}

// ---- Films, series and documentaries ----------------------------------------------------------------
// Settings (TMDB key, Drive folders) are private to the administrator; the library is public, in parts.
const librarySettings = doc(db, 'calamarPrivate', 'library');
export async function readLibrarySettings() {
  if (!administrator()) throw new Error('Entra con la cuenta de administrador.');
  const snapshot = await getDocFromServer(librarySettings);
  return snapshot.exists() ? snapshot.data() : {};
}
export async function saveLibrarySettings(settings) {
  if (!administrator()) throw new Error('Entra con la cuenta de administrador.');
  await setDoc(librarySettings, settings);
}
/** Writes the parts and then the index that names them; parts of an older, longer library are removed. */
export async function publishLibraryParts({ index, parts }) {
  if (!administrator()) throw new Error('Entra con la cuenta de administrador.');
  const indexRef = doc(db, 'calamarLibrary', 'index');
  const before = await getDocFromServer(indexRef).then((s) => s.exists() ? JSON.parse(s.data().json) : null).catch(() => null);
  for (const [name, part] of Object.entries(parts)) await setDoc(doc(db, 'calamarLibrary', name), { json: JSON.stringify(part), updatedAt: serverTimestamp() });
  await setDoc(indexRef, { json: JSON.stringify(index), updatedAt: serverTimestamp() });
  for (const [section, count] of Object.entries(before?.sections || {})) {
    for (let n = index.sections[section] ?? 0; n < count; n++) await deleteDoc(doc(db, 'calamarLibrary', `${section}-${n}`)).catch(() => {});
  }
}

// ---- Audience ---------------------------------------------------------------------------------
export const beat = (session, target) => setDoc(doc(db, AUDIENCE_PATH, session), { ...presence(target), updatedAt: serverTimestamp() });
export const leave = (session) => deleteDoc(doc(db, AUDIENCE_PATH, session));
export async function viewers(target) {
  const snapshot = await getCountFromServer(query(collection(db, AUDIENCE_PATH), where('beat', 'in', liveBeats(target))));
  return snapshot.data().count;
}
/** Viewers of several channels or events: one count each (one read), never every presence document. */
export async function viewersOf(targets) {
  const counts = await Promise.all(targets.map((target) => viewers(target)));
  return new Map(targets.map((target, i) => [target, counts[i]]));
}
/** Every presence seen in the last minutes (one read each); only the admin panel groups them all. */
export async function audience() {
  const snapshot = await getDocs(query(collection(db, AUDIENCE_PATH), where('minute', '>=', liveFrom())));
  return snapshot.docs.map((d) => d.data());
}
/** Presence left behind by closed tabs; removing it keeps the collection small. */
export async function purgeAudience() {
  const snapshot = await getDocs(query(collection(db, AUDIENCE_PATH), where('minute', '<', minuteOf() - 10)));
  await Promise.all(snapshot.docs.map((d) => deleteDoc(d.ref)));
  if (administrator()) {
    const expired = await getDocs(query(collection(db, 'calamarLiveViewers'),
      where('updatedAt', '<', new Date(Date.now() - 15 * 60000)), limit(100)));
    await Promise.all(expired.docs.map(d => deleteDoc(d.ref)));
  }
}
export const recordVisit = (day, key) => setDoc(doc(db, VISITS_PATH, day), { last: key, [key]: increment(1) }, { merge: true });
/** Daily visit documents between two YYYY-MM-DD days, both included. */
export async function visits(from, to) {
  const snapshot = await getDocs(query(collection(db, VISITS_PATH), where(documentId(), '>=', from), where(documentId(), '<=', to)));
  return snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
}

export function explain(error) {
  const messages = {
    'auth/popup-closed-by-user': 'Has cerrado la ventana de Google. Puedes volver a entrar.',
    'auth/popup-blocked': 'Permite las ventanas emergentes para acceder con Google.',
    'auth/unauthorized-domain': 'Este dominio todavía no está autorizado para acceder con Google.',
    'auth/invalid-email': 'Ese correo no es válido.',
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/wrong-password': 'El correo o la contraseña no son correctos.',
    'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
    'auth/email-already-in-use': 'Ya hay una cuenta con ese correo. Entra con él o recupera la contraseña.',
    'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
    'auth/operation-not-allowed': 'El acceso con correo y contraseña todavía no está activado en Firebase.',
    'auth/missing-password': 'Escribe la contraseña.',
    'permission-denied': 'Esta cuenta no tiene permiso para administrar los canales.',
    'unavailable': 'No se pudo conectar con el catálogo. Comprueba la conexión y vuelve a intentarlo.',
  };
  return messages[error.code] || error.message || 'No se pudo completar la operación.';
}

// ---- Optional website sign-in and administrator's user directory -------------------------------
const webAccessDoc = doc(db, 'calamarWeb', 'access');
const policy = data => ({ requireLogin: data?.requireLogin !== false });
export async function readWebAccess() {
  const s = await getDocFromServer(webAccessDoc); return policy(s.exists() ? s.data() : null);
}
export const watchWebAccess = (next, failed) => onSnapshot(webAccessDoc, { includeMetadataChanges: true }, s => {
  if (!s.metadata.fromCache && !s.metadata.hasPendingWrites) next(policy(s.exists() ? s.data() : null));
}, failed);
export async function saveWebAccess(value) {
  if (!administrator()) throw Error('Entra con la cuenta de administración.');
  await setDoc(webAccessDoc, { requireLogin: value.requireLogin === true, updatedAt: serverTimestamp() });
}
export const watchUserAccess = (uid, next, failed) => onSnapshot(doc(db, 'calamarUserAccess', uid), { includeMetadataChanges: true }, s => {
  if (!s.metadata.fromCache && !s.metadata.hasPendingWrites) next(s.exists() && s.data().blocked === true);
}, failed);
export async function recordMember() {
  const user = auth.currentUser; if (!user || user.isAnonymous) return;
  const token = await user.getIdTokenResult();
  if (auth.currentUser?.uid !== user.uid) return;
  const claims = token.claims, ref = doc(db, 'calamarMembers', user.uid);
  await runTransaction(db, async tx => {
    const before = await tx.get(ref);
    const data = { name: String(user.displayName || '').slice(0, 80), email: String(claims.email || ''), photo: String(user.photoURL || '').slice(0, 2048),
      verified: claims.email_verified === true, provider: String(claims.firebase?.sign_in_provider || ''), lastSeen: serverTimestamp() };
    const registered = Date.parse(user.metadata?.creationTime || '');
    if (Number.isFinite(registered)) data.registeredAt = new Date(registered);
    if (!before.exists()) data.createdAt = serverTimestamp();
    tx.set(ref, data, { merge: true });
  });
}
export async function readUserDirectory() {
  if (!administrator()) throw Error('Entra con la cuenta de administración.');
  const [members, profiles, access] = await Promise.all(['calamarMembers', USERS_PATH, 'calamarUserAccess'].map(path => getDocs(collection(db, path))));
  return { members: members.docs.map(s => ({ ...s.data(), uid: s.id })), profiles: profiles.docs.map(s => ({ ...s.data(), uid: s.id })), access: access.docs.map(s => ({ ...s.data(), uid: s.id })) };
}
export async function setUserBlocked(uid, blocked) {
  if (!administrator() || uid === auth.currentUser.uid) throw Error('No puedes bloquear tu propia cuenta de administración.');
  await setDoc(doc(db, 'calamarUserAccess', uid), { blocked: blocked === true, updatedAt: serverTimestamp() });
}

export async function deleteUserAccount(uid) {
  requireAdministrator();
  const admin = currentUser();
  if (!uid || uid === admin.uid) throw Error('No puedes eliminar tu propia cuenta de administración.');
  // Google checks IAM on the project. The Google access token stays in this call and goes only to Google.
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/identitytoolkit');
  provider.setCustomParameters({ login_hint: ADMIN_EMAIL });
  const result = await reauthenticateWithPopup(admin, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw Error('Google no ha autorizado la eliminación. Vuelve a intentarlo.');
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${firebaseConfig.projectId}/accounts:delete`;
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }) });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw Error('Tu cuenta de Google necesita permiso para eliminar usuarios en el proyecto de Firebase.');
    if (body?.error?.message !== 'USER_NOT_FOUND') throw Error('Firebase no pudo eliminar la cuenta. Vuelve a intentarlo.');
  }
  try {
    await setDoc(doc(db, 'calamarUserAccess', uid), { blocked: true, deleted: true, updatedAt: serverTimestamp() });
  } catch {
    await setUserBlocked(uid, true).catch(() => {});
    throw Error('Firebase eliminó la cuenta, pero el directorio no se actualizó. Publica las reglas de Firestore y vuelve a pulsar «Eliminar cuenta».');
  }
}

// ---- Private viewing history and administrator live viewers -----------------------------------
const viewingDoc = (uid, id) => doc(db, 'calamarViewing', uid, 'sessions', id);
const liveViewerDoc = id => doc(db, 'calamarLiveViewers', id);
const ownsViewing = uid => currentUser()?.uid === uid;

export async function showViewing({ uid, id, ...details }, first) {
  if (!ownsViewing(uid)) return false;
  const live = { ...details, uid, updatedAt: serverTimestamp() };
  if (first) {
    const batch = writeBatch(db);
    batch.set(viewingDoc(uid, id), { ...details, startedAt: serverTimestamp() });
    batch.set(liveViewerDoc(id), live);
    await batch.commit();
  } else await setDoc(liveViewerDoc(id), live);
  return true;
}

export async function hideViewing({ uid, id }, finished) {
  if (!ownsViewing(uid)) return;
  await Promise.all([deleteDoc(liveViewerDoc(id)), ...(finished ? [
    setDoc(viewingDoc(uid, id), { endedAt: serverTimestamp() }, { merge: true }),
  ] : [])]);
}

function requireAdministrator() {
  if (!administrator()) throw Error('Entra con la cuenta de administración.');
}

export async function readUserDetails(uid) {
  requireAdministrator();
  const [member, account, access] = await Promise.all([
    getDocFromServer(doc(db, 'calamarMembers', uid)),
    readJson(doc(db, USERS_PATH, uid), null),
    getDocFromServer(doc(db, 'calamarUserAccess', uid)),
  ]);
  const profiles = (Array.isArray(account?.profiles) ? account.profiles : [])
    .filter(p => /^[a-z0-9]{1,20}$/.test(p?.id)).slice(0, 5);
  if (access.data()?.deleted === true || (!member.exists() && !account && !access.exists())) return null;
  const favorites = await Promise.all(profiles.map(async profile => ({
    ...profile,
    data: await readJson(doc(db, USERS_PATH, uid, 'profiles', profile.id), null),
  })));
  return { ...member.data(), uid, blocked: access.data()?.blocked === true, profiles: favorites };
}

export async function readViewingHistory(uid, cursor) {
  requireAdministrator();
  const items = collection(db, 'calamarViewing', uid, 'sessions');
  const snapshot = await getDocs(query(items, orderBy('startedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(31)));
  const page = snapshot.docs.slice(0, 30);
  return { entries: page.map(d => d.data()), cursor: snapshot.size > 30 ? page.at(-1) : null };
}

export async function readLiveViewers() {
  requireAdministrator();
  const live = await getDocs(query(collection(db, 'calamarLiveViewers'), where('updatedAt', '>=', new Date(Date.now() - 5 * 60000))));
  const entries = live.docs.map(d => d.data());
  const uids = [...new Set(entries.map(entry => entry.uid))];
  const names = new Map(await Promise.all(uids.map(async uid => {
    const member = await getDocFromServer(doc(db, 'calamarMembers', uid));
    if (member.data()?.name) return [uid, member.data().name];
    const account = await readJson(doc(db, USERS_PATH, uid), null);
    return [uid, account?.profiles?.[0]?.name || ''];
  })));
  return entries.map(entry => ({ ...entry, name: names.get(entry.uid) || entry.profile || 'Usuario registrado' }));
}
