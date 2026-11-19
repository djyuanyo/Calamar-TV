import { externalizeImages, imageRequest } from './github-images.js';
import { firebaseConfig } from './firebase-config.js';
import { ADMIN_EMAIL, CATALOG_PATH, validateCatalog } from './shared-catalog.js';
import { AUDIENCE_PATH, VISITS_PATH, presence, liveBeats, liveFrom, minuteOf } from './audience.js';
import { DEVICE_LOGIN_PATH } from './device-login.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, setDoc, deleteDoc, increment, collection, query, where, documentId, getDocs, getCountFromServer } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);
const catalog = doc(db, CATALOG_PATH);
export const ready = auth.authStateReady();
export const administrator = (user = auth.currentUser) => !!user && user.email === ADMIN_EMAIL && user.emailVerified && user.providerData.some((p) => p.providerId === 'google.com');
export const watchAuth = (changed) => onAuthStateChanged(auth, changed);
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
  const user = auth.currentUser;
  if (!user) return null;
  return readJson(progressDoc(user, profile), { entries: {}, removed: {} });
}
export async function writeCloudProgress(data, profile = 'main') {
  const user = auth.currentUser;
  if (!user) return;
  await setDoc(progressDoc(user, profile), { json: JSON.stringify(data), updatedAt: serverTimestamp() });
}

// ---- Accounts and profiles: calamarUsers/<uid> (the profiles) and .../profiles/<id> (My list, likes, favourites) ----
export const currentUser = () => auth.currentUser;
/** Any Google account (the admin page asks for the administrator's own). */
export function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}
export async function registerEmail(email, password, name) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(result.user, { displayName: name });
  return result;
}
export const loginEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export async function readAccount() {
  const user = auth.currentUser;
  return user ? readJson(doc(db, USERS_PATH, user.uid), null) : null;
}
export async function writeAccount(data) {
  const user = auth.currentUser;
  if (user) await setDoc(doc(db, USERS_PATH, user.uid), { json: JSON.stringify(data), updatedAt: serverTimestamp() });
}
export async function readProfileData(profile) {
  const user = auth.currentUser;
  return user ? readJson(doc(db, USERS_PATH, user.uid, 'profiles', profile), null) : null;
}
export async function writeProfileData(profile, data) {
  const user = auth.currentUser;
  if (user) await setDoc(doc(db, USERS_PATH, user.uid, 'profiles', profile), { json: JSON.stringify(data), updatedAt: serverTimestamp() });
}
export async function deleteProfileData(profile) {
  const user = auth.currentUser;
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
