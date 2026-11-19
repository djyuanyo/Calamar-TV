import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSource, mount } from '../web/direct-player.js';
import { webPlayback } from '../web/catalog.js';

test('preserves signed URL including percent escapes, plus and ampersand', () => {
  const url = 'https://cdn.example/live/INDEX.M3U8?token=a%2Bb%2Fc-1799999999-&x=1+2';
  assert.equal(readSource('#' + encodeURIComponent(url)), url);
  for (const bad of ['javascript:alert(1)', 'http://a.test/x.m3u8', 'https://a.test/x.mpd', 'https://u:p@a.test/x.m3u8'])
    assert.equal(readSource('#' + encodeURIComponent(bad)), null);
  assert.equal(readSource('#%ZZ'), null);
});

function fixture(url) {
  const instances = [];
  class Hls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
    static isSupported = () => true;
    events = {};
    constructor() { instances.push(this); }
    on(event, callback) { this.events[event] = callback; }
    loadSource(url) { this.url = url; }
    attachMedia() {}
    stopLoad() { this.stopped = true; }
    destroy() { this.destroyed = true; }
  }
  const button = () => ({ addEventListener(_name, callback) { this.click = callback; }, focus() {} });
  const video = { paused: true, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
  const status = {};
  const play = button(), retry = button();
  const stop = mount({ video, status, play, retry, fragment: '#' + encodeURIComponent(url), Hls });
  return { instances, video, status, play, retry, stop };
}

test('fatal HLS failure stops requests; retry destroys the old engine and ignores its callbacks', () => {
  const url = 'https://cdn.example/live.m3u8?token=abc';
  const f = fixture(url), first = f.instances[0];
  assert.equal(first.url, url);
  first.events.error(null, { fatal: true, response: { code: 403 } });
  assert.equal(first.stopped, true);
  assert.equal(f.video.paused, true);
  assert.match(f.status.textContent, /rechaza|autorizado|caduc/i);
  f.retry.click();
  assert.equal(first.destroyed, true);
  assert.equal(f.instances[1].url, url);
  first.events.error(null, { fatal: true, response: { code: 404 } });
  assert.equal(f.status.textContent, 'Conectando…');
  f.stop();
  assert.equal(f.instances[1].destroyed, true);
});

test('expired and invalid sources never start HLS', () => {
  for (const url of ['https://cdn.example/live.m3u8?e=1000000000', 'javascript:alert(1)'])
    assert.equal(fixture(url).instances.length, 0);
});

test('RFAF channel 11 uses the Calamar hosting in the site and Android web player', () => {
  for (const name of ['playlist.m3u8', 'chunklist_b1500000.m3u8']) {
    const source = 'https://cdnlive.codev8.net/rfaf20live/smil:channel11.smil/' + name;
    const playback = webPlayback(source, { pages: true });
    const relay = new URL(playback.address);
    assert.equal(playback.kind, 'hls');
    assert.equal(relay.origin + relay.pathname, 'https://calamarmenciano.com/calamar-player.php');
    assert.equal(relay.searchParams.get('page'), source);
    assert.equal(relay.searchParams.get('hls'), '1');
    assert.equal(fixture(source).instances[0].url, relay.href);
    const anotherChannel = source.replace('channel11', 'channel12');
    assert.equal(fixture(anotherChannel).instances[0].url, anotherChannel);
  }
});
