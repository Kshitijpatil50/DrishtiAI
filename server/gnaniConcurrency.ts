/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function extractGnaniErrorText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return '';
  const obj = body as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['detail', 'error', 'message', 'error_code']) {
    const val = obj[key];
    if (typeof val === 'string') {
      parts.push(val);
    } else if (val && typeof val === 'object') {
      parts.push(extractGnaniErrorText(val));
    }
  }
  return parts.join(' ');
}

/**
 * Returns true if Gnani rejected the call due to its strict 1-active-request concurrency limit
 * or HTTP 429 throttling.
 */
export function isGnaniBusyResponse(status: number, body: unknown): boolean {
  if (status === 429) return true;
  const text = extractGnaniErrorText(body).toLowerCase();
  return (
    text.includes('active request') ||
    text.includes('1 active request') ||
    text.includes('too many requests') ||
    text.includes('rate limit')
  );
}

/**
 * Returns true if Gnani returned a transient HTTP error safe to retry quickly.
 */
export function isGnaniTransientError(status: number, body: unknown): boolean {
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return isGnaniBusyResponse(status, body);
}

export interface ServerQueueOptions {
  cooldownAfterAbortMs?: number;
}

interface PendingServerTask<T> {
  task: (signal: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Server-side serial mutex guaranteeing at most ONE upstream Gnani API call (STT or TTS)
 * is in-flight at a time per server instance, preventing "Only 1 active request is allowed"
 * collisions across prefetches, barge-ins, retries, and concurrent endpoints.
 */
export class GnaniServerQueue {
  private pending: PendingServerTask<any>[] = [];
  private isProcessing = false;
  private readonly cooldownAfterAbortMs: number;

  constructor(options: ServerQueueOptions = {}) {
    this.cooldownAfterAbortMs = options.cooldownAfterAbortMs ?? 250;
  }

  get queueDepth(): number {
    return this.pending.length;
  }

  get active(): boolean {
    return this.isProcessing;
  }

  enqueue<T>(
    task: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Client disconnected before Gnani call started', 'AbortError'));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: PendingServerTask<T> = {
        task,
        signal,
        resolve,
        reject,
      };

      if (signal) {
        const onAbort = () => {
          const idx = this.pending.indexOf(entry);
          if (idx >= 0) {
            this.pending.splice(idx, 1);
            reject(new DOMException('Client disconnected while waiting in Gnani queue', 'AbortError'));
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.push(entry);
      void this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.pending.length === 0) {
      return;
    }

    this.isProcessing = true;
    const current = this.pending.shift()!;

    if (current.signal?.aborted) {
      current.reject(new DOMException('Client disconnected before Gnani call started', 'AbortError'));
      this.isProcessing = false;
      void this.processNext();
      return;
    }

    const taskController = new AbortController();
    const forwardAbort = () => taskController.abort(current.signal?.reason);
    current.signal?.addEventListener('abort', forwardAbort, { once: true });

    let wasAborted = false;
    try {
      const result = await current.task(taskController.signal);
      current.resolve(result);
    } catch (err) {
      wasAborted = Boolean(current.signal?.aborted || taskController.signal.aborted);
      current.reject(err);
    } finally {
      current.signal?.removeEventListener('abort', forwardAbort);
      if (wasAborted && this.cooldownAfterAbortMs > 0) {
        await new Promise((r) => setTimeout(r, this.cooldownAfterAbortMs));
      }
      this.isProcessing = false;
      void this.processNext();
    }
  }
}
