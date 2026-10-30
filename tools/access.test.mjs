import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitMessage, DEFAULT_SCREENS } from '../web/access.js';

test('one screen by default; a new screen beyond the limit is told why, with what is being watched', () => {
  assert.equal(DEFAULT_SCREENS, 1);
  assert.equal(limitMessage(1, []), null);
  assert.equal(limitMessage(2, [{ title: 'La 1' }]), null);
  const message = limitMessage(1, [{ title: 'Real Madrid vs Barcelona' }]);
  assert.match(message, /Se ha superado el límite de reproducciones simultáneas de tu cuenta \(1 pantalla\)/);
  assert.match(message, /Real Madrid vs Barcelona/);
  assert.match(limitMessage(2, [{ title: 'A' }, { title: 'B' }]), /2 pantallas/);
});
