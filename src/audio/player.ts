/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { synthesizeSpeech, gnaniQueue, abortGnaniTts } from '../services/gnani';
import { sanitizeForTTS, splitSentences, batchSentencesForTTS } from '../services/sanitize';
import type { LanguageCode } from '../state/machine';

export interface PlayerCallbacks {
  onTextPrepared?: (text: string, isNarration?: boolean) => void;
  onStartSpeaking?: (text: string, isNarration?: boolean) => void;
  onFinishedSpeaking?: () => void;
  onSpeakingActiveChange?: (active: boolean) => void;
  onTtsError?: (message: string) => void;
}

export function isCancellationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; name?: unknown; message?: unknown };
  if (e.status === 499 || e.name === 'AbortError') return true;
  if (typeof e.message === 'string') {
    return /cancel(?:led|ed)?|aborted|stopall/i.test(e.message);
  }
  return false;
}

export class AudioPlayerService {
  private audioCtx: AudioContext | null = null;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private activeToken = -1;
  private currentSpeakId = 0;
  private isStopped = false;
  private activeAudioResolver: (() => void) | null = null;
  private callbacks: PlayerCallbacks = {};

  constructor(callbacks?: PlayerCallbacks) {
    if (callbacks) {
      this.callbacks = callbacks;
    }
  }

  setCallbacks(callbacks: PlayerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Unlocks / resumes a shared AudioContext inside a user gesture so
   * Gnani Shivani audio starts with minimal hardware latency and zero
   * autoplay blocking after async Gemini / Gnani calls.
   */
  unlockAudio(): void {
    if (typeof window === 'undefined') return;
    const ua = (navigator as any).userActivation;
    if (ua && !ua.hasBeenActive && !ua.isActive) {
      return;
    }
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch {
      this.audioCtx = null;
    }
  }

  private async decodeBlobToAudioBuffer(blob: Blob): Promise<AudioBuffer | null> {
    if (!this.audioCtx || this.audioCtx.state !== 'running' || typeof window === 'undefined' || blob.size === 0) {
      return null;
    }
    try {
      const arr = await blob.arrayBuffer();
      return await this.audioCtx.decodeAudioData(arr);
    } catch {
      return null;
    }
  }

  private cleanupPlayback() {
    // Abort any in-flight HTTP TTS requests and clear queued tasks
    abortGnaniTts();
    gnaniQueue.clearPending();

    // Immediately resolve and release any awaiting playback promise
    if (this.activeAudioResolver) {
      const resolver = this.activeAudioResolver;
      this.activeAudioResolver = null;
      resolver();
    }

    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.onended = null;
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {
        // ignore already stopped source
      }
      this.activeSourceNode = null;
    }

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio.removeAttribute('src');
      this.currentAudio.load();
      this.currentAudio = null;
    }

    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  /**
   * Immediately stops audio playback, revokes URLs, and aborts ongoing synthesis
   */
  stopAll() {
    this.currentSpeakId++;
    this.isStopped = true;
    this.activeToken = -1;
    this.cleanupPlayback();
    this.callbacks.onSpeakingActiveChange?.(false);
  }

