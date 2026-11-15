import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpeechOnsetThreshold,
  getRequiredOnsetMs,
  getSilenceLimitMs,
} from './vad';

test('getSpeechOnsetThreshold raises gate during assistant playback to avoid echo barge-in', () => {
  const quietThresh = getSpeechOnsetThreshold(0.005, false);
  const speakingThresh = getSpeechOnsetThreshold(0.005, true);

  assert.ok(quietThresh <= 0.02);
  assert.ok(speakingThresh >= 0.045);
  assert.ok(speakingThresh > quietThresh * 2.5);
});

test('getRequiredOnsetMs uses snappy pickup when quiet and guarded pickup during playback', () => {
  assert.equal(getRequiredOnsetMs(false), 75);
  assert.equal(getRequiredOnsetMs(true), 140);
});

test('getSilenceLimitMs tightens trailing silence once real speech is detected', () => {
  assert.equal(getSilenceLimitMs(false, 0), 1800);
  assert.equal(getSilenceLimitMs(true, 300), 520);
  assert.equal(getSilenceLimitMs(true, 650), 420);
});
