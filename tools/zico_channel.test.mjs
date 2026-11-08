import test from 'node:test';
import assert from 'node:assert/strict';
import { zicoChannelPlayer } from '../web/zico-channel.js';
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

test('saved channel pages enter the catalog as renewable players with duplicate links collapsed', () => {
  const channels = merge({channels:[]}, {channels:[{id:'mine', name:'Mi canal', streams:[
    'https://bp.zicotv.cc/channels/1', 'https://bp.zicotv.cc/api/player/1']} ]});
  assert.deepEqual(channels[0].streams, ['https://bp.zicotv.cc/api/player/1']);
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