  /**
   * Speaks speech text using Gnani Timbre v3.0 (Shivani voice only, no browser fallback):
   * 1. Sanitizes text
   * 2. Batches short 1-2 sentence replies into a single fluid breath
   * 3. Synthesizes + decodes audio cleanly via AudioContext (with Audio element fallback)
   * 4. Emits onStartSpeaking right when audio playback starts
   * 5. Prefetches & pre-decodes next chunk while current chunk plays for zero-gap pacing
   */
  async speak(
    rawText: string,
    options: {
      lang?: LanguageCode;
      isHazard?: boolean;
      isNarration?: boolean;
      requestToken: number;
    }
  ): Promise<boolean> {
    const { lang = 'en', requestToken, isNarration } = options;

    // Assign a unique monotonic ID for this speak invocation before aborting any prior utterance
    const speakId = ++this.currentSpeakId;

    // Clean up any previous audio/TTS before starting new utterance
    this.cleanupPlayback();

    // Reset stop state for new utterance
    this.isStopped = false;
    this.activeToken = requestToken;

    const isSuperseded = () =>
      this.isStopped ||
      this.activeToken !== requestToken ||
      this.currentSpeakId !== speakId;

    const sanitized = sanitizeForTTS(rawText, lang);
    if (!sanitized) {
      if (!isSuperseded()) {
        this.callbacks.onFinishedSpeaking?.();
      }
      return true;
    }

    const rawSentences = splitSentences(sanitized);
    // Keep 1-2 sentence conversational replies (up to ~210 chars) in a single fluid call
    const sentences = batchSentencesForTTS(rawSentences, 210, 260);
    if (sentences.length === 0) {
      if (!isSuperseded()) {
        this.callbacks.onFinishedSpeaking?.();
      }
      return true;
    }

    // Surface caption text immediately while Gnani audio synthesizes in the background
    if (!isSuperseded()) {
      this.callbacks.onTextPrepared?.(sanitized, isNarration);
    }

    let announcedStart = false;
    const emitStartOnce = () => {
      if (!announcedStart && !isSuperseded()) {
        announcedStart = true;
        this.callbacks.onSpeakingActiveChange?.(true);
        this.callbacks.onStartSpeaking?.(sanitized, isNarration);
      }
    };

    try {
      let prefetchedNext: Promise<{
        blob?: Blob;
        decoded?: AudioBuffer | null;
        err?: unknown;
      }> | null = null;

      for (let i = 0; i < sentences.length; i++) {
        if (isSuperseded()) {
          return false;
        }

        const sentence = sentences[i];

        // Synthesize current sentence via Gnani TTS (or consume prefetched + pre-decoded)
        let blob: Blob;
        let preDecoded: AudioBuffer | null = null;
        try {
          if (prefetchedNext) {
            const prefetchedResult = await prefetchedNext;
            prefetchedNext = null;
            if (isSuperseded()) {
              return false;
            }
            if (prefetchedResult.err || !prefetchedResult.blob || prefetchedResult.blob.size === 0) {
              throw prefetchedResult.err || new Error('Empty prefetched TTS audio');
            }
            blob = prefetchedResult.blob;
            preDecoded = prefetchedResult.decoded ?? null;
          } else {
            blob = await synthesizeSpeech(sentence, { isHazard: options.isHazard });
          }
          if (isSuperseded()) {
            return false;
          }
        } catch (gnaniErr: any) {
          if (isSuperseded() || isCancellationError(gnaniErr)) {
            if (!isSuperseded()) {
              this.callbacks.onSpeakingActiveChange?.(false);
              this.callbacks.onFinishedSpeaking?.();
            }
            return false;
          }
          console.error('Gnani TTS failed (no fallback voice permitted):', gnaniErr);
          this.callbacks.onSpeakingActiveChange?.(false);
          if (!announcedStart) {
            this.callbacks.onStartSpeaking?.(sanitized, isNarration);
          }
          this.callbacks.onFinishedSpeaking?.();
          this.callbacks.onTtsError?.(
            gnaniErr?.message || 'Gnani voice service could not synthesize audio.'
          );
          return false;
        }

        if (isSuperseded()) {
          return false;
        }

        const bufferToPlay = preDecoded ?? (await this.decodeBlobToAudioBuffer(blob));
        if (isSuperseded()) {
          return false;
        }

        // Prefetch & pre-decode next sentence while current sentence starts playing
        if (i + 1 < sentences.length) {
          const nextSentence = sentences[i + 1];
          prefetchedNext = synthesizeSpeech(nextSentence, { isHazard: options.isHazard })
            .then(async (b) => ({
              blob: b,
              decoded: await this.decodeBlobToAudioBuffer(b),
            }))
            .catch((err) => ({ err }));
        }

        // Audio is ready: transition caption & start Gnani Shivani voice cleanly
        emitStartOnce();
        if (bufferToPlay) {
          await this.playDecodedBuffer(bufferToPlay, requestToken, speakId);
        } else {
          await this.playAudioBlob(blob, requestToken, speakId);
        }
      }

      if (!isSuperseded()) {
        this.callbacks.onSpeakingActiveChange?.(false);
        this.callbacks.onFinishedSpeaking?.();
      }
      return true;
    } catch (err: any) {
      if (isSuperseded() || isCancellationError(err)) {
        if (!isSuperseded()) {
          this.callbacks.onSpeakingActiveChange?.(false);
          this.callbacks.onFinishedSpeaking?.();
        }
        return false;
      }
      console.error('Gnani audio playback error:', err);
      this.callbacks.onSpeakingActiveChange?.(false);
      if (!announcedStart) {
        this.callbacks.onStartSpeaking?.(sanitized, isNarration);
      }
      this.callbacks.onFinishedSpeaking?.();
      this.callbacks.onTtsError?.(err?.message || 'Gnani audio playback failed.');
      return false;
    }
  }

  private playDecodedBuffer(
    buffer: AudioBuffer,
    requestToken: number,
    speakId: number
  ): Promise<void> {
    return new Promise((resolve) => {
      if (
        !this.audioCtx ||
        this.isStopped ||
        this.activeToken !== requestToken ||
        this.currentSpeakId !== speakId
      ) {
        resolve();
        return;
      }

      let isDone = false;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);
      this.activeSourceNode = source;

      const finish = () => {
        if (isDone) return;
        isDone = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        source.onended = null;
        if (this.activeAudioResolver === finish) {
          this.activeAudioResolver = null;
        }
        if (this.activeSourceNode === source) {
          try {
            source.disconnect();
          } catch {
            // ignore
          }
          this.activeSourceNode = null;
        }
        resolve();
      };

      this.activeAudioResolver = finish;
      source.onended = finish;
      const maxDurationMs = Math.max(4000, Math.ceil(buffer.duration * 1000) + 2500);
      safetyTimer = setTimeout(finish, maxDurationMs);

      try {
        source.start(0);
      } catch {
        finish();
      }
    });
  }

  private playAudioBlob(blob: Blob, requestToken: number, speakId: number): Promise<void> {
    return new Promise((resolve) => {
      if (
        this.isStopped ||
        this.activeToken !== requestToken ||
        this.currentSpeakId !== speakId ||
        blob.size === 0
      ) {
        resolve();
        return;
      }

      if (this.currentBlobUrl) {
        URL.revokeObjectURL(this.currentBlobUrl);
      }

      const url = URL.createObjectURL(blob);
      this.currentBlobUrl = url;
      const audio = new Audio(url);
      audio.preload = 'auto';
      this.currentAudio = audio;

      let isDone = false;
      let safetyTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (isDone) return;
        isDone = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        audio.removeEventListener('ended', finish);
        audio.removeEventListener('error', finish);
        if (this.activeAudioResolver === finish) {
          this.activeAudioResolver = null;
        }
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        URL.revokeObjectURL(url);
        if (this.currentBlobUrl === url) {
          this.currentBlobUrl = null;
        }
        resolve();
      };

      this.activeAudioResolver = finish;

      audio.addEventListener('ended', finish);
      audio.addEventListener('error', (e) => {
        console.warn('Audio element error:', e);
        finish();
      });

      // Safety timeout: prevent promise hanging indefinitely if audio driver or background tab stalls
      safetyTimer = setTimeout(() => {
        finish();
      }, 15000);

      audio.play().catch((err) => {
        console.warn('Audio play() failed:', err);
        finish();
      });
    });
  }
}
