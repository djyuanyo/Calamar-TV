import test from 'node:test';
import assert from 'node:assert/strict';
import { madplayMatch, madplayMenu, madplaySource, expandMadplaySources } from '../web/madplay-sources.js';
import { webPlayback } from '../web/catalog.js';
const page = 'https://jack21eo.mpanrc4imind.my/es/football/russian-cup-4436876/cska-moscow-vs-lokomotiv-moscow.html?icg=RVM';
const row = (id,name='VIX ES') => ({id,name,url:madplaySource(page,id)});
const reply = (items) => ({ok:true,json:async()=>({items})});
test('current match is an event page and source URLs identify the SAME match',()=>{
  assert.equal(madplayMatch(page),'4436876');assert.match(madplayMenu(page),/\/match\/4436876\/sources.json$/);
  assert.equal(webPlayback(page,{pages:true}).kind,'event');assert.match(madplaySource(page,905919),/\/match\/4436876\/source\/905919\/index.m3u8$/);
  assert.equal(webPlayback(madplaySource(page,905919)).kind,'hls');
});
test('lookalike hosts, credentials, ports, protocols and invalid IDs are rejected',()=>{
  for(const address of ['http:'+page.slice(6),page.replace('jack21eo.mpanrc4imind.my','mpanrc4imind.my.evil.example'),page.replace('https://','https://user@'),page.replace('.my/','.my:444/'),'https://madplay77.ru/es/football/x-0/m.html'])assert.equal(madplayMenu(address),null);
  for(const id of ['0','../x','1/../../2','1?token=x',-1])assert.equal(madplaySource(page,id),null);
});
test('sources expand once per match into named hosting addresses; no provider page is fetched',async()=>{
  const asked=[];const result=await expandMadplaySources([page,page.replace('RVM','OTRO')],{fetcher:async u=>{asked.push(u);return reply([row(905919),row(901559,'English'),row(905919)]);}});
  assert.deepEqual(asked,[madplayMenu(page)]);assert.deepEqual(result.map(x=>x.name),['VIX ES','English']);assert.equal(result[0].origin,page);
});
test('temporary upstream URLs, wrong matches and malformed records never become playable menu entries',async()=>{
  const result=await expandMadplaySources([page],{fetcher:async()=>reply([{...row(905919),url:'https://provider.example/temp.m3u8?token=secret'},{...row(901559),url:madplaySource(page,901559).replace('4436876','4522835')},row('../x')])});
  assert.equal(result.length,1);assert.equal(result[0].url,page);assert.match(result[0].error,/no tiene fuentes/);
});
test('disabled or unavailable hosting stays an explicit event error, never a raw-page video or iframe',async()=>{
  const result=await expandMadplaySources([page],{fetcher:async()=>({ok:false,status:503,json:async()=>({error:'La fuente está pendiente de verificar y habilitar.'})})});
  assert.match(result[0].error,/pendiente/);assert.equal(webPlayback(result[0].url,{pages:true}).kind,'event');
});
test('mixed existing sources preserve their identity, labels and previous errors',async()=>{
  const other={url:'https://bp.zicotv.cc/events/19',name:'Mi canal',origin:'original',error:'Esperando'};assert.deepEqual(await expandMadplaySources([other]),[other]);
});
test('closing the player cancels its menu lookup instead of publishing late sources',async()=>{
  const abort=new AbortController();abort.abort();await assert.rejects(expandMadplaySources([page],{signal:abort.signal,fetcher:async()=>{throw new Error('cancelado');}}),/cancelado/);
});
