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
  await assertSucceeds(setDoc(doc(db, 'calamarAudience', session), beat({ target: 'l:mavatar' })));
  await assertSucceeds(getDocs(query(collection(db, 'calamarAudience'), where('beat', 'in', [`e:evento-1|${minute()}`]))));
  await assertSucceeds(deleteDoc(doc(db, 'calamarAudience', session)));
});
test('presence rejects extra fields, bad ids, forged beats and distant minutes', async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const invalid of [{ email: 'x@example.com' }, { target: 'x:la-1' }, { target: 'v:la-1' }, { beat: 'c:other|1' }, { minute: minute() - 10 }, { minute: '1' }, { updatedAt: new Date(0) }]) {
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
  await assertSucceeds(setDoc(ref, visit('l_mavatar'), { merge: true }));
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
  assert.deepEqual(stats.data(), { last: 'e_evento-1', 'c_la-1': 2, 'l_mavatar': 1, 'e_evento-1': 1 });
});

test('library parts: public read, admin writes valid parts only; settings are private to the admin', async () => {
  const anyone = env.unauthenticatedContext().firestore();
  const part = (overrides = {}) => ({ json: '{"items":[]}', updatedAt: serverTimestamp(), ...overrides });
  await assertSucceeds(setDoc(doc(admin(), 'calamarLibrary/index'), part()));
  await assertSucceeds(setDoc(doc(admin(), 'calamarLibrary/series-0'), part()));
  await assertSucceeds(getDoc(doc(anyone, 'calamarLibrary/series-0')));
  await assertFails(getDocs(collection(anyone, 'calamarLibrary')));
  await assertFails(setDoc(doc(anyone, 'calamarLibrary/index'), part()));
  await assertFails(setDoc(doc(env.authenticatedContext('other', claims({ email: 'other@example.com' })).firestore(), 'calamarLibrary/index'), part()));
  for (const [name, invalid] of [['index', { json: 'x'.repeat(900001) }], ['index', { extra: 1 }], ['index', { updatedAt: new Date(0) }], ['catalog', {}], ['Series-0', {}]]) {
    await assertFails(setDoc(doc(admin(), `calamarLibrary/${name}`), part(invalid)));
  }
  await assertSucceeds(deleteDoc(doc(admin(), 'calamarLibrary/series-0')));
  await assertSucceeds(setDoc(doc(admin(), 'calamarPrivate/library'), { tmdb: 'k', folders: {} }));
  await assertSucceeds(getDoc(doc(admin(), 'calamarPrivate/library')));
  await assertFails(getDoc(doc(anyone, 'calamarPrivate/library')));
  await assertFails(setDoc(doc(anyone, 'calamarPrivate/library'), { tmdb: 'x' }));
});

