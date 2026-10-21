import assert from 'node:assert/strict';
import test from 'node:test';
import { madridInstant, localDateTime, eventPath, eventShareLink } from '../web/sports.js';
import { events, eventRows, eventSlugs, groups, homeHighlights, merge, categoryList, resolveCategory, defaultColor } from '../web/catalog.js';
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
test('event links use the slug of the event name, like channels, and ignore the chosen channel',()=>{
  const data=make(); const before=events(merge(null,data),data)[0];
  assert.equal(eventPath(before),'#/evento/partido');
  assert.equal(eventShareLink(before),'https://djyuanyo.github.io/Calamar-TV/evento/partido/');
  data.channels[0]={...channel,name:'Otro canal'};
  assert.equal(eventPath(events(merge(null,data),data)[0]),'#/evento/partido');
  data.events[0].name='Final de Copa: Menciana–Ñora';
  const after=events(merge(null,data),data)[0];
  assert.equal(eventPath(after),'#/evento/final-de-copa-menciana-nora');
  assert.match(after.meta,/Mi Liga/); assert.match(after.meta,/01\/12\/2026/);
});
test('repeated event names get -2, -3 in date order, whatever their channel',()=>{
  const data=make(); data.events.push({...data.events[0],id:'later',startAt:'2026-12-08T20:00:00Z'},{...data.events[0],id:'earlier',startAt:'2026-11-01T20:00:00Z'});
  assert.deepEqual([...eventSlugs(data)],[['earlier','partido'],['match','partido-2'],['later','partido-3']]);
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
test('home rows group events by league in date order, events without league last',()=>{
  const data=make(); data.leagues.push({id:'copa',name:'Copa',logo:'https://example.com/copa.png'});
  data.events.push({...data.events[0],id:'cup',leagueId:'copa',startAt:'2026-11-15T20:00:00Z',featured:false},{...data.events[0],id:'free',leagueId:'',startAt:'2026-10-01T20:00:00Z',featured:false},{...data.events[0],id:'early',startAt:'2026-11-20T20:00:00Z',featured:false});
  const rows=eventRows(events(merge(null,data),data),data);
  assert.deepEqual(rows.map(r=>r.name),['Copa','Mi Liga','Otros eventos']);
  assert.deepEqual(rows.map(r=>r.events.map(e=>e.id)),[['cup'],['early','match'],['free']]);
  assert.equal(rows[0].logo,'https://example.com/copa.png'); assert.equal(rows[1].logo,'');
});
test('category order saved by the administrator comes first, unknown categories after',()=>{
  const list=[{group:'Deportes'},{group:'Zeta'},{group:'Calamar TV'},{group:'Alfa'}];
  assert.deepEqual([...groups(list).keys()],['Calamar TV','Deportes','Alfa','Zeta']);
  assert.deepEqual([...groups(list,['Zeta','Deportes']).keys()],['Zeta','Deportes','Calamar TV','Alfa']);
  const data=make(); data.groupOrder=['Zeta','Deportes']; validateCatalog(data);
  for (const bad of [['A','A'],[''],[1],'Deportes']) { data.groupOrder=bad; assert.throws(()=>validateCatalog(data)); }
});
test('each category has one colour for all its cards, and can be renamed, recoloured and reordered',()=>{
  const tdt={channels:[{id:'gol',name:'Gol',group:'Deportes',streams:['https://example.com/g.m3u8']},{id:'tele',name:'Tele',group:'Deportes',streams:['https://example.com/t.m3u8']},{id:'la-1',name:'La 1',group:'Generalistas',streams:['https://example.com/l.m3u8']}]};
  let all=merge(tdt,{channels:[],featured:[],hidden:[]});
  assert.equal(all[0].color,'#1d7a40'); assert.equal(all[1].color,all[0].color); assert.equal(all[2].color,'#1f4f8f');
  assert.equal(defaultColor('Cine'),defaultColor('Cine')); assert.match(defaultColor('Cine'),/^#[0-9a-f]{6}$/);
  const custom={channels:[{id:'mine',name:'Mio',group:'Cine',streams:['https://example.com/m.m3u8']}],featured:[],hidden:[],categories:[{id:'Cine',name:'Cine',color:'#123456'},{id:'Deportes',name:'Fútbol',color:'#aa0000'},{id:'Generalistas',name:'Generalistas',color:'#1f4f8f'}]};
  validateCatalog(custom); all=merge(tdt,custom);
  assert.deepEqual(all.map(c=>[c.id,c.group,c.color,c.category]),[['mine','Cine','#123456','Cine'],['gol','Fútbol','#aa0000','Deportes'],['tele','Fútbol','#aa0000','Deportes'],['la-1','Generalistas','#1f4f8f','Generalistas']]);
  assert.deepEqual([...groups(all,categoryList(custom).map(c=>c.name)).keys()],['Cine','Fútbol','Generalistas']);
  assert.equal(resolveCategory('Fútbol',categoryList(custom)).id,'Deportes');
  for (const bad of [[{id:'a',name:'A',color:'red'}],[{id:'a',name:'A',color:'#000000'},{id:'b',name:'a',color:'#000000'}],[{id:'',name:'A',color:'#000000'}]]) { custom.categories=bad; assert.throws(()=>validateCatalog(custom)); }
});
