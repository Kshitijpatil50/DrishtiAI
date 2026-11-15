/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThinkingLevel } from '@google/genai';

export const SCENE_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;
export const QUESTION_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

export interface ModelFallbackCache {
  scene: string | null;
  question: string | null;
}

const defaultModelCache: ModelFallbackCache = {
  scene: null,
  question: null,
};

export interface FallbackOptions {
  totalBudgetMs?: number;
  attemptTimeoutMs?: number;
  hedgeDelayMs?: number;
  models?: readonly string[];
  hedge?: boolean;
  cacheKey?: 'scene' | 'question';
  signal?: AbortSignal;
  modelCache?: ModelFallbackCache;
}

export interface GeminiModelsLike {
  models: {
    generateContent: (req: any) => Promise<any>;
  };
}

export function isAuthOrKeyError(message: string): boolean {
  return /api[_\s-]?key[_\s-]?(invalid|not valid)|permission_denied|unauthorized|\b401\b|\b403\b/i.test(
    message
  );
}

export function buildModelRequest(baseRequest: any, model: string, abortSignal?: AbortSignal) {
  const config: any = {
    ...baseRequest.config,
  };
  if (abortSignal) {
    config.abortSignal = abortSignal;
  }
  if (!config.thinkingConfig) {
    if (model.startsWith('gemini-4')) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    } else if (model.startsWith('gemini-3')) {
      config.thinkingConfig = {
        thinkingLevel: model.includes('lite') ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
      };
    }
  }
  return {
    ...baseRequest,
    model,
    config,
  };
}

/**
 * Resilient Gemini call with sequential or hedged fallback across valid active Flash models,
 * sized so multimodal camera + memory calls have adequate time to complete without stalling.
 */
