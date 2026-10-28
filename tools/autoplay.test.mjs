import test from 'node:test';
import assert from 'node:assert/strict';
import { autoplay, soundChosen } from '../web/autoplay.js';

const blocked = () => Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
const fakeVideo = (allow) => {
  const video = { muted: false, dataset: {}, plays: 0 };
  video.play = () => { video.plays++; return allow(video) ? Promise.resolve() : Promise.reject(blocked()); };
  return video;
};

test('a video the browser lets play with sound starts with sound', async () => {
  const video = fakeVideo(() => true);
  assert.equal(await autoplay(video), undefined);
  assert.equal(video.muted, false); assert.equal(video.dataset.autoMuted, undefined);
});

test('when the browser blocks the sound the video starts muted and remembers why', async () => {
  const video = fakeVideo((v) => v.muted);
  await autoplay(video);
  assert.equal(video.plays, 2); assert.equal(video.muted, true); assert.equal(video.dataset.autoMuted, '1');
  soundChosen(video);
  assert.equal(video.dataset.autoMuted, undefined);
});

test('a video that cannot start even muted is reported and keeps its sound setting', async () => {
  const video = fakeVideo(() => false);
  await assert.rejects(autoplay(video), { name: 'NotAllowedError' });
  assert.equal(video.muted, false);
});

test('other failures and videos the viewer muted are not retried', async () => {
  const video = { muted: false, dataset: {}, plays: 0, play() { this.plays++; return Promise.reject(new Error('decode')); } };
  await assert.rejects(autoplay(video), /decode/);
  assert.equal(video.plays, 1);
  const muted = fakeVideo(() => false); muted.muted = true;
  await assert.rejects(autoplay(muted));
  assert.equal(muted.plays, 1);
});

test('a play function that returns nothing (mpegts) counts as started', async () => {
  const video = fakeVideo(() => true);
  await autoplay(video, () => undefined);
});
