import test from 'node:test';
import assert from 'node:assert/strict';
import { APK_DOWNLOAD } from '../web/app-links.js';
import { withArtwork, keepArtwork } from '../web/library-art.js';
test('download uses the fixed signed asset of the latest release', () => {
  assert.equal(APK_DOWNLOAD, 'https://github.com/djyuanyo/Calamar-TV/releases/latest/download/Calamar-TV.apk');
});
test('artwork changes preserve film links, episodes and metadata through TMDB refreshes', () => {
  const item = {id:'s1', episodes:[{url:'https://example.com/1.mp4'}], skip:{intro:[30,90]}, tmdb:{id:1,title:'Serie',poster:'old'}};
  const changed = withArtwork(item, {poster:'https://example.com/new.jpg',backdrop:'data:image/jpeg;base64,YQ=='});
  assert.deepEqual(changed.episodes, item.episodes);
  assert.deepEqual(changed.skip, item.skip);
  assert.equal(changed.tmdb.title, 'Serie');
  assert.equal(keepArtwork(changed, {...item,tmdb:{...item.tmdb,poster:'TMDB'}}).tmdb.poster, 'https://example.com/new.jpg');
  const cleared = withArtwork(changed, {poster:'',backdrop:''});
  assert.equal(keepArtwork(cleared,item).tmdb.poster,'');
  for (const poster of ['http://example.com/a.jpg','javascript:alert(1)','data:image/svg+xml;base64,YQ==','https://user:pass@example.com/a']) assert.throws(()=>withArtwork(item,{poster}));
});
