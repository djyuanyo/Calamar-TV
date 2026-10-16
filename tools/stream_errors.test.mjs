import assert from 'node:assert/strict';
import test from 'node:test';
import { explainStreamError, streamExpiry, streamFailureReport } from '../web/catalog.js';

const at = (iso) => Date.parse(iso);

test('a 10-digit time inside ?token= is the expiry', () => {
  const url = 'https://cdn.example/live/index.m3u8?token=abc123-def456-1792097946-';
  assert.equal(streamExpiry(url), 1792097946 * 1000);
});

test('?e= and ?expires= are read, in seconds', () => {
  assert.equal(streamExpiry('https://x.example/a.m3u8?e=1700000000'), 1700000000 * 1000);
  assert.equal(streamExpiry('https://x.example/a.m3u8?expires=1700000000&x=1'), 1700000000 * 1000);
});

test('links that say nothing about time have no expiry', () => {
  assert.equal(streamExpiry('https://x.example/a.m3u8'), null);
  assert.equal(streamExpiry('https://x.example/a.m3u8?token=sin-fecha'), null);
  assert.equal(streamExpiry('https://x.example/a.m3u8?e=12345'), null); // not a plausible epoch
  assert.equal(streamExpiry('https://x.example/a.m3u8?e=1700000000.5'), null);
  assert.equal(streamExpiry('no es un enlace'), null);
});

test('a link already past its time is recognised as expired', () => {
  const expiry = streamExpiry('https://cdn.example/a.m3u8?token=a-b-1000000000-');
  assert.ok(expiry < at('2026-01-01T00:00:00Z'));
});

test('errors are explained in plain language', () => {
  assert.match(explainStreamError({ details: 'manifestLoadError', code: 403 }), /rechaza.*caducó/);
  assert.match(explainStreamError({ details: 'manifestLoadError', code: 401 }), /rechaza/);
  assert.match(explainStreamError({ details: 'manifestLoadError', code: 404 }), /ya no existe/);
  assert.match(explainStreamError({ details: 'manifestLoadError', code: 410 }), /ya no existe/);
  assert.match(explainStreamError({ details: 'manifestLoadError', code: 0 }), /CORS/);
  assert.match(explainStreamError({ details: 'manifestLoadError' }), /CORS/);
  assert.match(explainStreamError({ details: 'fragLoadError' }), /CORS/);
  assert.match(explainStreamError({ details: 'manifestParsingError' }), /formato/);
  assert.match(explainStreamError({ details: 'manifestIncompatibleCodecsError' }), /no admite/);
  assert.match(explainStreamError({ details: 'bufferAddCodecError' }), /no admite/);
  assert.match(explainStreamError({}), /No se pudo reproducir/);
  assert.match(explainStreamError(), /No se pudo reproducir/);
});

test('a server rejection does not mislabel a still-valid token as expired', () => {
  const now = at('2026-10-16T06:43:00Z');
  const expiry = 1792143608 * 1000;
  assert.match(explainStreamError({ code: 403, expiry, now }), /HTTP 403.*todavía no ha caducado/);
  assert.match(explainStreamError({ code: 401, expiry, now }), /HTTP 401.*todavía no ha caducado/);
  assert.match(explainStreamError({ code: 403, expiry, now: expiry + 1 }), /ha caducado/);
});

test('diagnostic distinguishes failed playlists and fragments without disclosing tokens', () => {
  const expiry = 1792143608 * 1000;
  const report = streamFailureReport({ details: 'levelLoadError', code: 403,
    url: 'https://cdn.example/live/mono.m3u8?token=private-secret', expiry });
  assert.deepEqual(report, { stage: 'Lista de vídeo o audio', code: 403, host: 'cdn.example', expiresAt: '2026-10-16T09:40:08.000Z' });
  assert.equal(JSON.stringify(report).includes('private-secret'), false);
  assert.equal(streamFailureReport({ details: 'fragLoadError' }).stage, 'Fragmento de vídeo');
  assert.equal(streamFailureReport({ details: 'manifestLoadError', url: 'invalid' }).host, '');
});
