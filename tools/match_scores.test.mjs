import test from 'node:test';
import assert from 'node:assert/strict';
import {googleMatchUrl, identifyMatch, matchResult, resolveMatch, fetchMatch} from '../web/match-scores.js';
const fixture=(state='in',name='STATUS_SECOND_HALF',completed=false)=>({id:'401882870',date:'2026-10-21T18:00Z',competitions:[{id:'401882870',status:{displayClock:"74'",type:{state,name,completed}},competitors:[{homeAway:'home',score:'2',team:{displayName:'Levante',shortDisplayName:'Levante',name:'Levante'}},{homeAway:'away',score:'1',team:{displayName:'Athletic Club',name:'Athletic Club'}}]}]});
test('accepts share.google and complete Google match links, rejects unrelated hosts/credentials',()=>{
 assert.equal(googleMatchUrl('https://share.google/RSJmsOE0s8wgQUT3n'),'https://share.google/RSJmsOE0s8wgQUT3n');
 for(const u of ['http://share.google/a','https://share.google.evil/a','https://evil/search?q=x','https://user@www.google.com/search?q=x','https://www.google.com/search','https://share.google/a/b'])assert.throws(()=>googleMatchUrl(u));
});
test('identifies both teams on the correct date; never silently picks an ambiguous match',()=>{
 const e=fixture(),q='levante ud contra athletic club';
 assert.equal(identifyMatch({events:[e]},q,e.date).id,e.id);
 assert.throws(()=>identifyMatch({events:[e]},'levante contra real madrid',e.date));
 assert.throws(()=>identifyMatch({events:[e,e]},q,e.date));
 assert.throws(()=>identifyMatch({events:[e]},q,'2027-01-01T18:00Z'));
});
test('uses real clock and status, including halftime, final and postponement',()=>{
 assert.equal(matchResult(fixture()).text,'2 – 1 · En juego · 74′');
 assert.equal(matchResult(fixture('in','STATUS_HALFTIME')).text,'2 – 1 · Descanso');
 assert.equal(matchResult(fixture('post','STATUS_FULL_TIME',true)).text,'2 – 1 · Finalizado');
 assert.equal(matchResult(fixture('pre','STATUS_POSTPONED')).text,'Aplazado');
 assert.equal(matchResult(fixture('pre','STATUS_SCHEDULED')).text,'Programado');
 assert.throws(()=>matchResult({}));
});
test('short link resolver and ESPN fixture lookup produce persisted metadata',async()=>{
 const calls=[],e=fixture();
 const result=await resolveMatch('https://share.google/RSJmsOE0s8wgQUT3n',e.date,async url=>{
   calls.push(url);return {ok:true,json:async()=>url.includes('calamar-match.php')?{url:'https://www.google.com/search?q=levante+ud+contra+athletic+club'}:{events:[e]}};
 });
 assert.equal(result.matchId,e.id);assert.equal(result.matchUrl,'https://share.google/RSJmsOE0s8wgQUT3n');assert.equal(calls.length,2);
 assert.match(calls[1],/dates=20261021&limit=1000/);
 await assert.rejects(resolveMatch('https://share.google/test',e.date,async()=>{throw Error('offline')}),/hosting/);
});
test('summary requests share cache and a failure can recover',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return {ok:true,json:async()=>({header:fixture()})}};
 await Promise.all([fetchMatch('401882870',fetcher),fetchMatch('401882870',fetcher)]);assert.equal(calls,1);
 await assert.rejects(fetchMatch('12',async()=>({ok:false,status:503})),/503/);
 assert.equal((await fetchMatch('12',fetcher)).state,'live');
});
