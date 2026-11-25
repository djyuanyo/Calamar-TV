import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumZicoIframe, zicoChannelPlayer, zicoPlayerIframe } from '../web/zico-channel.js';
import { merge, webPlayback } from '../web/catalog.js';
import { expandHostedSources } from '../web/hosted-sources.js';

test('channel pages resolve only their own id through the documented player', () => {
  for (const url of ['https://bp.zicotv.cc/channels/1', 'https://zicotv.cc/channels/1/?from=calendar#video']) {
    assert.equal(zicoChannelPlayer(url), 'https://bp.zicotv.cc/api/player/1');
    const playback = webPlayback(url, {pages:true});
    assert.equal(playback.kind, 'hls'); assert.equal(playback.renewable, true);
  }
  for (const url of ['http://bp.zicotv.cc/channels/1', 'https://bp.zicotv.cc.evil.test/channels/1',
    'https://u:p@bp.zicotv.cc/channels/1', 'https://bp.zicotv.cc:444/channels/1',
    'https://bp.zicotv.cc/channels/1/more', 'https://bp.zicotv.cc/channels/a', 'https://bp.zicotv.cc/events/1'])
    assert.equal(zicoChannelPlayer(url), null);
});

test('Zico frames use the official player and retain only the short-lived signature', () => {
  const player = 'https://bp.zicotv.cc/api/player/4';
  assert.equal(zicoPlayerIframe('https://zicotv.cc/channels/4?from=events'), player);
  assert.equal(zicoPlayerIframe('https://zicotv.cc/api/player/4/?token=private#video'), player);
  assert.equal(zicoPlayerIframe(player + '?st=signed&token=private'), player + '?st=signed');
  for (const address of [
    'https://bp.zicotv.cc.evil.test/api/player/4',
    'https://cdn.zicotv.cc/api/player/4',
    'http://bp.zicotv.cc/api/player/4',
    'https://bp.zicotv.cc:8443/api/player/4',
    'https://user:pass@bp.zicotv.cc/api/player/4',
    'https://bp.zicotv.cc/events/4',
    'https://cdn.zicotv.cc/live/index.m3u8',
  ]) assert.equal(zicoPlayerIframe(address), null);
});

test('saved channel pages enter the catalog as renewable players with duplicate links collapsed', () => {
  const channels = merge({channels:[]}, {channels:[{id:'mine', name:'Mi canal', streams:[
    'https://bp.zicotv.cc/channels/1', 'https://bp.zicotv.cc/api/player/1']} ]});
  assert.deepEqual(channels[0].streams, ['https://bp.zicotv.cc/api/player/1']);
});

test('premium iframe accepts only a signed link for the selected channel', async () => {
  const endpoint = 'https://calamarmenciano.com/calamar-player.php';
  const player = 'https://bp.zicotv.cc/api/player/4';
  const valid = player + '?st=sample-signature-with-encoded%2Fslash';
  const fetcher = url => async (request, options) => {
    const target = new URL(request);
    assert.equal(target.origin + target.pathname, endpoint);
    assert.equal(target.searchParams.get('zico_embed'), player);
    assert.equal(target.searchParams.get('zico_mode'), 'signed');
    assert.equal(options.method, 'GET');
    return Response.json({ zicoEmbed: 1, url });
  };
  assert.equal(await premiumZicoIframe(player + '?token=from-catalog', endpoint, { fetcher: fetcher(valid) }), valid);
  for (const url of [valid.replace('/4?', '/5?'), valid.replace('bp.zicotv.cc', 'example.com'), valid + '&other=1', player + '?token=private-reusable-key']) {
    await assert.rejects(premiumZicoIframe(player, endpoint, { fetcher: fetcher(url) }), /enlace Premium no válido/);
  }
});

test('raw event channel pages retain selectable hosted signals and origin for renewal', async () => {
  const page = 'https://bp.zicotv.cc/channels/1';
  const rows = await expandHostedSources([page], {fetcher:async address => {
    assert.equal(new URL(address).searchParams.get('page'), page);
    return {ok:true,json:async()=>({items:[{id:'0123456789abcdef',name:'LaLiga · Señal 1'}]})};
  }});
  assert.equal(rows[0].page, page);
  const playback = webPlayback(rows[0].url, {pages:true});
  assert.equal(playback.renewable, true);
  assert.equal(new URL(rows[0].url).searchParams.get('source_id'), '0123456789abcdef');
});
