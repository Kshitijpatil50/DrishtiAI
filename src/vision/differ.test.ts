import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMeanAbsoluteDifference,
  shouldTriggerSceneNarration,
  resampleToGrayscaleThumbnail,
  THUMBNAIL_WIDTH,
  THUMBNAIL_HEIGHT,
} from './differ';

test('difference of identical thumbnails is zero', () => {
  const a = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT).fill(128);
  const b = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT).fill(128);
  assert.equal(calculateMeanAbsoluteDifference(a, b), 0);
});

test('computes correct mean absolute difference between two thumbnails', () => {
  const a = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT).fill(100);
  const b = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT).fill(120);
  assert.equal(calculateMeanAbsoluteDifference(a, b), 20);
});

test('trigger condition respects diff > 8 and 1.8s cooldown', () => {
  // Diff <= 8 and recent call -> false
  assert.equal(shouldTriggerSceneNarration(6, 2000, 2000), false);

  // Diff > 8 but only 1 second since last call -> false
  assert.equal(shouldTriggerSceneNarration(10, 1000, 1000), false);

  // Diff > 8 and 1.8 seconds since last call -> true
  assert.equal(shouldTriggerSceneNarration(10, 1900, 1900), true);
});

test('trigger condition fires after 5s timeout even with zero diff', () => {
  assert.equal(shouldTriggerSceneNarration(0, 5000, 5000), true);
  assert.equal(shouldTriggerSceneNarration(3, 2000, 5200), true);
  // Respect cooldown even when silence timeout has elapsed (prevents polling storm on silent frames)
  assert.equal(shouldTriggerSceneNarration(0, 600, 999999), false);
});

test('resamples RGBA buffer to grayscale thumbnail', () => {
  // 64x48 RGBA
  const w = 64;
  const h = 48;
  const rgba = new Uint8Array(w * h * 4);
  // Fill with red (255, 0, 0, 255) -> gray approx 76
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 255;
  }

  const thumb = resampleToGrayscaleThumbnail(rgba, w, h);
  assert.equal(thumb.length, THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT);
  assert.equal(thumb[0], 76);
  assert.equal(thumb[thumb.length - 1], 76);
});
