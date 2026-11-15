import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualFrameMemory, isWhereaboutsQuery } from './memory';

function makeThumb(val: number): Uint8Array {
  const arr = new Uint8Array(32 * 24);
  arr.fill(val);
  return arr;
}

test('isWhereaboutsQuery detects English, Hinglish, Hindi, and Marathi whereabouts questions', () => {
  assert.equal(isWhereaboutsQuery('Do you know where the exit door is?'), true);
  assert.equal(isWhereaboutsQuery('Did you see my water bottle earlier?'), true);
  assert.equal(isWhereaboutsQuery('Which way are the stairs?'), true);
  assert.equal(isWhereaboutsQuery('Darwaza kahan tha?'), true);
  assert.equal(isWhereaboutsQuery('मेरा बैग कहाँ रखा है?'), true);
  assert.equal(isWhereaboutsQuery('दरवाजा कुठे आहे?'), true);
  assert.equal(isWhereaboutsQuery('Payrya kuthe hotya?'), true);
  assert.equal(isWhereaboutsQuery('What does this label say?'), false);
});

test('VisualFrameMemory deduplicates static frames and captures distinct scene changes', () => {
  const memory = new VisualFrameMemory({
    maxFrames: 5,
    minIntervalMs: 2000,
    maxIntervalMs: 8000,
    minSceneDiff: 6,
  });

  const t0 = 100_000;
  const thumbA = makeThumb(20);
  const thumbB = makeThumb(60);

  assert.equal(memory.shouldCaptureFrame(thumbA, t0), true);
  memory.recordFrame('frame-a', thumbA, t0);
  assert.equal(memory.size, 1);

  // Too soon (<2s)
  assert.equal(memory.shouldCaptureFrame(thumbB, t0 + 1000), false);

  // Same scene at 3s -> skipped
  assert.equal(memory.shouldCaptureFrame(thumbA, t0 + 3000), false);

  // Different scene at 3s -> captured
  assert.equal(memory.shouldCaptureFrame(thumbB, t0 + 3000), true);
  memory.recordFrame('frame-b', thumbB, t0 + 3000);
  assert.equal(memory.size, 2);

  // Same scene after maxIntervalMs (8s) -> captured for temporal coverage
  assert.equal(memory.shouldCaptureFrame(thumbB, t0 + 11_500), true);
});

test('VisualFrameMemory enforces ring buffer capacity, TTL expiry, and chronological selection', () => {
  const memory = new VisualFrameMemory({
    maxFrames: 4,
    maxAgeMs: 30_000,
  });

  memory.recordFrame('old-expired', makeThumb(10), 1_000);
  memory.recordFrame('f1', makeThumb(30), 20_000, 'Door on left');
  memory.recordFrame('f2', makeThumb(50), 25_000);
  memory.recordFrame('f3', makeThumb(70), 30_000);
  memory.recordFrame('f4', makeThumb(90), 35_000);
  memory.annotateLatest('Hallway ahead', 36_000);

  // Current live view matches f4 closely; f4 should be excluded as duplicate of live view
  const now = 40_000;
  const selected = memory.selectFramesForQuestion(
    now,
    makeThumb(91),
    'Do you know where the door was?'
  );

  // old-expired (age 39s > 30s) pruned; f4 excluded as matching live view -> f1, f2, f3 returned in order
  assert.deepEqual(
    selected.map((s) => s.imageBase64),
    ['f1', 'f2', 'f3']
  );
  assert.equal(selected[0].secondsAgo, 20);
  assert.equal(selected[0].narration, 'Door on left');
  assert.equal(selected[2].secondsAgo, 10);
});

test('VisualFrameMemory caps selected frames to 5 for whereabouts queries and 3 for general queries', () => {
  const memory = new VisualFrameMemory({ maxFrames: 12, maxAgeMs: 120_000 });
  for (let i = 0; i < 8; i++) {
    memory.recordFrame(`frame-${i}`, makeThumb(i * 25), 10_000 + i * 3000);
  }

  const now = 40_000;
  const whereaboutsFrames = memory.selectFramesForQuestion(
    now,
    makeThumb(240),
    'Where was the chair?'
  );
  assert.equal(whereaboutsFrames.length, 5);
  assert.equal(whereaboutsFrames[0].imageBase64, 'frame-0');
  assert.equal(whereaboutsFrames[4].imageBase64, 'frame-7');

  const generalFrames = memory.selectFramesForQuestion(
    now,
    makeThumb(240),
    'Read this medicine label'
  );
  assert.equal(generalFrames.length, 3);
});
