import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayerService, isCancellationError } from './player.ts';
import { GnaniError, gnaniQueue } from '../services/gnani.ts';

test('isCancellationError identifies 499, AbortError, and cancelled/stopAll messages', () => {
  assert.equal(isCancellationError(new GnaniError(499, 'Gnani TTS cancelled')), true);
  assert.equal(isCancellationError(new DOMException('Aborted', 'AbortError')), true);
  assert.equal(isCancellationError(new Error('Cancelled by stopAll')), true);
  assert.equal(isCancellationError(new GnaniError(504, 'Gnani proxy TTS timed out')), false);
  assert.equal(isCancellationError(new GnaniError(500, 'Internal error')), false);
});

test('AudioPlayerService suppresses errors when a new speak() interrupts an active speak() with the same requestToken', async () => {
  const errors: string[] = [];
  let finishedCount = 0;

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    fetchCalls++;
    const callNum = fetchCalls;
    return await new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener('abort', onAbort, { once: true });

      // Second call finishes quickly; first stays pending until aborted by second speak()
      if (callNum === 2) {
        setTimeout(() => {
          init?.signal?.removeEventListener('abort', onAbort);
          resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
        }, 20);
      }
    });
  }) as typeof fetch;

  try {
    const player = new AudioPlayerService({
      onTtsError: (msg) => errors.push(msg),
      onFinishedSpeaking: () => {
        finishedCount++;
      },
    });

    // Empty sanitized text or Audio missing in Node: simulate interrupting speak #1 with speak #2 on same requestToken=0
    const p1 = player.speak('First utterance.', { requestToken: 0 });
    await new Promise((r) => setTimeout(r, 10));

    // Empty text on speak #2 interrupts speak #1 synchronously with the exact same requestToken=0
    const p2 = player.speak('', { requestToken: 0 });

    assert.equal(await p1, false);
    assert.equal(await p2, true);
    assert.deepEqual(errors, []);
    assert.equal(finishedCount, 1);
  } finally {
    gnaniQueue.clearPending();
    globalThis.fetch = originalFetch;
  }
});
