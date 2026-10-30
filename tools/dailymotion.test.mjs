import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailymotionEmbed } from '../web/dailymotion.js';
import { webPlayback } from '../web/catalog.js';
const url = 'https://geo.dailymotion.com/player/x1k3pa.html?video=k5cyQ3rl70nCl7Fhb5W';
test('Dailymotion uses the requested official player and video, without sending it to the channel resolver', () => {
  assert.equal(dailymotionEmbed(url),url);
  assert.deepEqual(webPlayback(url,{pages:true}),{ok:true,kind:'frame',page:true,provider:'dailymotion',address:url});
  assert.equal(webPlayback(url).kind,'frame');
  for (const invalid of [url.replace('https:','http:'),url.replace('geo.dailymotion.com','geo.dailymotion.com.evil.example'),url.replace('video=','missing='),url+'#extra',url.replace('https://','https://user:password@')]) assert.equal(dailymotionEmbed(invalid),null);
});