export async function generateContentWithFallback(
  ai: GeminiModelsLike,
  baseRequest: any,
  options: FallbackOptions = {}
) {
  const {
    totalBudgetMs = 32000,
    attemptTimeoutMs = 22000,
    hedgeDelayMs = 2500,
    models = QUESTION_MODELS,
    hedge = true,
    cacheKey = 'question',
    signal,
    modelCache = defaultModelCache,
  } = options;

  const rawCached = modelCache[cacheKey];
  const validCached = rawCached && models.includes(rawCached) ? rawCached : null;
  const setCached = (val: string | null) => {
    modelCache[cacheKey] = val;
  };

  const modelsToTry = Array.from(new Set(validCached ? [validCached, ...models] : models));
  const attemptErrors: string[] = [];
  const deadline = Date.now() + totalBudgetMs;

  const trySingleModel = (
    model: string,
    timeoutMs: number,
    waveAbort?: AbortController
  ): Promise<{ model: string; res: any }> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const attemptController = new AbortController();
      const forwardOuterAbort = () => attemptController.abort(signal?.reason);
      const forwardWaveAbort = () => attemptController.abort(waveAbort?.signal.reason);
      signal?.addEventListener('abort', forwardOuterAbort, { once: true });
      waveAbort?.signal.addEventListener('abort', forwardWaveAbort, { once: true });

      const cleanupListeners = () => {
        signal?.removeEventListener('abort', forwardOuterAbort);
        waveAbort?.signal.removeEventListener('abort', forwardWaveAbort);
      };

      const timer = setTimeout(() => {
        attemptController.abort();
        cleanupListeners();
        reject(new Error(`${model}: timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const req = buildModelRequest(baseRequest, model, attemptController.signal);
      ai.models
        .generateContent(req)
        .then((res) => {
          clearTimeout(timer);
          cleanupListeners();
          if (!res || typeof res.text !== 'string' || !res.text.trim()) {
            reject(new Error(`${model}: empty response`));
            return;
          }
          resolve({ model, res });
        })
        .catch((err: any) => {
          clearTimeout(timer);
          cleanupListeners();
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          const msg = err?.message || String(err);
          reject(new Error(`${model}: ${msg}`));
        });
    });

  if (!hedge) {
    for (const model of modelsToTry) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 500) break;
      const perAttemptMs = Math.min(attemptTimeoutMs, remainingMs);
      try {
        const { model: used, res } = await trySingleModel(model, perAttemptMs);
        setCached(used);
        return res;
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        if (modelCache[cacheKey] === model) {
          setCached(null);
        }
        const msg = err?.message || String(err);
        attemptErrors.push(msg);
        console.warn('[Gemini]', msg);
        if (isAuthOrKeyError(msg)) {
          throw new Error(msg);
        }
      }
    }
    throw new Error(attemptErrors.join(' | ') || 'All Gemini models timed out');
  }

  // Hedged fallback for interactive user questions: launch backup after hedgeDelayMs or early failure
  let idx = 0;
  while (idx < modelsToTry.length) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 500) break;

    const primaryModel = modelsToTry[idx++];
    const backupModel = idx < modelsToTry.length ? modelsToTry[idx++] : null;

    if (!backupModel) {
      try {
        const { model, res } = await trySingleModel(
          primaryModel,
          Math.min(attemptTimeoutMs, remainingMs)
        );
        setCached(model);
        return res;
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        if (modelCache[cacheKey] === primaryModel) {
          setCached(null);
        }
        const msg = err?.message || String(err);
        attemptErrors.push(msg);
        console.warn('[Gemini]', msg);
        if (isAuthOrKeyError(msg)) {
          throw new Error(msg);
        }
        continue;
      }
    }

    const res = await new Promise<any>((resolve, reject) => {
      let settled = false;
      let backupStarted = false;
      let pending = 1;
      let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
      const waveAbort = new AbortController();

      const onFailure = (modelName: string, err: any) => {
        if (signal?.aborted || err?.name === 'AbortError') {
          if (!settled) {
            settled = true;
            if (hedgeTimer) clearTimeout(hedgeTimer);
            waveAbort.abort();
            reject(err);
          }
          return;
        }
        const errMsg = err?.message || String(err);
        if (modelCache[cacheKey] === modelName) {
          setCached(null);
        }
        attemptErrors.push(errMsg);
        console.warn('[Gemini]', errMsg);
        pending--;

        if (isAuthOrKeyError(errMsg) && !settled) {
          settled = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          waveAbort.abort();
          reject(new Error(errMsg));
          return;
        }

        if (!backupStarted) {
          startBackup();
          return;
        }
        if (pending === 0 && !settled) {
          settled = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          reject(new Error('wave_failed'));
        }
      };

      const startBackup = () => {
        if (backupStarted || settled) return;
        backupStarted = true;
        const left = deadline - Date.now();
        if (left <= 500) {
          if (pending === 0 && !settled) {
            settled = true;
            reject(new Error('wave_timeout'));
          }
          return;
        }
        pending++;
        trySingleModel(backupModel, Math.min(attemptTimeoutMs, left), waveAbort)
          .then(({ model, res: r }) => {
            if (!settled) {
              settled = true;
              if (hedgeTimer) clearTimeout(hedgeTimer);
              waveAbort.abort();
              setCached(model);
              resolve(r);
            }
          })
          .catch((e: any) => onFailure(backupModel, e));
      };

      hedgeTimer = setTimeout(startBackup, Math.min(hedgeDelayMs, Math.max(200, remainingMs - 600)));

      trySingleModel(primaryModel, Math.min(attemptTimeoutMs, remainingMs), waveAbort)
        .then(({ model, res: r }) => {
          if (!settled) {
            settled = true;
            if (hedgeTimer) clearTimeout(hedgeTimer);
            waveAbort.abort();
            setCached(model);
            resolve(r);
          }
        })
        .catch((e: any) => onFailure(primaryModel, e));
    }).catch((err: any) => {
      if (err?.name === 'AbortError' || signal?.aborted || isAuthOrKeyError(String(err?.message || ''))) {
        throw err;
      }
      return null;
    });

    if (res) return res;
  }

  throw new Error(attemptErrors.join(' | ') || 'All Gemini models timed out');
}
