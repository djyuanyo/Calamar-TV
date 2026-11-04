import test from 'node:test';
import assert from 'node:assert/strict';
import { zicoEventApi, eventPlayerSources, expandEventSources } from '../web/event-sources.js';
import { events, webPlayback } from '../web/catalog.js';
import { validateCatalog } from '../web/shared-catalog.js';
import { applyZicoAgenda, fetchZicoAgenda } from '../web/zico-agenda.js';
const page = 'https://bp.zicotv.cc/events/98019';
const player = 'https://bp.zicotv.cc/api/player/22';
const data = { data: { sources: [{ name: 'LaLiga 2', player_url: player }, { url: player }, { is_premium: true, url: 'https://example.com/premium.m3u8' }, { url: 'javascript:alert(1)' }, { url: page }] } };
test('event URLs resolve through public API, never an iframe of the event page', () => {
  assert.equal(zicoEventApi(page), 'https://bp.zicotv.cc/api/v1/events/98019');
  assert.equal(webPlayback(page, {pages:true}).kind, 'event');
  assert.equal(webPlayback(player, {pages:true}).renewable, true);
  for (const bad of ['https://zicotv.cc.evil.com/events/1', 'https://u:p@bp.zicotv.cc/events/1', 'http://bp.zicotv.cc/events/1']) assert.equal(zicoEventApi(bad), null);
});
test('only public valid players, deduplicated and named', () => {
  assert.deepEqual(eventPlayerSources(data), [{url:player, name:'LaLiga 2'}]);
});
test('manual event expands while existing sources and selection origin are preserved', async () => {
  const result = await expandEventSources(['https://example.com/live.m3u8', page], {fetcher:async (url, options) => {
    assert.equal(url, zicoEventApi(page)); assert.equal(options.credentials, 'omit');
    return {ok:true,json:async()=>data};
  }});
  assert.equal(result.length, 2); assert.equal(result[1].url, player); assert.equal(result[1].origin, page);
});
test('an empty source list is distinct from a temporary failure and leaves fallbacks intact', async () => {
  const empty = {ok:true,json:async()=>({data:{sources:[]}})};
  const down = {ok:false,status:503};
  const result = await expandEventSources([page, player], {fetcher:async()=>empty});
  assert.deepEqual(result, [{url:page, unavailable:true}, {url:player}]);
  assert.match((await expandEventSources([page], {fetcher:async()=>down}))[0].error, /503/);
  const premium = await expandEventSources([page], {preferHosted:true,
    fetcher:async url => url.startsWith('https://calamarmenciano.com/') ? down : empty});
  assert.ok(premium[0].error);
  assert.equal(premium[0].unavailable, undefined);
});

const now = Date.parse('2026-11-04T19:00:00Z');
const kickoff = '2026-11-04T21:00:00+01:00';
const cover = 'https://example.com/crest.png';
const agendaPlayer = 'https://bp.zicotv.cc/api/player/8';
const direct = 'https://example.com/public.m3u8';
const row = (id, extra = {}) => ({
  id, title: `Equipo ${id} vs Visitante`, league: 'Liga de prueba', sport_category: 'Soccer',
  home_team: `Equipo ${id}`, away_team: 'Visitante', home_team_badge: cover,
  start_time: kickoff, status: 'scheduled', sources: [], ...extra,
});
const payload = (...data) => ({ total: data.length, data });
const catalog = { channels: [], events: [], featured: [], hidden: [] };

test('fetches the documented all-sports endpoint without credentials', async () => {
  const result = await fetchZicoAgenda(async (url, options) => {
    assert.equal(url, 'https://bp.zicotv.cc/api/v1/events');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined);
    return { ok: true, json: async () => payload(row(1)) };
  });
  assert.equal(result.data[0].id, 1);
  await assert.rejects(fetchZicoAgenda(async () => ({ ok: false, status: 429 })), /429/);
});

test('publishes active events across sports, with fresh lookup links and no private token', () => {
  const result = applyZicoAgenda(catalog, payload(
    row(1, { status: 'live', sources: [
      { type: 'direct', url: direct },
      { source: 'own', type: 'iframe', player_url: agendaPlayer },
      { type: 'iframe', url: agendaPlayer + '?token=private' },
      { type: 'direct', url: 'https://example.com/premium.m3u8', is_premium: true },
      { type: 'direct', url: 'https://example.com/locked.m3u8', locked: true },
    ] }),
    row(2), row(3, { status: 'finished' }), row(4, { status: 'cancelled' }),
    row(5, { sport_category: 'Basketball', league: '', sources: [
      { source: 'own', type: 'iframe', url: 'https://bp.zicotv.cc/api/player/15', is_premium: true },
    ] }),
  ));
  assert.equal(result.count, 2);
  assert.equal(result.skipped, 1);
  validateCatalog(result.data);
  const [live, basketball] = events([], result.data, now);
  assert.deepEqual(live.streams, ['https://bp.zicotv.cc/events/1', agendaPlayer, direct]);
  assert.equal(live.startAt, '2026-11-04T20:00:00.000Z');
  assert.equal(live.homeLogo, cover);
  assert.deepEqual(basketball.streams, ['https://bp.zicotv.cc/events/5', 'https://bp.zicotv.cc/api/player/15']);
  assert.match(basketball.meta, /Baloncesto/);
});

