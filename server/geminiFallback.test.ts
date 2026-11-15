import test from 'node:test';
import assert from 'node:assert/strict';
import { ThinkingLevel } from '@google/genai';
import {
  SCENE_MODELS,
  QUESTION_MODELS,
  buildModelRequest,
  generateContentWithFallback,
  type ModelFallbackCache,
} from './geminiFallback.ts';

test('SCENE_MODELS and QUESTION_MODELS contain only active valid models', () => {
  const allowed = new Set(['gemini-3.1-flash-lite', 'gemini-4-hydrogen']);
  for (const model of [...SCENE_MODELS, ...QUESTION_MODELS]) {
    assert.equal(allowed.has(model), true, `Unexpected model: ${model}`);
  }
  assert.equal(QUESTION_MODELS.includes('gemini-4-hydrogen'), true);
});

test('buildModelRequest applies MINIMAL thinking to flash-lite and LOW to gemini-4', () => {
  const liteReq = buildModelRequest({ contents: [], config: {} }, 'gemini-3.1-flash-lite');
  assert.equal(liteReq.config.thinkingConfig.thinkingLevel, ThinkingLevel.MINIMAL);

  const flash4Req = buildModelRequest({ contents: [], config: {} }, 'gemini-4-hydrogen');
  assert.equal(flash4Req.config.thinkingConfig.thinkingLevel, ThinkingLevel.LOW);
});

test('generateContentWithFallback falls back via hedge to gemini-4-hydrogen when primary stalls beyond 5s', async () => {
  const calls: string[] = [];
  const cache: ModelFallbackCache = { scene: null, question: null };

  const fakeAi = {
    models: {
      generateContent: (req: any) =>
        new Promise((resolve, reject) => {
          calls.push(req.model);
          const signal: AbortSignal | undefined = req.config?.abortSignal;
          const timer = setTimeout(
            () => {
              resolve({ text: JSON.stringify({ speech: `ok from ${req.model}`, language: 'en' }) });
            },
            req.model === 'gemini-3.1-flash-lite' ? 6000 : 40
          );
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        }),
    },
  };

  const res = await generateContentWithFallback(
    fakeAi,
    { contents: [], config: {} },
    {
      models: QUESTION_MODELS,
      totalBudgetMs: 1500,
      attemptTimeoutMs: 1000,
      hedgeDelayMs: 40,
      hedge: true,
      cacheKey: 'question',
      modelCache: cache,
    }
  );

  assert.equal(JSON.parse(res.text).speech, 'ok from gemini-4-hydrogen');
  assert.deepEqual(calls, ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']);
  assert.equal(cache.question, 'gemini-4-hydrogen');
});

test('generateContentWithFallback falls back if primary returns empty text', async () => {
  const cache: ModelFallbackCache = { scene: null, question: null };
  const fakeAi = {
    models: {
      generateContent: async (req: any) => {
        if (req.model === 'gemini-3.1-flash-lite') {
          return { text: '   ' };
        }
        return { text: '{"speech":"Clear ahead","language":"en"}' };
      },
    },
  };

  const res = await generateContentWithFallback(
    fakeAi,
    { contents: [], config: {} },
    {
      models: QUESTION_MODELS,
      totalBudgetMs: 2000,
      attemptTimeoutMs: 1000,
      hedgeDelayMs: 500,
      hedge: true,
      cacheKey: 'question',
      modelCache: cache,
    }
  );

  assert.equal(JSON.parse(res.text).speech, 'Clear ahead');
  assert.equal(cache.question, 'gemini-4-hydrogen');
});
