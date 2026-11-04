export const fakeFirebase = fixture => `
import { validateCatalog } from './shared-catalog.js';
let catalog = JSON.parse(sessionStorage.getItem('catalog') || 'null') || ${JSON.stringify(fixture)}, revision = 1;
export const ready = Promise.resolve(), auth = { currentUser: Object.prototype.hasOwnProperty.call(window, '__initialAuth') ? window.__initialAuth : { uid: 'admin-fixture', email: 'admin@example.com', getIdToken: async () => 'token' } };
export const currentUser = () => auth.currentUser?.emailVerified === false ? null : auth.currentUser;
export const administrator = (user = auth.currentUser) => !!user && user.email === 'admin@example.com';
export const imageService = async () => ({configured: true});
export const connectImageService = async () => ({configured: true});
export const watchAuth = (changed) => { (window.__authWatchers ||= []).push(changed); return () => {}; };
export const login = async () => {}, logout = async () => {}, explain = e => e.message;
export const readCatalog = async () => ({ data: structuredClone(catalog), revision });
export const publishCatalog = async (data, expected = revision) => {
  const beforePublish = window.__beforeCatalogPublish;
  if (beforePublish) {
    delete window.__beforeCatalogPublish;
    catalog = beforePublish(structuredClone(catalog));
    revision++;
  }
  if (expected !== revision) throw Object.assign(new Error('El catálogo cambió en otro dispositivo.'), { code: 'catalog-conflict' });
  catalog = structuredClone(validateCatalog(data));
  window.__published = catalog;
  sessionStorage.setItem('catalog', JSON.stringify(catalog));
  return ++revision;
};
export const watchCatalog = (fallback, next) => { const send = () => next({ data: structuredClone(catalog) }); if (sessionStorage.getItem('slowCatalog')) setTimeout(send, 1500); else send(); return () => {}; };
const present = new Map();
window.__audienceTargets = () => [...present.values()];
window.__visits = [];
export const beat = async (session, target) => { present.set(session, target); };
export const leave = async session => { present.delete(session); };
export const viewers = async target => [...present.values()].filter(t => t === target).length + 2;
export const audience = async () => [...present.values()].map(target => ({ target, minute: Math.floor(Date.now() / 60000) }));
export const viewersOf = async targets => new Map(targets.map(target => [target, [...present.values()].filter(t => t === target).length]));
export const purgeAudience = async () => {};
export const recordVisit = async (day, key) => { window.__visits.push([day, key]); };
export const visits = async () => [{ id: '2026-11-30', data: { 'c_sport-one': 3, last: 'c_sport-one' } }];
export const readLibrarySettings = async () => window.__librarySettings || { tmdb: 'abcdef0123456789abcdef0123456789', folders: { movies: 'https://drive.google.com/drive/folders/PELISPELISPELISPELIS12345' } };
export const saveLibrarySettings = async (settings) => { window.__librarySettings = settings; };
export const publishLibraryParts = async (parts) => { window.__libraryParts = parts; window.__libraryPublishCount = (window.__libraryPublishCount || 0) + 1; };
export const publishDeviceLogin = async (id) => { window.__deviceLogin = id; };
export const watchDeviceLogin = (id, changed) => { window.__deviceUsed = () => changed(false); return () => {}; };
export const readAccount = async () => window.__account || null;
export const writeAccount = async (data) => { window.__account = data; };
export const readProfileData = async (id) => (window.__profileData || {})[id] || null;
export const writeProfileData = async (id, data) => { (window.__profileData ||= {})[id] = data; };
export const deleteProfileData = async (id) => { delete (window.__profileData || {})[id]; };
export const readCloudProgress = async () => ({ entries: {}, removed: {} });
export const writeCloudProgress = async () => {};
export const loginGoogle = async () => {if(window.__fakeLogin)window.__setAuthFixture({uid:'member-fixture',email:'alvaro@example.com',displayName:'Alvaro',providerData:[{providerId:'google.com'}]});}, resetPassword = async () => {};
export const registerEmail = async email => { window.__verificationMail = email; return { verification: true, sent: true }; };
export const loginEmail = async (email, password, resend) => {
  if (resend) window.__verificationMail = email;
  return { verification: true, sent: resend };
};

let webAccess=window.__initialWebAccess || {requireLogin:false};
export const readWebAccess=async()=>webAccess;
export const watchWebAccess=next=>{(window.__policyWatchers||=[]).push(next);next(webAccess);return()=>{};};
window.__setWebAccess=next=>{webAccess=next;for(const cb of window.__policyWatchers||[])cb(next);};
export const saveWebAccess=async next=>{window.__savedWebAccess=next;window.__setWebAccess(next);};
const blocks=new Map(),blockWatchers=new Map(),deleted=new Set();
export const watchUserAccess=(uid,next)=>{const watchers=blockWatchers.get(uid)||[];watchers.push(next);blockWatchers.set(uid,watchers);next(blocks.get(uid)===true);return()=>{};};
export const recordMember=async()=>{};
export const setUserBlocked=async(uid,blocked)=>{blocks.set(uid,blocked);window.__lastUserBlock={uid,blocked};for(const next of blockWatchers.get(uid)||[])next(blocked);};
export const deleteUserAccount = async uid => { deleted.add(uid); window.__deletedUser = uid; await setUserBlocked(uid, true); };
window.__setUserBlocked=setUserBlocked;
export const readUserDirectory=async()=>({members:[{uid:'admin-fixture',name:'Administrador',email:'admin@example.com',provider:'google.com'},{uid:'member-fixture',name:'Álvaro',email:'alvaro@example.com',provider:'password',verified:true,registeredAt:1760000000000,lastSeen:1790000000000}],profiles:[{uid:'member-fixture',json:JSON.stringify({profiles:[{id:'main',name:'Alvaro'}]})}],access:[...blocks].map(([uid,blocked])=>({uid,blocked,deleted:deleted.has(uid)}))});
const privateHistory = new Map(), liveViewers = new Map();
window.__privateHistory = [];
export const showViewing = async (record, first) => {
  if (first) privateHistory.set(record.id, {...record, startedAt: Date.now()});
  liveViewers.set(record.id, record);
  window.__privateHistory = [...privateHistory.values()];
  return true;
};
export const hideViewing = async (record, finished) => {
  liveViewers.delete(record.id);
  if (finished && privateHistory.has(record.id)) privateHistory.get(record.id).endedAt = Date.now();
  window.__privateHistory = [...privateHistory.values()];
};
export const readUserDetails = async uid => {
  if (deleted.has(uid)) return null;
  const directory = await readUserDirectory();
  const member = directory.members.find(m => m.uid === uid);
  return member && {...member, blocked: blocks.get(uid) === true, profiles: uid === 'member-fixture'
    ? [{id: 'main', name: 'Álvaro', data: {favorites: {'sport-one': {at: Date.now()}}}}] : []};
};
export const readViewingHistory = async uid => ({entries: [...privateHistory.values()].filter(v => v.uid === uid), cursor: null});
export const readLiveViewers = async () => [
  ...[...liveViewers.values()].map(record => ({...record, name: 'Álvaro'})),
  {uid: 'member-fixture', name: 'Álvaro', profile: 'Álvaro', title: 'Sports One', device: 'tv', target: 'c:sport-one'},
  {uid: 'member-fixture', name: 'Álvaro', profile: 'Álvaro', title: 'Sports One', device: 'android', target: 'c:sport-one'},
  {uid: 'member-fixture', name: 'Álvaro', profile: 'Álvaro', title: 'Águilas vs Betis', device: 'web', target: 'e:game'},
  {uid: 'member-fixture', name: 'Álvaro', profile: 'Álvaro', title: 'Tulsa King · T1 · Piloto', device: 'android', target: 'l:tulsa-king'},
  {uid: 'member-fixture', name: 'Álvaro', profile: 'Álvaro', title: 'Avatar', device: 'web', target: 'l:avatar'},
];
window.__setAuthFixture=user=>{auth.currentUser=user;for(const cb of window.__authWatchers||[])cb(user);};
`;
