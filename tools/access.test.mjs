import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitMessage, DEFAULT_SCREENS } from '../web/access.js';

test('one screen by default; a new screen beyond the limit is told why, with what is being watched', () => {
  assert.equal(DEFAULT_SCREENS, 1);
  assert.equal(limitMessage(1, []), null);
  assert.equal(limitMessage(2, [{ title: 'La 1' }]), null);
  const message = limitMessage(1, [{ title: 'Real Madrid vs Barcelona' }]);
  assert.match(message, /Se ha superado el límite de reproducciones simultáneas de tu cuenta \(1 pantalla\)/);
  assert.match(message, /Real Madrid vs Barcelona/);
  assert.match(limitMessage(2, [{ title: 'A' }, { title: 'B' }]), /2 pantallas/);
});

import { claimPlan, LEASE_MS } from '../web/access-lease.js';
test('atomic claim planning counts profiles together and reserves every player of Multipantalla', () => {
  const now = 1000000, live = {holder:'other',title:'Film',at:now-1000};
  assert.deepEqual(claimPlan([live,null],'mine',1,2,now),[1]);
  assert.throws(()=>claimPlan([live,null],'mine',2,2,now),/límite/);
  assert.throws(()=>claimPlan([], 'mine',2,1,now),/límite/);
  assert.deepEqual(claimPlan([{...live,at:now-LEASE_MS}], 'mine',1,1,now),[0]);
  assert.deepEqual(claimPlan([{...live,holder:'mine'}], 'mine',1,1,now),[0]);
});

async function controller(t, {required=true,user={uid:'viewer'}}={}) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const access = await import(`../web/access.js?case=${Math.random()}`);
  const callbacks={}, claims=[], ended=[];
  const service={
    watchAccessSettings(next){callbacks.settings=next;next({requireRegistration:required});},
    watchAuth(next){callbacks.auth=next;next(user);},
    watchAccess(uid,next){callbacks.rights=next;next({expires:null,screens:1});return ()=>{};},
    administrator(){return false;},registerMember(){return Promise.resolve();},
    async claimSessions(holder, details){claims.push({holder,details});},
    async beatSession(){},async endSession(holder){ended.push(holder);},
  };
  access.startAccess(()=>Promise.resolve(service));
  await new Promise(setImmediate);
  t.after(()=>access.stopWatching());
  return {access,callbacks,claims,ended,service};
}

test('enabling mandatory registration stops anonymous playback immediately',async t=>{
  const {access,callbacks,claims}=await controller(t,{required:false,user:null});
  const lost=[];access.onPlaybackAccessLost(reason=>lost.push(reason));
  assert.equal((await access.startWatching('La 1')).ok,true);
  assert.equal(access.playbackAllowed(),true);assert.equal(claims.length,0);
  callbacks.settings({requireRegistration:true});
  assert.equal(access.playbackAllowed(),false);assert.equal(lost.length,1);assert.match(lost[0],/cuenta/);
});

test('expiry releases the existing lease; a rejected renewal stops the media',async t=>{
  const {access,callbacks,service,ended}=await controller(t);
  const lost=[];access.onPlaybackAccessLost(reason=>lost.push(reason));
  assert.equal((await access.startWatching('Película','Perfil 2',1)).ok,true);
  callbacks.rights({expires:Date.now()-1,screens:1});
  await new Promise(setImmediate);
  assert.equal(access.playbackAllowed(),false);assert.equal(ended.length,1);assert.match(lost[0],/caducado/);
  callbacks.rights({expires:null,screens:1});
  assert.equal((await access.startWatching('Canal')).ok,true);
  service.beatSession=async()=>{throw Error('revoked');};
  t.mock.timers.tick(30000);await new Promise(setImmediate);
  assert.equal(access.playbackAllowed(),false);assert.equal(ended.length,2);assert.equal(lost.length,2);
});

test('closing a pending claim releases it and cannot restart playback',async t=>{
  const {access,service,ended}=await controller(t);
  let grant;
  service.claimSessions=()=>new Promise(resolve=>{grant=resolve;});
  const first=access.startWatching('Película','Perfil 1',1);
  await new Promise(setImmediate);assert.equal(typeof grant,'function');
  await access.stopWatching();grant();
  assert.equal((await first).ok,false);assert.equal(access.playbackAllowed(),false);assert.equal(ended.length,1);
});

test('replacement waits for release and reserves the actual Multipantalla size',async t=>{
  const {access,service,claims}=await controller(t);
  assert.equal((await access.startWatching('Canal')).ok,true);
  let release;
  service.endSession=()=>new Promise(resolve=>{release=resolve;});
  const next=access.startWatching('Multipantalla','Perfil 2',3);
  await new Promise(setImmediate);assert.equal(claims.length,1);
  release();assert.equal((await next).ok,true);assert.equal(claims.length,2);
  assert.equal(claims[1].details.count,3);assert.equal(claims[1].details.profile,'Perfil 2');
  assert.notEqual(claims[0].holder,claims[1].holder);
  service.endSession=async()=>{};
});


test('opening another video waits for an earlier close to finish releasing its slot',async t=>{
  const {access,service,claims}=await controller(t);
  assert.equal((await access.startWatching('A')).ok,true);
  let finishRelease;
  service.endSession=()=>new Promise(resolve=>{finishRelease=resolve;});
  const closed=access.stopWatching();
  const opened=access.startWatching('B');
  await new Promise(setImmediate);
  assert.equal(claims.length,1);assert.equal(access.playbackAllowed(),false);
  finishRelease();await closed;
  assert.equal((await opened).ok,true);assert.equal(claims.length,2);
  service.endSession=async()=>{};
});
