/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { calculateMeanAbsoluteDifference } from './differ';

export interface VisualMemoryEntry {
  id: number;
  capturedAt: number;
  imageBase64: string;
  thumbnail: Uint8Array;
  narration?: string;
}

export interface MemoryFramePayload {
  imageBase64: string;
  secondsAgo: number;
  narration?: string;
}

export interface VisualMemoryOptions {
  maxFrames?: number;
  maxAgeMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  minSceneDiff?: number;
}

const WHEREABOUTS_PATTERN =
  /\b(where|find|found|locate|spot|spotted|saw|seen|earlier|before|passed|previous|behind|back|way|path|route|exit|entrance|door|stairs|steps|lift|elevator|chair|table|bag|phone|keys?|bottle|cup|glasses|cane|sign|washroom|restroom|bathroom|toilet|counter|stop|bus|kaha|kahan|kidhar|rasta|raasta|darwaza|sidhi|peeche|piche|dekha|dekh|kuthe|kothe|kuthay|payrya|jinna|mage|maghe|pahile|disla|disli|disle)\b|[\u0915]\u0939\u093e\u0901|[\u0915]\u093f\u0927\u0930|\u0930\u093e\u0938\u094d\u0924\u093e|\u0926\u0930\u0935\u093e\u091c\u093c\u093e|\u0926\u0930\u0935\u093e\u091c\u093e|\u092a\u0939\u0932\u0947|\u092a\u0940\u091b\u0947|\u0926\u0947\u0916\u093e|\u091c\u093e\u0928\u093e|\u0915\u0941\u0920\u0947|\u0915\u094b\u0920\u0947|\u0926\u093e\u0930|\u092a\u093e\u092f\u0931\u094d\u092f\u093e|\u091c\u093f\u0928\u093e|\u092e\u093e\u0917\u0947|\u0906\u0927\u0940|\u092a\u093e\u0939\u093f\u0932\u0902|\u0926\u093f\u0938\u0932\u0902|\u0926\u093f\u0938\u0932\u093e|\u0926\u093f\u0938\u0932\u0940|\u092c\u093e\u091c\u0942\u0932\u093e/i;

export function isWhereaboutsQuery(text: string): boolean {
  const cleaned = (text || '').trim();
  if (!cleaned) return false;
  return WHEREABOUTS_PATTERN.test(cleaned);
}

/**
 * Rolling ring-buffer of distinct recent camera keyframes so Drishti can recall
 * objects, landmarks, and paths seen in earlier frames when asked whereabouts questions.
 */
export class VisualFrameMemory {
  private entries: VisualMemoryEntry[] = [];
  private nextId = 1;
  private readonly maxFrames: number;
  private readonly maxAgeMs: number;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly minSceneDiff: number;

  constructor(options: VisualMemoryOptions = {}) {
    this.maxFrames = options.maxFrames ?? 12;
    this.maxAgeMs = options.maxAgeMs ?? 120_000;
    this.minIntervalMs = options.minIntervalMs ?? 2000;
    this.maxIntervalMs = options.maxIntervalMs ?? 8000;
    this.minSceneDiff = options.minSceneDiff ?? 6;
  }

  get size(): number {
    return this.entries.length;
  }

  pruneExpired(now = Date.now()): void {
    const cutoff = now - this.maxAgeMs;
    if (this.entries.length > 0 && this.entries[0].capturedAt < cutoff) {
      this.entries = this.entries.filter((e) => e.capturedAt >= cutoff);
    }
  }

  /**
   * Checks cheaply (via 32x24 grayscale thumbnail) whether we should encode and store a new keyframe.
   */
  shouldCaptureFrame(thumbnail: Uint8Array, now = Date.now()): boolean {
    this.pruneExpired(now);
    const latest = this.entries[this.entries.length - 1];
    if (!latest) return true;

    const elapsed = now - latest.capturedAt;
    if (elapsed < this.minIntervalMs) return false;
    if (elapsed >= this.maxIntervalMs) return true;

    const diff = calculateMeanAbsoluteDifference(thumbnail, latest.thumbnail);
    return diff >= this.minSceneDiff;
  }

  recordFrame(
    imageBase64: string,
    thumbnail: Uint8Array,
    now = Date.now(),
    narration?: string
  ): VisualMemoryEntry | null {
    if (!imageBase64) return null;
    this.pruneExpired(now);

    const entry: VisualMemoryEntry = {
      id: this.nextId++,
      capturedAt: now,
      imageBase64,
      thumbnail,
      narration: narration?.trim() || undefined,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxFrames) {
      this.entries = this.entries.slice(this.entries.length - this.maxFrames);
    }
    return entry;
  }

  /**
   * Attaches a spoken scene narration to the latest memory frame (within 10s).
   */
  annotateLatest(narration: string, now = Date.now()): void {
    const clean = (narration || '').trim();
    if (!clean || this.entries.length === 0) return;
    const latest = this.entries[this.entries.length - 1];
    if (now - latest.capturedAt <= 10_000) {
      latest.narration = clean;
    }
  }

  /**
   * Selects a chronological list (oldest -> newest) of distinct past frames
   * to send alongside the live frame when answering a user question.
   */
  selectFramesForQuestion(
    now = Date.now(),
    currentThumbnail?: Uint8Array | null,
    questionText = ''
  ): MemoryFramePayload[] {
    this.pruneExpired(now);
    if (this.entries.length === 0) return [];

    const maxToSend = isWhereaboutsQuery(questionText) || !questionText.trim() ? 4 : 1;

    // Exclude frames that are virtually identical to the current live view or captured <1.5s ago
    const candidates = this.entries.filter((entry) => {
      if (now - entry.capturedAt < 1500) return false;
      if (currentThumbnail && currentThumbnail.length === entry.thumbnail.length) {
        const diff = calculateMeanAbsoluteDifference(currentThumbnail, entry.thumbnail);
        if (diff < 4) return false;
      }
      return true;
    });

    if (candidates.length === 0) return [];

    // Sample evenly across candidates if we have more than maxToSend, always keeping chronological order
    let chosen: VisualMemoryEntry[];
    if (candidates.length <= maxToSend) {
      chosen = candidates;
    } else if (maxToSend === 1) {
      chosen = [candidates[candidates.length - 1]];
    } else {
      chosen = [];
      const lastIdx = candidates.length - 1;
      for (let i = 0; i < maxToSend; i++) {
        const idx = Math.round((i * lastIdx) / (maxToSend - 1));
        if (!chosen.includes(candidates[idx])) {
          chosen.push(candidates[idx]);
        }
      }
    }

    return chosen.map((entry) => ({
      imageBase64: entry.imageBase64,
      secondsAgo: Math.max(1, Math.round((now - entry.capturedAt) / 1000)),
      ...(entry.narration ? { narration: entry.narration } : {}),
    }));
  }

  reset(): void {
    this.entries = [];
  }
}
