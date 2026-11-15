/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const GNANI_API_BASE = 'https://api.vachana.ai';
export const VOICE = 'Shivani';
export const TTS_SPEED = 1.05;

import { bytesToBase64 } from '../audio/wav';

// Always route through server proxy routes (/api/gnani/*) by default so server env keys are used automatically
export let USE_PROXY = true;

export function setUseProxy(value: boolean) {
  USE_PROXY = value;
}

const GNANI_SESSION_STORAGE_KEY = 'drishti_gnani_api_key';

/**
 * Safely retrieve the stored Gnani API key from sessionStorage
 */
export function getStoredGnaniKey(): string {
  try {
    return sessionStorage.getItem(GNANI_SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Safely save Gnani API key to sessionStorage without logging
 */
export function setStoredGnaniKey(key: string): void {
  try {
    sessionStorage.setItem(GNANI_SESSION_STORAGE_KEY, key.trim());
  } catch {
    // ignore
  }
}

export class GnaniError extends Error {
  status: number;
  errorCode?: string;

  constructor(status: number, detail: any, errorCode?: string) {
    let message = 'Gnani API error';
    if (typeof detail === 'string') {
      message = detail;
    } else if (detail && typeof detail === 'object') {
      message = detail.message || detail.error_code || JSON.stringify(detail);
      if (!errorCode && detail.error_code) {
        errorCode = detail.error_code;
      }
    }
    super(message);
    this.name = 'GnaniError';
    this.status = status;
    this.errorCode = errorCode;
  }
}

interface QueueItem<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  isHazard?: boolean;
}

/**
 * Global serial queue (mutex) ensuring at most ONE Gnani API call is in-flight at a time.
 * Supports priority jump for hazard speech and cancellation of pending tasks.
 */
export class GnaniSerialQueue {
  private pending: QueueItem<any>[] = [];
  private isProcessing = false;

  enqueue<T>(task: () => Promise<T>, isHazard = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = { task, resolve, reject, isHazard };
      if (isHazard) {
        // Hazard jumps ahead of other pending non-hazard items
        const firstNonHazardIndex = this.pending.findIndex((p) => !p.isHazard);
        if (firstNonHazardIndex >= 0) {
          this.pending.splice(firstNonHazardIndex, 0, item);
        } else {
          this.pending.push(item);
        }
      } else {
        this.pending.push(item);
      }
      this.processNext();
    });
  }

  clearPending(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const item of dropped) {
      item.reject(new Error('Cancelled by stopAll'));
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.pending.length === 0) {
      return;
    }

    this.isProcessing = true;
    const current = this.pending.shift()!;

    try {
      const result = await current.task();
      current.resolve(result);
    } catch (err) {
      current.reject(err);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }
}

export const gnaniQueue = new GnaniSerialQueue();

export function isGnaniBusyError(err: unknown): boolean {
  if (!(err instanceof GnaniError)) return false;
  if (err.status === 429) return true;
  const text = `${err.message || ''} ${err.errorCode || ''}`.toLowerCase();
  return (
    text.includes('active request') ||
    text.includes('1 active request') ||
    text.includes('too many requests') ||
    text.includes('rate limit')
  );
}

/**
 * Helper to execute with exponential backoff (500, 1000, 2000 ms) on 429 / active-request busy responses
 */
