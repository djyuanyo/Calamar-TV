import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webPlayback } from '../web/catalog.js';
import { mountTs, tsRequest, TS_RELAY } from '../web/ts-player.js';

test('HTTP IPTV from different public hosts uses the relay while non-media pages stay blocked', () => {
  assert.deepEqual(webPlayback('http://31.43.191.125:8080/User/Pass/244'), { ok: true, kind: 'ts', relay: true });
  assert.equal(webPlayback('http://31.43.191.125:8080/User/Pass/244.ts').kind, 'ts');
  assert.equal(webPlayback('http://other.example/User/Pass/244').ok, true);
  assert.equal(webPlayback('http://neospaxy.top:8080/Test/Pass/57476').relay, true);
  assert.equal(webPlayback('http://other.example/live/User/Pass/244.ts?token=A%2Bb').relay, true);
  assert.equal(webPlayback('http://other.example/embed/player').ok, false);
  assert.equal(webPlayback('http://127.0.0.1/User/Pass/244').ok, false);
  assert.equal(webPlayback('http://user:pass@31.43.191.125:8080/User/Pass/244').ok, false);
  assert.equal(webPlayback('https://example.com/live.ts').kind, 'ts');
  assert.equal(webPlayback('https://example.com/live.m3u8').kind, 'hls');
});

test('relay URL never contains IPTV path credentials and preserves their bytes in a header', () => {
  const address = 'http://31.43.191.125:8080/User/Keep%2BCase/244?token=A%2Bb';
  const request = tsRequest(address, true);
  assert.equal(request.url, TS_RELAY);
  assert.equal(Buffer.from(request.headers['X-Calamar-Source'], 'base64').toString(), address);
  assert.equal(tsRequest('https://example.com/a.ts').url, 'https://example.com/a.ts');
});

function fixture() {
  const players = [], tasks = new Map(), events = new Map(), failures = [];
  const video = { buffered: { length: 0 }, currentTime: 0,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name) };
  const timers = { setTimeout: callback => { const id = tasks.size + 1; tasks.set(id, callback); return id; },
    clearTimeout: id => tasks.delete(id) };
  const library = { getFeatureList: () => ({ mseLivePlayback: true }),
    Events: { ERROR: 'error', LOADING_COMPLETE: 'complete' }, ErrorTypes: { NETWORK_ERROR: 'NetworkError' },
    createPlayer: () => {
      const handlers = {};
      const p = { on: (name, cb) => handlers[name] = cb, pause() {}, destroy() { this.destroyed = true; },
        attachMediaElement() {}, load() {}, play() { return Promise.resolve(); }, handlers };
      players.push(p); return p;
    } };
  const stop = mountTs({ library, video, address: 'https://example.com/a.ts', timers,
    onFailure: data => failures.push(data) });
  return { players, tasks, failures, stop, library };
}

test('closing a channel cancels relay renewal and destroys its player', () => {
  const f = fixture();
  f.players[0].handlers.complete();
  const queued = [...f.tasks.values()][0];
  f.stop();
  queued();
  assert.equal(f.tasks.size, 0);
  assert.equal(f.players.length, 1);
  assert.equal(f.players[0].destroyed, true);
});

test('completed bounded connections reopen and late old errors cannot stop the new one', () => {
  const f = fixture();
  f.players[0].handlers.complete();
  [...f.tasks.values()][0]();
  assert.equal(f.players.length, 2);
  f.players[0].handlers.error('NetworkError', 'error', { code: 403 });
  assert.equal(f.failures.length, 0);
  assert.equal(f.players[1].destroyed, undefined);
  f.stop();
});

test('codec failures are reported without indefinite retries', () => {
  const f = fixture();
  f.players[0].handlers.error('MediaError', 'CodecUnsupported');
  assert.equal(f.failures[0].details, 'codecUnsupported');
  assert.equal(f.players[0].destroyed, true);
  assert.equal(f.tasks.size, 0);
  f.stop();
});