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
test('empty events and failed requests remain retryable with a visible explanation', async () => {
  for (const response of [{ok:true,json:async()=>({data:{sources:[]}})}, {ok:false,status:503}]) {
    const result = await expandEventSources([page, player], {fetcher:async()=>response});
    assert.equal(result[0].url, page); assert.ok(result[0].error); assert.equal(result[1].url, player);
  }
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

test('fetches the documented public soccer endpoint without credentials', async () => {
  const result = await fetchZicoAgenda(async (url, options) => {
    assert.equal(url, 'https://bp.zicotv.cc/api/v1/events?sport=Soccer');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers, undefined);
    return { ok: true, json: async () => payload(row(1)) };
  });
  assert.equal(result.data[0].id, 1);
  await assert.rejects(fetchZicoAgenda(async () => ({ ok: false, status: 429 })), /429/);
});

test('publishes active football with crests and pending matches, and excludes premium sources', () => {
  const result = applyZicoAgenda(catalog, payload(
    row(1, { status: 'live', sources: [
      { type: 'direct', url: direct },
      { source: 'own', type: 'iframe', player_url: agendaPlayer },
      { type: 'iframe', url: agendaPlayer + '?token=private' },
      { type: 'direct', url: 'https://example.com/premium.m3u8', is_premium: true },
      { type: 'direct', url: 'https://example.com/locked.m3u8', locked: true },
    ] }),
    row(2), row(3, { status: 'finished' }), row(4, { status: 'cancelled' }),
    row(5, { sport_category: 'Basketball' }),
  ));
  assert.equal(result.count, 2);
  assert.equal(result.pending, 1);
  validateCatalog(result.data);
  const [live, scheduled] = events([], result.data, now);
  assert.deepEqual(live.streams, [agendaPlayer, direct]);
  assert.equal(live.startAt, '2026-11-04T20:00:00.000Z');
  assert.equal(live.homeLogo, cover);
  assert.equal(scheduled.pending, true);
});

test('refresh is idempotent, preserves manual changes, skips duplicates and removes ended feed entries', () => {
  const manual = { id: 'local', name: 'Evento propio', startAt: '2026-11-04T20:00:00Z', cover, streams: [direct] };
  const base = { ...catalog, events: [manual] };
  const first = payload(row(1), row(2), row(3, { title: manual.name }));
  const before = applyZicoAgenda(base, first).data;
  assert.deepEqual(applyZicoAgenda(before, first).data, before);
  before.events[1] = { ...before.events[1], name: 'Mi título', cover, streams: [direct] };
  const after = applyZicoAgenda(before, payload(row(1, { status: 'live' }), row(2, { status: 'finished' }))).data;
  assert.deepEqual(after.events.map(e => [e.name, e.streams]), [[manual.name, [direct]], ['Mi título', [direct]]]);
  assert.throws(() => applyZicoAgenda(before, { total: 2, data: [] }), /formato/);
});
