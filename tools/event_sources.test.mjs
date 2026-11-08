import test from 'node:test';
import assert from 'node:assert/strict';
import { zicoEventApi, eventPlayerSources, expandEventSources } from '../web/event-sources.js';
import { events, webPlayback } from '../web/catalog.js';
import { validateCatalog } from '../web/shared-catalog.js';
import { applyZicoAgenda, fetchZicoAgenda, zicoChannelSources } from '../web/zico-agenda.js';
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
const agendaChannel = 'https://bp.zicotv.cc/channels/8';
const ownSource = {source:'own',type:'iframe',url:agendaPlayer};
const direct = 'https://example.com/public.m3u8';
const row = (id, extra = {}) => ({
  id, title: `Equipo ${id} vs Visitante`, league: 'Liga de prueba', sport_category: 'Soccer',
  home_team: `Equipo ${id}`, away_team: 'Visitante', home_team_badge: cover,
  start_time: kickoff, status: 'scheduled', sources: [], ...extra,
});
const payload = (...data) => ({ total: data.length, data });
const catalog = { channels: [], events: [], featured: [], hidden: [] };

test('imports only declared own channels, preserving all alternatives and stripping credentials', () => {
  assert.deepEqual(zicoChannelSources({sources:[
    {source:'own',channel_id:8,url:agendaPlayer},
    {source:'own',channel_id:8,player_url:agendaPlayer+'?token=private'},
    {source:'own',channel_id:15,url:'https://bp.zicotv.cc/channels/15',locked:true,is_premium:true},
    {source:'own',channel_id:20},
    {source:'own',streams:[{channel_id:21,url:'https://bp.zicotv.cc/api/player/21'}]},
    {source:'manual',url:'https://bp.zicotv.cc/api/player/22'},
    {source:'manual',url:'https://example.com/embed'},
    {source:'own',channel_id:23,url:'https://example.com/api/player/23'},
    {source:'own',channel_id:24,url:'https://bp.zicotv.cc/api/player/25'},
    {source:'own',channel_id:26,url:'https://u:p@bp.zicotv.cc/api/player/26'},
    {source:'own',channel_id:27,url:'http://bp.zicotv.cc/api/player/27'},
    {source:'own',channel_id:0},
  ]}), [agendaChannel,'https://bp.zicotv.cc/channels/15','https://bp.zicotv.cc/channels/20','https://bp.zicotv.cc/channels/21']);
});

test('events with only external sources are omitted and their previous imported sources are removed', () => {
  const old = {id:'zico-event-1',name:'Evento anterior',cover:'',imported:true,
    streams:['https://bp.zicotv.cc/events/1'],zicoStreams:['https://bp.zicotv.cc/events/1']};
  const result = applyZicoAgenda({...catalog,events:[old]},payload(row(1,{sources:[
    {source:'manual',type:'direct',url:direct},
    {source:'sportsonline',type:'iframe',url:'https://example.com/other-player'},
  ]})));
  assert.equal(result.skipped,1);
  assert.deepEqual(result.data.events,[]);
});

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

