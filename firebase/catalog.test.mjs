import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc, serverTimestamp, increment, query, where } from 'firebase/firestore';
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

const session = 'A'.repeat(24);
const minute = () => Math.floor(Date.now() / 60000);
const beat = (overrides = {}) => {
  const target = overrides.target ?? 'c:la-1', m = overrides.minute ?? minute();
  return { target, minute: m, beat: `${target}|${m}`, updatedAt: serverTimestamp(), ...overrides };
};
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
test('anyone can report and count viewers without personal data', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(db, 'calamarAudience', session), beat()));
  await assertSucceeds(setDoc(doc(db, 'calamarAudience', session), beat({ target: 'e:evento-1' })));
  await assertSucceeds(getDocs(query(collection(db, 'calamarAudience'), where('beat', 'in', [`e:evento-1|${minute()}`]))));
  await assertSucceeds(deleteDoc(doc(db, 'calamarAudience', session)));
});
test('presence rejects extra fields, bad ids, forged beats and distant minutes', async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const invalid of [{ email: 'x@example.com' }, { target: 'x:la-1' }, { beat: 'c:other|1' }, { minute: minute() - 10 }, { minute: '1' }, { updatedAt: new Date(0) }]) {
    await assertFails(setDoc(doc(db, 'calamarAudience', session), beat(invalid)));
  }
  await assertFails(setDoc(doc(db, 'calamarAudience', 'short'), beat()));
});
test('visits add one to one key of today and only the admin reads them', async () => {
  const db = env.unauthenticatedContext().firestore();
  const ref = doc(db, 'calamarVisits', today());
  const visit = (key, extra = {}) => ({ last: key, [key]: increment(1), ...extra });
  await assertSucceeds(setDoc(ref, visit('c_la-1'), { merge: true }));
  await assertSucceeds(setDoc(ref, visit('c_la-1'), { merge: true }));
  await assertSucceeds(setDoc(ref, visit('e_evento-1'), { merge: true }));
  await assertFails(setDoc(ref, visit('c_la-1', { 'c_la-1': increment(5) }), { merge: true }));
  await assertFails(setDoc(ref, visit('c_la-1', { 'c_la-2': increment(1) }), { merge: true }));
  await assertFails(setDoc(ref, visit('e_evento-1', { last: 'c_la-1' }), { merge: true }));
  await assertFails(setDoc(ref, visit('bad key'), { merge: true }));
  await assertFails(setDoc(ref, { last: 'c_la-1', 'c_la-1': 1 }));
  await assertFails(setDoc(doc(db, 'calamarVisits', '2001-01-01'), visit('c_la-1'), { merge: true }));
  await assertFails(setDoc(doc(db, 'calamarVisits', 'today'), visit('c_la-1'), { merge: true }));
  await assertFails(getDoc(ref));
  await assertFails(deleteDoc(ref));
  const stats = await assertSucceeds(getDoc(doc(admin(), 'calamarVisits', today())));
  assert.deepEqual(stats.data(), { last: 'e_evento-1', 'c_la-1': 2, 'e_evento-1': 1 });
});
