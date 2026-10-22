import test from 'node:test';
import assert from 'node:assert/strict';
import {googleMatchUrl, identifyMatch, matchResult, resolveMatch, fetchMatch} from '../web/match-scores.js';
const fixture=(state='in',name='STATUS_SECOND_HALF',completed=false)=>({id:'401882870',date:'2026-10-21T18:00Z',competitions:[{id:'401882870',status:{displayClock:"74'",type:{state,name,completed}},competitors:[{homeAway:'home',score:'2',team:{displayName:'Levante',shortDisplayName:'Levante',name:'Levante'}},{homeAway:'away',score:'1',team:{displayName:'Athletic Club',name:'Athletic Club'}}]}]});
test('accepts share.google and complete Google match links, rejects unrelated hosts/credentials',()=>{
 assert.equal(googleMatchUrl('https://share.google/RSJmsOE0s8wgQUT3n'),'https://share.google/RSJmsOE0s8wgQUT3n');
 for(const u of ['http://share.google/a','https://share.google.evil/a','https://evil/search?q=x','https://user@www.google.com/search?q=x','https://www.google.com/search','https://share.google/a/b'])assert.throws(()=>googleMatchUrl(u));
});
test('the link decides the match: both teams beat one, the closest date breaks ties, the event\'s own data is not needed',()=>{
 const e=fixture(),q='levante ud contra athletic club';
 assert.equal(identifyMatch({events:[e]},q,e.date).id,e.id);
 assert.equal(identifyMatch({events:[e]},q,'2027-01-01T18:00Z').id,e.id,'a different event date still finds it');
 assert.equal(identifyMatch({events:[e]},q,'').id,e.id,'no date needed');
 const later={...fixture(),id:'401882999',date:'2026-10-28T18:00Z'};
 assert.equal(identifyMatch({events:[later,e]},q,'2026-10-21T20:00Z').id,e.id,'the closest one to the event date');
 const madrid={...fixture(),id:'401880001',competitions:[{...fixture().competitions[0],competitors:[{homeAway:'home',team:{displayName:'Real Madrid'}},{homeAway:'away',team:{displayName:'Juventus'}}]}]};
 assert.equal(identifyMatch({events:[e,madrid]},'real madrid contra juventus',e.date).id,'401880001');
 assert.equal(identifyMatch({events:[e]},'levante contra real madrid',e.date).id,e.id,'one team named is enough when nothing better exists');
 assert.equal(identifyMatch({events:[e]},'levante contra real madrid',e.date).bothTeams,false);
 assert.throws(()=>identifyMatch({events:[e]},'real madrid contra juventus',e.date),/No se encontró/);
});
test('Spanish names and partial names: Bayern de Múnich, Atlético de Madrid, Inter de Milán; a shared word alone is not enough',()=>{
 const game=(id,a,b)=>({...fixture(),id,competitions:[{...fixture().competitions[0],competitors:[{homeAway:'home',team:a},{homeAway:'away',team:b}]}]});
 const bayern=game('1',{displayName:'Bayern Munich',abbreviation:'BAY'},{displayName:'Club Brugge'});
 const atleti=game('2',{displayName:'Atlético Madrid',shortDisplayName:'Atlético'},{displayName:'Internazionale',shortDisplayName:'Inter Milan'});
 const betis=game('3',{displayName:'Real Betis'},{displayName:'Sevilla'});
 assert.equal(identifyMatch({events:[betis,bayern,atleti]},'Bayern de Múnich - Brujas','').id,'1');
 assert.equal(identifyMatch({events:[betis,bayern,atleti]},'Atlético de Madrid vs Inter de Milán','').id,'2');
 assert.throws(()=>identifyMatch({events:[betis]},'real madrid','')); // «real» is shared by many clubs
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

test('finished timestamp comes from the provider, never kickoff plus an estimated duration',async()=>{
 const {rememberMatch,matchExpired,matchDeadline}=await import('../web/match-scores.js');
 const e=fixture('post','STATUS_FULL_TIME',true),finish=Date.parse('2026-10-21T20:10:00Z');
 const result=matchResult({header:e,meta:{gameState:'post',lastPlayWallClock:new Date(finish).toISOString()}});
 assert.equal(result.finishedAt,finish);
 rememberMatch('90000001',result,finish+1000);
 assert.equal(matchDeadline('90000001'),finish+300000);
 assert.equal(matchExpired('90000001',finish+299999),false);
 assert.equal(matchExpired('90000001',finish+300000),true);
 assert.equal(matchResult(e).finishedAt,0);
});
test('missing end timestamp uses first detection without resetting its grace; a corrected final restores it',async()=>{
 const {rememberMatch,matchExpired,matchDeadline}=await import('../web/match-scores.js');
 const result=matchResult(fixture('post','STATUS_FULL_TIME',true)),now=1800000000000;
 rememberMatch('90000002',result,now);rememberMatch('90000002',result,now+290000);
 assert.equal(matchDeadline('90000002'),now+300000);
 assert.equal(matchExpired('90000002',now+300000),true);
 rememberMatch('90000002',matchResult(fixture()),now+300001);
 assert.equal(matchExpired('90000002',now+300002),false);
});
test('public events disappear at expiry while their catalog records and channels remain',async()=>{
 const {rememberMatch}=await import('../web/match-scores.js');
 const {events,merge}=await import('../web/catalog.js');
 const now=Date.now(),result=matchResult(fixture('post','STATUS_FULL_TIME',true));
 result.finishedAt=now-300001;rememberMatch('90000003',result,now);
 const data={channels:[{id:'c',name:'TV',streams:['https://example.com/live.m3u8']}],events:[{id:'e',name:'Game',channelId:'c',matchUrl:'https://share.google/a',matchId:'90000003'}]};
 assert.equal(events(merge(null,data),data).length,0);assert.equal(data.events.length,1);assert.equal(merge(null,data).length,1);
});

test('cancelled or abandoned fixtures are not treated as finished even when marked completed',()=>{
 assert.equal(matchResult(fixture('post','STATUS_CANCELED',true)).state,'cancelled');
 assert.equal(matchResult(fixture('post','STATUS_ABANDONED',true)).state,'suspended');
});

test('Google Club Brujas and Racing Club de Lens identify the ESPN Club Brugge–Lens fixture',()=>{
 const e=fixture();e.id='401915388';e.date='2026-10-21T19:00Z';
 e.competitions[0].competitors[0].team={displayName:'Club Brugge',name:'Club Brugge',shortDisplayName:'Club Brugge'};
 e.competitions[0].competitors[1].team={displayName:'Lens',name:'Lens',shortDisplayName:'Lens'};
 assert.equal(identifyMatch({events:[e]},'club brujas contra racing club de lens',e.date).id,'401915388');
 assert.equal(identifyMatch({events:[e]},'club brujas contra real madrid',e.date).bothTeams,false);
});

test('when the event day does not show both teams the three days around it are searched',async()=>{
 const e={...fixture(),date:'2026-10-23T18:00Z'},calls=[];
 const result=await resolveMatch('https://www.google.com/search?q=levante+contra+athletic+club','2026-10-21T18:00:00Z',async url=>{
   calls.push(url);return {ok:true,json:async()=>url.includes('-')&&url.includes('dates=20261018-20261024')?{events:[e]}:{events:[]}};
 });
 assert.equal(result.matchId,e.id);assert.equal(calls.length,2);assert.match(calls[1],/dates=20261018-20261024/);
});