async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const backoffs = [500, 1000, 2000];
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (isGnaniBusyError(err) && attempt < backoffs.length) {
        const delay = backoffs[attempt];
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

export interface SttResult {
  transcript: string;
  detectedLanguage: 'en' | 'hi';
}

/**
 * Speech-To-Text using Gnani Prisma v3.0
 */
export async function transcribeAudio(
  wavBlob: Blob,
  activeKey?: string
): Promise<SttResult> {
  return gnaniQueue.enqueue(() =>
    executeWithRetry(async () => {
      const apiKey = activeKey || getStoredGnaniKey();

      if (USE_PROXY) {
        return await transcribeViaProxy(wavBlob, apiKey);
      }
      if (!apiKey) {
        throw new GnaniError(401, 'Missing Gnani API key');
      }

      try {
        const formData = new FormData();
        formData.append('audio_file', wavBlob, 'audio.wav');
        formData.append('model', 'prisma-v3.0');
        formData.append('language_code', 'hi-IN,en-IN');
        formData.append('format', 'codemix');

        const headers: Record<string, string> = {};
        if (apiKey) {
          headers['X-API-Key-ID'] = apiKey;
        }

        const response = await fetch(`${GNANI_API_BASE}/stt/v3`, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (!response.ok) {
          let errData: any = {};
          try {
            errData = await response.json();
          } catch {
            // ignore
          }
          throw new GnaniError(
            response.status,
            errData?.detail || `STT failed with status ${response.status}`,
            errData?.detail?.error_code
          );
        }

        const data = await response.json();
        const rawTranscript = (data.transcript || '').trim();
        const detected =
          data.detected_language_code === 'hi-IN' || data.language_code === 'hi-IN'
            ? 'hi'
            : 'en';

        return {
          transcript: rawTranscript,
          detectedLanguage: detected,
        };
      } catch (err: any) {
        if (err instanceof TypeError || err?.name === 'TypeError') {
          USE_PROXY = true;
          return await transcribeViaProxy(wavBlob, apiKey);
        }
        throw err;
      }
    })
  );
}

async function transcribeViaProxy(wavBlob: Blob, apiKey?: string): Promise<SttResult> {
  const arrayBuffer = await wavBlob.arrayBuffer();
  const audioBase64 = bytesToBase64(new Uint8Array(arrayBuffer));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key-ID'] = apiKey;
  }

  const response = await fetch('/api/gnani/stt', {
    method: 'POST',
    headers,
    body: JSON.stringify({ audioBase64 }),
  });

  if (!response.ok) {
    let errData: any = {};
    try {
      errData = await response.json();
    } catch {
      // ignore
    }
    throw new GnaniError(
      response.status,
      errData?.detail || errData?.error || `Proxy STT failed with status ${response.status}`,
      errData?.detail?.error_code
    );
  }

  const data = await response.json();
  const rawTranscript = (data.transcript || '').trim();
  const detected =
    data.detected_language_code === 'hi-IN' || data.language_code === 'hi-IN'
      ? 'hi'
      : 'en';

  return {
    transcript: rawTranscript,
    detectedLanguage: detected,
  };
}

const activeTtsControllers = new Set<AbortController>();
const externallyAbortedControllers = new WeakSet<AbortController>();

/**
 * Aborts any in-flight Gnani TTS requests immediately (e.g. on barge-in or new utterance)
 */
export function abortGnaniTts(): void {
  for (const controller of activeTtsControllers) {
    externallyAbortedControllers.add(controller);
    controller.abort();
  }
  activeTtsControllers.clear();
}

const TTS_TIMEOUT_MS = 23000;

function isTransientTtsError(err: unknown): boolean {
  if (!(err instanceof GnaniError)) return false;
  if (err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504) {
    return true;
  }
  return isGnaniBusyError(err);
}

/**
 * Text-To-Speech using Gnani Timbre v3.0 (Shivani voice only — never falls back)
 */
export async function synthesizeSpeech(
  text: string,
  options?: { activeKey?: string; isHazard?: boolean }
): Promise<Blob> {
  const isHazard = options?.isHazard || false;
  return gnaniQueue.enqueue(async () => {
    const apiKey = options?.activeKey || getStoredGnaniKey();
    const controller = new AbortController();
    activeTtsControllers.add(controller);
    let didTimeout = false;
    const startedAt = Date.now();
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, TTS_TIMEOUT_MS);

    const attemptTtsOnce = async (): Promise<Blob> => {
      let blob: Blob;
      if (USE_PROXY) {
        blob = await synthesizeViaProxy(text, apiKey, controller.signal, () =>
          externallyAbortedControllers.has(controller)
        );
      } else {
        if (!apiKey) {
          throw new GnaniError(401, 'Missing Gnani API key');
        }

        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (apiKey) {
            headers['X-API-Key-ID'] = apiKey;
          }

          const response = await fetch(`${GNANI_API_BASE}/api/v1/tts/inference`, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              text,
              voice: VOICE,
              model: 'timbre-v3.0',
              language: 'auto',
              speed: TTS_SPEED,
              audio_config: {
                container: 'mp3',
                sample_rate: 24000,
                bitrate: '32k',
              },
            }),
          });

          if (!response.ok) {
            let errData: any = {};
            try {
              errData = await response.json();
            } catch {
              // ignore
            }
            throw new GnaniError(
              response.status,
              errData?.detail || errData?.error || `TTS failed with status ${response.status}`,
              errData?.detail?.error_code
            );
          }

          blob = await response.blob();
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            throw new GnaniError(
              didTimeout ? 504 : 499,
              didTimeout ? 'Gnani TTS timed out' : 'Gnani TTS cancelled'
            );
          }
          if (err instanceof TypeError || err?.name === 'TypeError') {
            USE_PROXY = true;
            blob = await synthesizeViaProxy(text, apiKey, controller.signal, () =>
              externallyAbortedControllers.has(controller)
            );
          } else {
            throw err;
          }
        }
      }

      if (!blob || blob.size === 0) {
        throw new GnaniError(502, 'Gnani TTS returned empty audio');
      }
      return blob;
    };

    try {
      const maxRetries = 2;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await attemptTtsOnce();
        } catch (err: any) {
          lastErr = err;
          const wasCancelled = externallyAbortedControllers.has(controller) || didTimeout;
          const elapsed = Date.now() - startedAt;
          const waitMs = isGnaniBusyError(err)
            ? attempt === 0
              ? 650
              : 1200
            : attempt === 0
              ? 250
              : 500;
          if (
            !wasCancelled &&
            attempt < maxRetries &&
            isTransientTtsError(err) &&
            elapsed + waitMs < TTS_TIMEOUT_MS - 3000
          ) {
            await new Promise((r) => setTimeout(r, waitMs));
            if (externallyAbortedControllers.has(controller) || didTimeout) {
              throw err;
            }
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    } finally {
      clearTimeout(timeoutId);
      activeTtsControllers.delete(controller);
    }
  }, isHazard);
}

async function synthesizeViaProxy(
  text: string,
  apiKey?: string,
  signal?: AbortSignal,
  isExternallyCancelled?: () => boolean
): Promise<Blob> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key-ID'] = apiKey;
  }

  let response: Response;
  try {
    response = await fetch('/api/gnani/tts', {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        text,
        voice: VOICE,
        speed: TTS_SPEED,
      }),
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      if (isExternallyCancelled?.()) {
        throw new GnaniError(499, 'Gnani TTS cancelled');
      }
      throw new GnaniError(504, 'Gnani proxy TTS timed out');
    }
    throw err;
  }

  if (!response.ok) {
    let errData: any = {};
    try {
      errData = await response.json();
    } catch {
      // ignore
    }
    throw new GnaniError(
      response.status,
      errData?.detail || errData?.error || `Proxy TTS failed with status ${response.status}`,
      errData?.detail?.error_code
    );
  }

  return await response.blob();
}
