import test from 'node:test';
import assert from 'node:assert/strict';
import { appIntent } from '../web/app-links.js';
test('Android fallback points to the same page in the installed package', () => {
  assert.match(appIntent('https://djyuanyo.github.io/Calamar-TV/#/liga/laliga'), /^intent:\/\/open\/liga\/laliga#Intent;scheme=calamartv;package=es.yuanyo.calamartv;/);
  assert.match(appIntent('https://djyuanyo.github.io/Calamar-TV/evento/partido/'), /^intent:\/\/open\/evento\/partido#/);
  for (const address of ['https://evil.test/Calamar-TV/', 'https://djyuanyo.github.io/CDMenciana/', 'https://djyuanyo.github.io/Calamar-TV/#/admin']) assert.equal(appIntent(address), null);
});