test('refresh is idempotent, preserves manual changes, skips duplicates and removes ended feed entries', () => {
  const manual = { id: 'local', name: 'Evento propio', startAt: '2026-11-04T20:00:00Z', cover, streams: [direct] };
  const base = { ...catalog, events: [manual] };
  const listed = [{type:'direct', url:direct}];
  const first = payload(row(1, {sources:listed}), row(2, {sources:listed}), row(3, { title: manual.name }));
  const before = applyZicoAgenda(base, first).data;
  assert.deepEqual(applyZicoAgenda(before, first).data, before);
  before.events[1] = { ...before.events[1], name: 'Mi título', cover, streams: ['https://example.com/manual.m3u8'] };
  const after = applyZicoAgenda(before, payload(row(1, { status: 'live' }), row(2, { status: 'finished' }))).data;
  assert.deepEqual(after.events.map(e => [e.name, e.streams]), [[manual.name, [direct]], ['Mi título', ['https://bp.zicotv.cc/events/1', 'https://example.com/manual.m3u8']]]);
  assert.throws(() => applyZicoAgenda(before, { total: 2, data: [] }), /formato/);
});

test('managed agenda events prefer hosting and keep public and catalog fallbacks', async () => {
  const result = await expandEventSources([page, player], { preferHosted: true, fetcher: async url => ({
    ok: true, json: async () => url.startsWith('https://calamarmenciano.com/')
      ? { data: { sources: [{ name: 'Premium', player_url: agendaPlayer }] } }
      : data,
  }) });
  assert.deepEqual(result.map(source => source.url), [agendaPlayer, player]);
  assert.equal(result[0].origin, page);
});

test('legacy agenda lookup-only events stay out of public lists until a source exists', () => {
  const item = { id:'zico-event-2', name:'Sin señal', startAt:new Date(now).toISOString(), imported:true,
    streams:['https://bp.zicotv.cc/events/2'] };
  const data = {...catalog, events:[item]};
  assert.deepEqual(events([], data, now, {allWeeks:true, finished:true}), []);
  const updated = applyZicoAgenda(data, payload(row(2, {sources:[{type:'direct',url:direct}]}))).data;
  assert.equal(events([], updated, now)[0].id, item.id);
  assert.equal(applyZicoAgenda(updated, payload(row(2))).data.events.length, 0);
});

test('reuses an existing league and links the matching ESPN fixture, preserving its manual signal', () => {
  const espnLeague = {id:'espn-uefa.europa', name:'Europa League', espn:'uefa.europa'};
  const teams = [{id:'home',name:'Anderlecht'}, {id:'away',name:'RB Salzburg'}];
  const manual = 'https://example.com/manual.m3u8';
  const fixture = {id:'partido-123',matchId:'123',leagueId:espnLeague.id,homeTeamId:'home',awayTeamId:'away',
    startAt:'2026-11-04T20:05:00.000Z',streams:[manual],round:'Jornada 4'};
  const base = {...catalog, leagues:[espnLeague], teams, fixtures:[fixture],
    events:[{id:'zico-event-7',name:'Duplicado de ZicoTV',cover:'',imported:true,streams:[direct]}]};
  const signal = {source:'own',type:'iframe',player_url:agendaPlayer};
  const match = row(7, {title:'Anderlecht vs Red Bull Salzburg', home_team:'Anderlecht', away_team:'Red Bull Salzburg',
    league:'UEFA Europa League', sources:[signal]});
  const unrelated = row(8, {title:'Otro partido',league:'UEFA Europa League',sources:[signal]});
  const feed = payload(match, unrelated);
  const result = applyZicoAgenda(base, feed);
  assert.equal(result.linked, 1);
  assert.equal(result.data.events.length, 1);
  assert.equal(result.data.events[0].leagueId, espnLeague.id);
  assert.deepEqual(result.data.leagues, [espnLeague]);
  assert.deepEqual(result.data.fixtures[0], {...fixture, streams:[manual,'https://bp.zicotv.cc/events/7',agendaPlayer],
    zicoEventId:'7',zicoStreams:['https://bp.zicotv.cc/events/7',agendaPlayer]});
  validateCatalog(result.data);
  assert.deepEqual(applyZicoAgenda(result.data, feed).data, result.data);
  assert.deepEqual(applyZicoAgenda(result.data, payload({...match,sources:[]})).data.fixtures, [fixture]);
});

test('leaves a manually created event intact and does not attach a signal from another competition', () => {
  const match = row(9, {title:'Real Madrid vs Liverpool',home_team:'Real Madrid',away_team:'Liverpool',
    league:'UEFA Champions League',sources:[{type:'direct',url:direct}]});
  const original = {id:'manual',name:'Real Madrid vs Liverpool',startAt:'2026-11-04T20:00:00Z',
    leagueId:'cup',cover,streams:['https://example.com/original.m3u8'],featured:true};
  const data = {...catalog, events:[original], leagues:[{id:'cup',name:'Champions League',espn:'uefa.champions'}]};
  const result = applyZicoAgenda(data,payload(match));
  assert.equal(result.linked, 1);
  assert.deepEqual(result.data.events[0], {...original, zicoEventId:'9', zicoStreams:['https://bp.zicotv.cc/events/9',direct],
    streams:[...original.streams,'https://bp.zicotv.cc/events/9',direct]});
  const other = applyZicoAgenda(data,payload({...match,league:'UEFA Europa League'}));
  assert.equal(other.linked, 0);
  assert.deepEqual(other.data.events[0], original);
});
