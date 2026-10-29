import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanishTrack, trackLabel } from '../web/player-tracks.js';

test('Spanish from Spain is the default audio, then any Spanish; none leaves the video as it is', () => {
  assert.equal(spanishTrack([{ lang: 'eng', name: 'English' }, { lang: 'spa', name: 'Latino' }, { lang: 'spa', name: 'Castellano' }]), 2);
  assert.equal(spanishTrack([{ lang: 'en' }, { lang: 'es-419', name: 'Español (Latinoamérica)' }]), 1);
  assert.equal(spanishTrack([{ lang: 'jpn' }, { lang: '', name: 'Español' }]), 1);
  assert.equal(spanishTrack([{ lang: 'es-ES' }, { lang: 'en' }]), 0);
  assert.equal(spanishTrack([{ lang: 'eng' }, { lang: 'fre' }]), -1);
  assert.equal(spanishTrack([]), -1);
  assert.equal(spanishTrack(undefined), -1);
});

test('tracks are named by their own name, or by their language in Spanish', () => {
  assert.equal(trackLabel({ lang: 'spa', name: 'Castellano 5.1' }, 0), 'Castellano 5.1');
  assert.equal(trackLabel({ lang: 'eng', name: 'audio 2' }, 1), 'Inglés');
  assert.equal(trackLabel({ language: 'fr', label: '' }, 0), 'Francés');
  assert.equal(trackLabel({}, 3), 'Pista 4');
});

test('films show the time watched and the time left, as in Netflix', async () => {
  const { elapsedRemaining } = await import('../web/player-controls.js');
  assert.equal(elapsedRemaining(723, 5533), '12:03 / -1:20:10');
  assert.equal(elapsedRemaining(0, 95), '0:00 / -1:35');
  assert.equal(elapsedRemaining(NaN, 60), '0:00 / -1:00');
  assert.equal(elapsedRemaining(70, 60), '1:10 / -0:00');
});
