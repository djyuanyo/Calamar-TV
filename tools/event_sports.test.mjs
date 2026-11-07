import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventSport, eventSportTabs } from '../web/event-sports.js';
const definitions = JSON.parse(readFileSync(new URL('../data/sports.json', import.meta.url)));
const custom = { leagues: [{id:'football',name:'LaLiga EA Sports',espn:'esp.1'}, {id:'basket',name:'NBA'},
  {id:'unknown',name:'Mi competición'}, {id:'misleading',name:'NBA',sport:'Tennis'}] };
test('explicit source sports take precedence over league names and legacy events keep known classifications', () => {
  assert.equal(eventSport({leagueId:'basket'},custom,definitions),'basketball');
  assert.equal(eventSport({leagueId:'football'},custom,definitions),'soccer');
  assert.equal(eventSport({leagueId:'misleading'},custom,definitions),'tennis');
  assert.equal(eventSport({sport:'American Football',leagueId:'basket'},custom,definitions),'american-football');
  assert.equal(eventSport({sport:'FÚTBOL'},custom,definitions),'soccer');
  assert.equal(eventSport({leagueId:'unknown'},custom,definitions),'other');
  assert.equal(eventSport({sport:'Other',leagueId:'football'},custom,definitions),'other');
});
test('tabs count the supplied events and include only represented sports, with an All total', () => {
  const events = [{leagueId:'football'}, {sport:'Soccer'}, {leagueId:'basket'}, {leagueId:'unknown'}];
  const tabs = eventSportTabs(events,custom,definitions);
  assert.deepEqual(tabs.map(tab=>[tab.id,tab.count]),[['all',4],['soccer',2],['basketball',1],['other',1]]);
  assert.equal(tabs.slice(1).reduce((sum,tab)=>sum+tab.count,0),events.length);
  assert.deepEqual(eventSportTabs([],custom,definitions).map(tab=>[tab.id,tab.count]),[['all',0]]);
});
