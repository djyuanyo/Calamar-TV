import test from 'node:test';
import assert from 'node:assert/strict';
import { accessDecision, webPolicy, mergeUserDirectory, findUsers } from '../web/access-policy.js';
import { createWebAccess } from '../web/web-access.js';
const base = { policy: { requireLogin:true }, policyReady:true, authReady:true, blockReady:true, user:null };
test('required admission is the default; optional access restores guest browsing',()=>{
  assert.equal(webPolicy(null).requireLogin,true);
  assert.equal(accessDecision(base),'login');
  assert.equal(accessDecision({...base,policy:{requireLogin:false}}),'allowed');
  assert.equal(accessDecision({...base,policyReady:false}),'loading');
  assert.equal(accessDecision({...base,user:{uid:'u',pending:true},authReady:false}),'loading');
});
test('blocked accounts and unconfirmed block status never enter protected content; admin can recover settings',()=>{
  assert.equal(accessDecision({...base,user:{uid:'u'},blocked:true}),'blocked');
  assert.equal(accessDecision({...base,user:{uid:'u'},blockReady:false}),'loading');
  assert.equal(accessDecision({...base,user:{uid:'u'},blockError:Error('offline')}),'error');
  assert.equal(accessDecision({...base,user:{uid:'u'},administrator:true,policyError:Error('offline')}),'allowed');
});
test('existing profiles remain manageable before the next login adds email metadata',()=>{
  const rows=mergeUserDirectory([{uid:'a',name:'Álvaro',email:'a@example.com'}],[{uid:'a',json:JSON.stringify({profiles:[{name:'Antes'}]})},{uid:'b',json:JSON.stringify({profiles:[{name:'Bea'}]})}],[{uid:'b',blocked:true}]);
  assert.equal(rows.length,2); assert.equal(findUsers(rows,'alvaro')[0].profileCount,1); assert.equal(findUsers(rows,'A@EXAMPLE')[0].name,'Álvaro');assert.equal(findUsers(rows,'bea')[0].blocked,true);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('controller ignores cached profiles, closes admission on logout or live policy change, and ignores stale block responses',async()=>{
  let authNext,policyNext;const blocked=new Map();const f={ready:Promise.resolve(),auth:{currentUser:null},administrator:u=>u?.uid==='admin',recordMember:async()=>{},watchAuth:cb=>{authNext=cb;return()=>{};},watchWebAccess:cb=>{policyNext=cb;return()=>{};},watchUserAccess:(uid,cb)=>{blocked.set(uid,cb);return()=>{};}};
  const control=createWebAccess(async()=>f,()=>{});control.start();await flush();
  assert.equal(control.current().decision,'loading');policyNext({requireLogin:true});assert.equal(control.current().decision,'login');
  authNext({uid:'a'});assert.equal(control.current().decision,'loading');blocked.get('a')(false);assert.equal(control.current().decision,'allowed');
  blocked.get('a')(true);assert.equal(control.current().decision,'blocked');
  authNext({uid:'b'});blocked.get('a')(false);assert.equal(control.current().decision,'loading');blocked.get('b')(false);assert.equal(control.current().decision,'allowed');
  authNext(null);assert.equal(control.current().decision,'login');policyNext({requireLogin:false});assert.equal(control.current().decision,'allowed');policyNext({requireLogin:true});assert.equal(control.current().decision,'login');control.stop();
});

test('Firebase anonymous sessions and cached profile identities do not count as registration',()=>{
  assert.equal(accessDecision({...base,user:{uid:'anon',isAnonymous:true}}),'login');
  assert.equal(accessDecision({...base,user:{uid:'cached',pending:true}}),'login');
  assert.equal(accessDecision({...base,user:{uid:'anon',isAnonymous:true},policy:{requireLogin:false}}),'allowed');
});
