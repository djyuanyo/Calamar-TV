import test from 'node:test';
import assert from 'node:assert/strict';
import {hlsContinuity} from '../web/hls-continuity.js';
const signed=(path,token,host='cdn.example')=>'https://calamarmenciano.com/calamar-player.php?seg='+Buffer.from(`https://${host}/${path}?token=${token}`).toString('base64url')+'&sig='+token;
test('renews master, quality and audio playlists without rewriting segments or changing CDN',()=>{
  const old=signed('index.m3u8','old'), fresh=signed('index.m3u8','fresh'), session=hlsContinuity(old);
  const video=signed('video.m3u8','fresh'), audio=signed('audio.m3u8','fresh');
  assert.ok(session.update(fresh,`#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="${audio}"\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n${video}\n`));
  assert.equal(session.resolve(old),fresh);
  assert.equal(session.resolve(signed('video.m3u8','old')),video);
  assert.equal(session.resolve(signed('audio.m3u8','old')),audio);
  const segment=signed('part.ts','old'); assert.equal(session.resolve(segment),segment);
  assert.equal(session.update(signed('index.m3u8','other','other.example'),'#EXTM3U\n'),false);
  assert.equal(session.resolve(old),fresh);
  assert.equal(session.update(fresh,'<html>Error</html>'),false);
});
