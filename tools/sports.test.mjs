import assert from 'node:assert/strict';
import test from 'node:test';
import { madridInstant, localDateTime, eventPath } from '../web/sports.js';
import { events, homeHighlights, merge } from '../web/catalog.js';
import { validateCatalog } from '../web/shared-catalog.js';
const channel = { id:'sports', name:'Sports', streams:['https://example.com/live.m3u8'] };
const make = () => ({ channels:[channel], featured:['sports'], hidden:[], leagues:[{id:'liga',name:'Mi Liga'}], teams:[{id:'home',name:'Local',leagueId:'liga'},{id:'away',name:'Visitante'}], events:[{id:'match',name:'Partido',cover:'https://example.com/photo.jpg',channelId:'sports',leagueId:'liga',homeTeamId:'home',awayTeamId:'away',startAt:'2026-12-01T20:00:00.000Z',featured:true}] });
test('Madrid time converts winter and summer and round trips',()=>{
  assert.equal(madridInstant('2026-12-01T21:00'),'2026-12-01T20:00:00.000Z');
  assert.equal(madridInstant('2026-07-01T21:00'),'2026-07-01T19:00:00.000Z');
  assert.equal(localDateTime('2026-07-01T19:00:00.000Z'),'2026-07-01T21:00');
  assert.throws(()=>madridInstant('2026-03-29T02:30'));
  assert.throws(()=>madridInstant('2026-02-30T21:00'));
});
test('permalink is independent of event name and chosen channel',()=>{
  const data=make(); const before=events(merge(null,data),data)[0];
  data.events[0].name='Otro partido';data.channels[0]={...channel,name:'Otro canal'};
  const after=events(merge(null,data),data)[0];
  assert.equal(eventPath(before),eventPath(after)); assert.equal(eventPath(after),'#/evento/match');
  assert.match(after.meta,/Mi Liga/); assert.match(after.meta,/01\/12\/2026/);
});
test('chronological events, unscheduled last; highlighted channels and events coexist',()=>{
  const data=make(); data.events.push({...data.events[0],id:'earlier',startAt:'2026-11-01T20:00:00Z',featured:false},{...data.events[0],id:'legacy',startAt:'',featured:false});
  const all=merge(null,data);assert.deepEqual(events(all,data).map(e=>e.id),['earlier','match','legacy']);
  assert.deepEqual(homeHighlights(all,data).map(e=>e.id),['match','sports']);
  data.featured=[];data.events[0].featured=false;assert.equal(homeHighlights(all,data).length,1);
});
test('validates relationships, repeated teams, dates and featured types',()=>{
  validateCatalog(make());
  for (const change of [{leagueId:'missing'},{homeTeamId:'missing'},{awayTeamId:'home'},{startAt:'wrong'},{startAt:false},{startAt:'2026-02-30T20:00:00Z'},{featured:'true'},{status:'wrong'}]) {
    const data=make();Object.assign(data.events[0],change);assert.throws(()=>validateCatalog(data));
  }
  const data=make();data.teams[0].leagueId='missing';assert.throws(()=>validateCatalog(data));
});