test('publishes only own channel links across sports, with no private token', () => {
  const result = applyZicoAgenda(catalog, payload(
    row(1, { status: 'live', sources: [
      { type: 'direct', url: direct },
      { type: 'iframe', url: 'https://example.com/external' },
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
  assert.deepEqual(result.data.events.map(event => event.sport), ['Soccer', 'Basketball']);
  assert.equal(result.skipped, 1);
  validateCatalog(result.data);
  const [live, basketball] = events([], result.data, now);
  assert.deepEqual(live.streams, [agendaChannel]);
  assert.equal(live.startAt, '2026-11-04T20:00:00.000Z');
  assert.equal(live.homeLogo, cover);
  assert.deepEqual(basketball.streams, ['https://bp.zicotv.cc/channels/15']);
  assert.match(basketball.meta, /Baloncesto/);
});

test('refresh is idempotent, preserves manual changes, skips duplicates and removes ended feed entries', () => {
  const manual = { id: 'local', name: 'Evento propio', startAt: '2026-11-04T20:00:00Z', cover, streams: [direct] };
  const base = { ...catalog, events: [manual] };
  const listed = [ownSource];
  const first = payload(row(1, {sources:listed}), row(2, {sources:listed}), row(3, { title: manual.name }));
  const before = applyZicoAgenda(base, first).data;
  assert.deepEqual(applyZicoAgenda(before, first).data, before);
  before.events[1] = { ...before.events[1], name: 'Mi título', cover, streams: ['https://example.com/manual.m3u8'] };
  const after = applyZicoAgenda(before, payload(row(1, { status: 'live' }), row(2, { status: 'finished' }))).data;
  assert.deepEqual(after.events.map(e => [e.name, e.streams]), [[manual.name, [direct]], ['Mi título', ['https://example.com/manual.m3u8']]]);
  assert.throws(() => applyZicoAgenda(before, { total: 2, data: [] }), /formato/);
});

test('refresh replaces the old imported websites while keeping separately added links', () => {
  const official = 'https://bp.zicotv.cc/events/66520', ownLink = 'https://example.com/manual.m3u8';
  const event = { id: 'zico-event-66520', name: 'Mi evento', startAt: kickoff, cover,
    streams: [official, agendaPlayer, direct, ownLink], zicoStreams: [official, agendaPlayer, direct] };
  const feed = payload(row(66520, { sources: [ownSource] }));
  const updated = applyZicoAgenda({ ...catalog, events: [event] }, feed).data.events[0];
  assert.deepEqual(updated.streams, [agendaChannel, ownLink]);
  assert.deepEqual(updated.zicoStreams, [agendaChannel]);
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
  const updated = applyZicoAgenda(data, payload(row(2, {sources:[ownSource]}))).data;
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
  assert.deepEqual(result.data.fixtures[0], {...fixture, streams:[manual,agendaChannel],
    sport:'Soccer',zicoEventId:'7',zicoStreams:[agendaChannel]});
  validateCatalog(result.data);
  assert.deepEqual(applyZicoAgenda(result.data, feed).data, result.data);
  assert.deepEqual(applyZicoAgenda(result.data, payload({...match,sources:[]})).data.fixtures, [{...fixture,sport:'Soccer'}]);
});

test('leaves a manually created event intact and does not attach a signal from another competition', () => {
  const match = row(9, {title:'Real Madrid vs Liverpool',home_team:'Real Madrid',away_team:'Liverpool',
    league:'UEFA Champions League',sources:[ownSource]});
  const original = {id:'manual',name:'Real Madrid vs Liverpool',startAt:'2026-11-04T20:00:00Z',
    leagueId:'cup',cover,streams:['https://example.com/original.m3u8'],featured:true};
  const data = {...catalog, events:[original], leagues:[{id:'cup',name:'Champions League',espn:'uefa.champions'}]};
  const result = applyZicoAgenda(data,payload(match));
  assert.equal(result.linked, 1);
  assert.deepEqual(result.data.events[0], {...original, sport:'Soccer', zicoEventId:'9', zicoStreams:[agendaChannel],
    streams:[...original.streams,agendaChannel]});
  const other = applyZicoAgenda(data,payload({...match,league:'UEFA Europa League'}));
  assert.equal(other.linked, 0);
  assert.deepEqual(other.data.events[0], original);
});

test('repairs an imported Czech second division match while Spanish aliases still match Hypermotion', () => {
  const hypermotion = { id: 'espn-esp.2', name: 'LaLiga Hypermotion', espn: 'esp.2' };
  const czech = row(114025, { title: 'Dukla Prague - Pribram', league: 'Chequia: Segunda División', sources: [ownSource] });
  const spanish = row(4, { league: 'España: Segunda División', sources: [ownSource] });
  const official = 'https://bp.zicotv.cc/events/114025';
  const old = { id: 'zico-event-114025', name: czech.title, leagueId: hypermotion.id, cover,
    streams: [official, agendaPlayer], zicoStreams: [official, agendaPlayer], imported: true };
  const feed = payload(czech, spanish);
  const fresh = applyZicoAgenda({ ...catalog, leagues: [hypermotion], events: [old] }, feed).data;
  validateCatalog(fresh);
  assert.equal(fresh.events[0].leagueId, 'zico-liga-chequia-segunda-division');
  assert.equal(fresh.leagues.find(league => league.id === fresh.events[0].leagueId).name, czech.league);
  assert.deepEqual(fresh.events[0].streams, [agendaChannel]);
  assert.equal(fresh.events[0].cover, cover);
  assert.equal(fresh.events[1].leagueId, hypermotion.id);
  assert.deepEqual(applyZicoAgenda(fresh, feed).data, fresh);
});

test('keeps foreign, generic and women’s divisions separate from similarly named domestic leagues', () => {
  const leagues = [
    { id: 'esp-2', name: 'LaLiga Hypermotion', espn: 'esp.2' },
    { id: 'esp-w', name: 'Liga F', espn: 'esp.w.1' },
    { id: 'ita-1', name: 'Serie A', espn: 'ita.1' },
    { id: 'fra-1', name: 'Ligue 1', espn: 'fra.1' },
  ];
  const names = ['Segunda División', 'Chequia: Primera División Femenina', 'Serie A', 'Ecuador: Serie A',
    'Italia: Serie A', 'French Ligue 1', 'Algerian Ligue 1', 'Spanish La Liga 2'];
  const feed = payload(...names.map((league, i) => row(i + 1, { league, sources: [ownSource] })));
  const { data } = applyZicoAgenda({ ...catalog, leagues }, feed);
  assert.deepEqual(data.events.map(event => event.leagueId), ['zico-liga-segunda-division',
    'zico-liga-chequia-primera-division-femenina', 'zico-liga-serie-a', 'zico-liga-ecuador-serie-a',
    'ita-1', 'fra-1', 'zico-liga-algerian-ligue-1', 'esp-2']);
  validateCatalog(data);
});

test('attaches both Spanish divisions to existing fixtures and removes unused Zico leagues', () => {
  const first = { id: 'first', name: 'LaLiga EA Sports', espn: 'esp.1' };
  const second = { id: 'second', name: 'LaLiga Hypermotion', espn: 'esp.2' };
  const duplicateFirst = { id: 'zico-liga-spanish-la-liga', name: 'Spanish La Liga' };
  const duplicateSecond = { id: 'zico-liga-spanish-la-liga-2', name: 'Spanish La Liga 2' };
  const teams = [{ id: 'osasuna', name: 'Osasuna' }, { id: 'athletic', name: 'Athletic Club' },
    { id: 'burgos', name: 'Burgos' }, { id: 'celta', name: 'RC Celta Fortuna' }];
  const official = id => 'https://bp.zicotv.cc/events/' + id;
  const manual = 'https://example.com/manual.m3u8';
  const fixtures = [
    { id: 'partido-1', matchId: '1', leagueId: first.id, homeTeamId: 'osasuna', awayTeamId: 'athletic',
      startAt: new Date(kickoff).toISOString(), streams: [manual, official(10)], zicoEventId: '10', zicoStreams: [official(10)] },
    { id: 'partido-2', matchId: '2', leagueId: second.id, homeTeamId: 'burgos', awayTeamId: 'celta',
      startAt: new Date(kickoff).toISOString() },
  ];
  const eventsBefore = [{ id: 'zico-event-11', name: 'Osasuna vs Athletic Bilbao', leagueId: duplicateFirst.id,
    streams: [official(11)], zicoStreams: [official(11)], cover: '', imported: true }];
  const sources = [ownSource];
  const leagueRow = (id, league, home, away) => row(id, { league, title: home + ' vs ' + away,
    home_team: home, away_team: away, sources });
  const feed = payload(leagueRow(10, 'DAZN', 'Osasuna', 'Athletic Club'),
    leagueRow(11, 'Spanish La Liga', 'Osasuna', 'Athletic Bilbao'),
    leagueRow(12, 'Spanish La Liga 2', 'Burgos', 'Celta Fortuna'));
  const { data, linked } = applyZicoAgenda({ ...catalog, teams, fixtures, events: eventsBefore,
    leagues: [first, second, duplicateFirst, duplicateSecond],
    leagueOrder: [second.id, duplicateFirst.id, first.id, duplicateSecond.id] }, feed);
  assert.equal(linked, 2);
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.leagues, [first, second]);
  assert.deepEqual(data.leagueOrder, [second.id, first.id]);
  assert.deepEqual(data.fixtures.map(fixture => [fixture.leagueId, fixture.streams]),
    [[first.id, [manual, agendaChannel]], [second.id, [agendaChannel]]]);
  validateCatalog(data);
  assert.deepEqual(applyZicoAgenda(data, feed).data, data);
});

test('links Liga F and the four cups to the existing competition fixtures', () => {
  const examples = [
    ['esp.w.1', 'Liga F', 'Spanish Liga F', 'Granada', 'Espanyol', 'Granada Femenino', 'Espanyol Femení'],
    ['uefa.champions', 'Champions League', 'Europa: Champions League', 'Liverpool', 'Real Madrid'],
    ['uefa.europa', 'Europa League', 'UEFA Europa League', 'Betis', 'Porto'],
    ['uefa.europa.conf', 'Conference League', 'Europa/Conference League', 'Rayo Vallecano', 'Fiorentina'],
    ['esp.copa_del_rey', 'Copa del Rey', 'Spanish Copa del Rey', 'Osasuna', 'Athletic Club', 'Osasuna', 'Athletic Bilbao'],
  ];
  const leagues = [], teams = [], fixtures = [], rows = [];
  for (const [index, [code, name, label, home, away, feedHome = home, feedAway = away]] of examples.entries()) {
    const id = index + 1;
    leagues.push({ id: code, espn: code, name }, { id: 'zico-liga-' + code, name: label });
    teams.push({ id: 'home-' + id, name: home }, { id: 'away-' + id, name: away });
    fixtures.push({ id: 'partido-' + id, matchId: String(id), leagueId: code, homeTeamId: 'home-' + id,
      awayTeamId: 'away-' + id, startAt: new Date(kickoff).toISOString() });
    rows.push(row(id, { league: label, title: feedHome + ' vs ' + feedAway, home_team: feedHome,
      away_team: feedAway, sources: [ownSource] }));
  }
  const distinct = row(6, { league: 'Europa: Champions League - Femenino', sources: [ownSource] });
  const { data, linked } = applyZicoAgenda({ ...catalog, leagues, teams, fixtures }, payload(...rows, distinct));
  validateCatalog(data);
  assert.equal(linked, 5);
  assert.deepEqual(data.fixtures.map(fixture => [fixture.leagueId, ...fixture.streams]),
    examples.map(([code]) => [code, agendaChannel]));
  assert.equal(data.leagues.length, 6);
  assert.deepEqual(data.events.map(event => event.leagueId), ['zico-liga-europa-champions-league-femenino']);
});


test('agenda refresh removes unused generated entities before the catalog exceeds its storage limit', () => {
  const manualTeam = { id: 'my-team', name: 'Mi equipo', leagueId: 'zico-liga-kept-for-team' };
  const linkedTeam = { id: 'zico-equipo-linked', name: 'Equipo enlazado' };
  const espnTeam = { id: 'zico-equipo-espn', name: 'Equipo de ESPN', espnId: '42' };
  const manualLeague = { id: 'my-league', name: 'Mi liga' };
  const fixture = { id: 'fixture', matchId: '1', leagueId: manualLeague.id,
    homeTeamId: linkedTeam.id, awayTeamId: manualTeam.id, startAt: new Date(kickoff).toISOString() };
  const leagues = [manualLeague, { id: 'zico-liga-old', name: 'Liga antigua' },
    { id: 'zico-liga-kept-for-team', name: 'Liga de mi equipo' },
    { id: 'zico-liga-espn', name: 'Liga conectada a ESPN', espn: 'esp.1' }];
  const base = { ...catalog, leagues, leagueOrder: leagues.map(league => league.id), fixtures: [fixture],
    teams: [manualTeam, linkedTeam, espnTeam, ...Array.from({ length: 4000 }, (_, i) => ({
      id: 'zico-equipo-old-' + i, name: 'Equipo de una agenda anterior ' + i,
      logo: 'https://example.com/old-team-' + i + '.png', leagueId: 'zico-liga-old',
    }))] };
  assert.throws(() => validateCatalog(base), /tamaño/);
  const original = structuredClone(base);
  const feed = payload(row(1, { sources: [ownSource] }));
  const refreshed = applyZicoAgenda(base, feed).data;
  validateCatalog(refreshed);
  assert.deepEqual(base, original);
  assert.deepEqual(refreshed.fixtures, base.fixtures);
  for (const kept of [manualTeam, linkedTeam, espnTeam]) assert.deepEqual(refreshed.teams.find(t => t.id === kept.id), kept);
  assert.ok(!refreshed.teams.some(team => team.id.startsWith('zico-equipo-old-')));
  assert.ok(!refreshed.leagues.some(league => league.id === 'zico-liga-old'));
  assert.deepEqual(refreshed.leagueOrder, [manualLeague.id, 'zico-liga-kept-for-team', 'zico-liga-espn']);
  assert.equal(refreshed.events.length, 1);
  const event = refreshed.events[0];
  assert.ok(refreshed.teams.some(team => team.id === event.homeTeamId));
  assert.deepEqual(applyZicoAgenda(refreshed, feed).data, refreshed);
});