test('phone sign-in for the app: only the admin hands it over; read with key and code; deleted once used', async () => {
  const anyone = env.unauthenticatedContext().firestore();
  const login = (overrides = {}) => ({ idToken: 'google-id-token', createdAt: serverTimestamp(), ...overrides });
  await assertSucceeds(setDoc(doc(admin(), 'calamarDeviceLogins/K7Q2AB3D'), login()));
  await assertSucceeds(getDoc(doc(anyone, 'calamarDeviceLogins/K7Q2AB3D')));
  await assertFails(getDocs(collection(anyone, 'calamarDeviceLogins')));
  await assertFails(setDoc(doc(anyone, 'calamarDeviceLogins/K7Q2AB3E'), login()));
  // Any Google account may sign its own app in from the phone; an email and password account has no Google token.
  await assertSucceeds(setDoc(doc(env.authenticatedContext('other', claims({ email: 'other@example.com' })).firestore(), 'calamarDeviceLogins/K7Q2AB3F'), login()));
  await assertFails(setDoc(doc(env.authenticatedContext('pw', claims({ email: 'pw@example.com', firebase: { sign_in_provider: 'password' } })).firestore(), 'calamarDeviceLogins/K7Q2AB3K'), login()));
  for (const [id, invalid] of [['K7Q2AB3G', { extra: 1 }], ['K7Q2AB3H', { createdAt: new Date(0) }], ['K7Q2AB3J', { idToken: 'x'.repeat(4096) }], ['K7Q2AB', {}], ['K7Q2AB0O', {}], ['k7q2ab3d', {}]]) {
    await assertFails(setDoc(doc(admin(), `calamarDeviceLogins/${id}`), login(invalid)));
  }
  await assertFails(setDoc(doc(anyone, 'calamarDeviceLogins/K7Q2AB3D'), { idToken: 'other', createdAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(anyone, 'calamarDeviceLogins/K7Q2AB3D')));
  await assertFails(getDoc(doc(anyone, 'calamarDeviceLogins/K7Q2AB3D')));
  // An old one (written past the rules) cannot be read any more.
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'calamarDeviceLogins/K7Q2OLD2'), { idToken: 't', createdAt: new Date(Date.now() - 6 * 60000) }));
  await assertFails(getDoc(doc(anyone, 'calamarDeviceLogins/K7Q2OLD2')));
});
test('each account reads and writes only its own «Continuar viendo»', async () => {
  const mine = env.authenticatedContext('user-a', claims({ email: 'a@example.com' })).firestore();
  const other = env.authenticatedContext('user-b', claims({ email: 'b@example.com' })).firestore();
  const progress = (overrides = {}) => ({ json: '{"entries":{},"removed":{}}', updatedAt: serverTimestamp(), ...overrides });
  await assertSucceeds(setDoc(doc(mine, 'calamarProgress/user-a'), progress()));
  await assertSucceeds(getDoc(doc(mine, 'calamarProgress/user-a')));
  await assertFails(getDoc(doc(other, 'calamarProgress/user-a')));
  await assertFails(setDoc(doc(other, 'calamarProgress/user-a'), progress()));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'calamarProgress/user-a')));
  await assertFails(setDoc(doc(mine, 'calamarProgress/user-a'), progress({ extra: 1 })));
  await assertFails(setDoc(doc(mine, 'calamarProgress/user-a'), progress({ json: 'x'.repeat(200001) })));
  await assertFails(getDocs(collection(mine, 'calamarProgress')));
});
test('each account reads and writes only its own profiles, their data and their «Continuar viendo»', async () => {
  const mine = env.authenticatedContext('user-a', { email: 'a@example.com', firebase: { sign_in_provider: 'password' } }).firestore();
  const other = env.authenticatedContext('user-b', claims({ email: 'b@example.com' })).firestore();
  const value = (overrides = {}) => ({ json: '{}', updatedAt: serverTimestamp(), ...overrides });
  for (const path of ['calamarUsers/user-a', 'calamarUsers/user-a/profiles/p2', 'calamarUsers/user-a/progress/p2']) {
    await assertSucceeds(setDoc(doc(mine, path), value()));
    await assertSucceeds(getDoc(doc(mine, path)));
    await assertFails(getDoc(doc(other, path)));
    await assertFails(setDoc(doc(other, path), value()));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
    await assertFails(setDoc(doc(mine, path), value({ extra: 1 })));
    await assertFails(setDoc(doc(mine, path), value({ updatedAt: new Date(0) })));
  }
  await assertFails(setDoc(doc(mine, 'calamarUsers/user-a'), value({ json: 'x'.repeat(20001) })));
  await assertFails(setDoc(doc(mine, 'calamarUsers/user-a/profiles/Bad-Id'), value()));
  await assertFails(getDocs(collection(mine, 'calamarUsers')));
  await assertFails(getDocs(collection(mine, 'calamarUsers/user-a/profiles')));
  await assertSucceeds(deleteDoc(doc(mine, 'calamarUsers/user-a/profiles/p2')));
});
