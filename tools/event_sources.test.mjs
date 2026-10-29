import test from 'node:test';
import assert from 'node:assert/strict';
import { zicoEventApi, eventPlayerSources, expandEventSources } from '../web/event-sources.js';
import { webPlayback } from '../web/catalog.js';
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
    assert.equal(new URL(url).hostname, 'calamarmenciano.com'); assert.equal(new URL(url).searchParams.get('event'), page); assert.equal(options.credentials, 'omit');
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

test('source names never show the address of the site the video comes from', () => {
  const found = eventPlayerSources({ data: { sources: [
    { name: 'DAZN LaLiga', player_url: 'https://a.example/api/player/1' },
    { name: 'bp.zicotv.cc', player_url: 'https://a.example/api/player/2' },
    { name: 'ZicoTV 2', player_url: 'https://a.example/api/player/3' },
  ] } });
  assert.deepEqual(found.map(s => s.name), ['DAZN LaLiga', 'Fuente del evento', 'Fuente del evento']);
});
