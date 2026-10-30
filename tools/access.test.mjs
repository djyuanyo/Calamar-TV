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

import { claimPlan, LEASE_MS } from '../web/access-lease.js';
test('atomic claim planning counts profiles together and reserves every player of Multipantalla', () => {
  const now = 1000000, live = {holder:'other',title:'Film',at:now-1000};
  assert.deepEqual(claimPlan([live,null],'mine',1,2,now),[1]);
  assert.throws(()=>claimPlan([live,null],'mine',2,2,now),/límite/);
  assert.throws(()=>claimPlan([], 'mine',2,1,now),/límite/);
  assert.deepEqual(claimPlan([{...live,at:now-LEASE_MS}], 'mine',1,1,now),[0]);
  assert.deepEqual(claimPlan([{...live,holder:'mine'}], 'mine',1,1,now),[0]);
});
