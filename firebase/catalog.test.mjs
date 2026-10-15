import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
let env;
const path = 'calamarCatalog/custom';
const data = { json: '{"channels":[],"featured":[],"hidden":[]}', revision: 1 };
const value = (overrides = {}) => ({ ...data, updatedAt: serverTimestamp(), ...overrides });
const claims = (overrides = {}) => ({ email: 'juanjocarrillo7@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...overrides });
const admin = () => env.authenticatedContext('admin', claims()).firestore();
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-calamar-tv', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());
test('public can read only the catalog document', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, path)));
  await assertFails(getDoc(doc(db, 'private/secret')));
  await assertFails(getDocs(collection(db, 'calamarCatalog')));
});
test('anonymous and other Google accounts cannot write', async () => {
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), path), value()));
  await assertFails(setDoc(doc(env.authenticatedContext('other', claims({ email: 'other@example.com' })).firestore(), path), value()));
});
test('unverified and non-Google credentials are rejected', async () => {
  for (const overrides of [{ email_verified: false }, { firebase: { sign_in_provider: 'password' } }]) {
    await assertFails(setDoc(doc(env.authenticatedContext('admin', claims(overrides)).firestore(), path), value()));
  }
});
test('verified Google admin creates and updates with sequential revisions', async () => {
  const ref = doc(admin(), path);
  await assertSucceeds(setDoc(ref, value()));
  await assertSucceeds(setDoc(ref, value({ revision: 2 })));
  await assertFails(setDoc(ref, value({ revision: 2 })));
  await assertFails(deleteDoc(ref));
});
test('reject extra fields, oversized data, forged timestamps and invalid revision', async () => {
  const ref = doc(admin(), path);
  for (const invalid of [{ extra: true }, { json: 'x'.repeat(500001) }, { updatedAt: new Date(0) }, { revision: 2 }, { json: {} }]) {
    await assertFails(setDoc(ref, value(invalid)));
  }
  await assertFails(setDoc(doc(admin(), 'calamarCatalog/other'), value()));
});
