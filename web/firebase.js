import { firebaseConfig } from './firebase-config.js';
import { ADMIN_EMAIL, CATALOG_PATH, validateCatalog } from './shared-catalog.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);
const catalog = doc(db, CATALOG_PATH);
export const ready = auth.authStateReady();
export const administrator = (user = auth.currentUser) => !!user && user.email === ADMIN_EMAIL && user.emailVerified && user.providerData.some((p) => p.providerId === 'google.com');
export const watchAuth = (changed) => onAuthStateChanged(auth, changed);
export const logout = () => signOut(auth);
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
export async function readCatalog(fallback) {
  return unpack(await getDocFromServer(catalog), fallback);
}
export function watchCatalog(fallback, changed, failed) {
  return onSnapshot(catalog, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return;
    try { changed(unpack(snapshot, fallback)); } catch (error) { failed(error); }
  }, failed);
}
export async function publishCatalog(data, expectedRevision) {
  if (!administrator()) throw new Error('Entra con la cuenta de administrador de Google.');
  const json = JSON.stringify(validateCatalog(data));
  await runTransaction(db, async (tx) => {
    const current = await tx.get(catalog);
    const revision = current.exists() ? current.data().revision : 0;
    if (revision !== expectedRevision) throw new Error('El catálogo cambió en otro dispositivo. Se ha recargado; vuelve a aplicar el cambio.');
    tx.set(catalog, { json, revision: revision + 1, updatedAt: serverTimestamp() });
  });
  return expectedRevision + 1;
}
export function explain(error) {
  const messages = {
    'auth/popup-closed-by-user': 'Has cerrado la ventana de Google. Puedes volver a entrar.',
    'auth/popup-blocked': 'Permite las ventanas emergentes para acceder con Google.',
    'auth/unauthorized-domain': 'Este dominio todavía no está autorizado para acceder con Google.',
    'permission-denied': 'Esta cuenta no tiene permiso para administrar los canales.',
    'unavailable': 'No se pudo conectar con el catálogo. Comprueba la conexión y vuelve a intentarlo.',
  };
  return messages[error.code] || error.message || 'No se pudo completar la operación.';
}
