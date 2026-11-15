import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GnaniServerQueue,
  isGnaniBusyResponse,
  isGnaniTransientError,
} from './gnaniConcurrency.ts';

test('isGnaniBusyResponse detects 429 and active-request error strings across status codes', () => {
  assert.equal(isGnaniBusyResponse(429, { detail: 'Too many requests' }), true);
  assert.equal(
    isGnaniBusyResponse(400, {
      detail:
        'Only 1 active request is allowed at a time. Wait for your current request to finish before sending another.',
    }),
    true
  );
  assert.equal(
    isGnaniBusyResponse(409, 'Only 1 active request is allowed at a time'),
    true
  );
  assert.equal(isGnaniBusyResponse(401, { detail: 'Invalid API key' }), false);
});

test('isGnaniTransientError marks 5xx and busy responses as transient', () => {
  assert.equal(isGnaniTransientError(500, {}), true);
  assert.equal(isGnaniTransientError(502, {}), true);
  assert.equal(isGnaniTransientError(503, {}), true);
  assert.equal(isGnaniTransientError(504, {}), true);
  assert.equal(
    isGnaniTransientError(400, { detail: 'Only 1 active request is allowed at a time.' }),
    true
  );
  assert.equal(isGnaniTransientError(400, { detail: 'Missing text' }), false);
});

test('GnaniServerQueue strictly serializes concurrent upstream calls', async () => {
  const queue = new GnaniServerQueue({ cooldownAfterAbortMs: 0 });
  let inFlight = 0;
  let maxObservedInFlight = 0;
  const order: number[] = [];

  const runTask = (id: number, delayMs: number) =>
    queue.enqueue(async () => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      order.push(id);
      inFlight--;
      return id;
    });

  const results = await Promise.all([runTask(1, 30), runTask(2, 10), runTask(3, 10)]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(maxObservedInFlight, 1);
});

test('GnaniServerQueue drops aborted queued callers without executing them and cools down after abort', async () => {
  const queue = new GnaniServerQueue({ cooldownAfterAbortMs: 40 });
  const events: string[] = [];

  const c1 = new AbortController();
  const c2 = new AbortController();

  const p1 = queue
    .enqueue(
      (sig) =>
        new Promise<void>((_, reject) => {
          events.push('t1-start');
          sig.addEventListener('abort', () => {
            events.push('t1-aborted');
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
      c1.signal
    )
    .catch((e) => e.name);

  // Queue task 2 and abort it while task 1 is active
  const p2 = queue
    .enqueue(async () => {
      events.push('t2-should-never-run');
      return 't2';
    }, c2.signal)
    .catch((e) => e.name);

  c2.abort();

  // Queue task 3 after task 1 aborts; it should wait for cooldown
  const p3 = queue.enqueue(async () => {
    events.push('t3-start');
    return 't3';
  });

  await new Promise((r) => setTimeout(r, 10));
  c1.abort();

  assert.equal(await p1, 'AbortError');
  assert.equal(await p2, 'AbortError');
  assert.equal(await p3, 't3');
  assert.deepEqual(events, ['t1-start', 't1-aborted', 't3-start']);
});
