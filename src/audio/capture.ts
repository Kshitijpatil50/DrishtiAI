/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { downsampleAudio, createWavBlob } from './wav';
import {
  getSpeechOnsetThreshold,
  getRequiredOnsetMs,
  getSilenceLimitMs,
} from './vad';
import type { LanguageCode } from '../state/machine';

export interface AudioCaptureCallbacks {
  onSpeechStart: (isBargeIn: boolean) => void;
  onSpeechEnd: (wavBlob: Blob, durationMs: number, fallbackTranscript?: string) => void;
  onInterimTranscript?: (transcript: string) => void;
  onRmsUpdate?: (rms: number) => void;
}

const AUDIO_WORKLET_CODE = `
class VaderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(1024);
    this._offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const ch = input[0];
      let srcIdx = 0;
      while (srcIdx < ch.length) {
        const space = this._buffer.length - this._offset;
        const count = Math.min(space, ch.length - srcIdx);
        this._buffer.set(ch.subarray(srcIdx, srcIdx + count), this._offset);
        this._offset += count;
        srcIdx += count;
        if (this._offset >= this._buffer.length) {
          this.port.postMessage(this._buffer);
          this._buffer = new Float32Array(1024);
          this._offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('vader-processor', VaderProcessor);
`;

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;

  private isRunning = false;
  private isSpeaking = false; // assistant speaking state (raises VAD threshold for safe barge-in)
  private echoSuppressUntil = 0; // post-speech acoustic echo tail cooldown timestamp
  private isSpeechActive = false; // user speech currently detected
  private isManualListening = false; // explicit tap-to-talk bypasses echo gating
  private readonly ECHO_COOLDOWN_MS = 250;
  private lastRmsEmitAt = 0;
  private lastEmittedRms = -1;

  // Native SpeechRecognition instance for seamless fallback
  private speechRecognition: any = null;
  private currentFallbackTranscript = '';
  private recognitionLang = 'en-IN';

  // VAD parameters
  private noiseFloor = 0.01;
  private speechStartDurationMs = 0;
  private silenceDurationMs = 0;
  private totalSpeechDurationMs = 0;
  private hasHeardSpeech = false;

  // 400ms pre-roll circular buffer
  private preRollBuffer: Float32Array[] = [];
  private preRollLengthSamples = 0;
  private maxPreRollSamples = 0;

  // Active recording buffer
  private recordedChunks: Float32Array[] = [];

  private callbacks: AudioCaptureCallbacks | null = null;

  /**
   * Updates whether Drishti is currently speaking to prevent acoustic echo capture
   */
  setAssistantSpeaking(speaking: boolean) {
    if (speaking) {
      this.isSpeaking = true;
      this.echoSuppressUntil = 0;
      this.speechStartDurationMs = 0;
      if (this.isSpeechActive && !this.isManualListening) {
        this.cancelCurrentSpeech();
      }
    } else {
      const wasSpeaking = this.isSpeaking;
      this.isSpeaking = false;
      if (wasSpeaking) {
        this.echoSuppressUntil = Date.now() + this.ECHO_COOLDOWN_MS;
      }
      this.speechStartDurationMs = 0;
      if (!this.isSpeechActive) {
        this.currentFallbackTranscript = '';
      }
    }
  }

  /**
   * Sets the language for SpeechRecognition fallback ('en-IN', 'hi-IN', or 'mr-IN')
   */
  setLanguage(lang: LanguageCode) {
    this.recognitionLang = lang === 'mr' ? 'mr-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
    if (this.speechRecognition) {
      try {
        this.speechRecognition.lang = this.recognitionLang;
      } catch {
        // ignore
      }
    }
  }

  /**
   * Initializes microphone capture and VAD using AudioWorklet with ScriptProcessor fallback
   */
  async start(stream: MediaStream, callbacks: AudioCaptureCallbacks): Promise<void> {
    if (this.isRunning) return;

    this.mediaStream = stream;
    this.callbacks = callbacks;
    this.isRunning = true;
    this.isSpeechActive = false;

    // Initialize native SpeechRecognition for fallback if available in browser
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        const recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = this.recognitionLang;
        recognition.onresult = (e: any) => {
          if (!this.isSpeechActive) {
            return;
          }
          if ((this.isSpeaking || Date.now() < this.echoSuppressUntil) && !this.isManualListening) {
            return;
          }
          let text = '';
          for (let i = 0; i < e.results.length; i++) {
            text += e.results[i][0].transcript;
          }
          const cleaned = text.trim();
          if (cleaned) {
            this.currentFallbackTranscript = cleaned;
            this.callbacks?.onInterimTranscript?.(cleaned);
          }
        };
        recognition.onerror = () => {
          // Ignore SpeechRecognition errors (handled gracefully via WAV STT)
        };
        this.speechRecognition = recognition;
      } catch {
        // ignore
      }
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioCtx();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const sampleRate = this.audioContext.sampleRate;
    // 400ms pre-roll buffer in samples
    this.maxPreRollSamples = Math.round(sampleRate * 0.4);

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    let useWorkletSuccess = false;

    // Try AudioWorklet first as specified in section 5
    if (this.audioContext.audioWorklet) {
      try {
        const blob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        try {
          await this.audioContext.audioWorklet.addModule(workletUrl);
        } finally {
          URL.revokeObjectURL(workletUrl);
        }

        this.workletNode = new AudioWorkletNode(this.audioContext, 'vader-processor');
        this.workletNode.port.onmessage = (e: MessageEvent) => {
          if (!this.isRunning) return;
          const chunk: Float32Array = e.data;
          this.handleAudioChunk(chunk, sampleRate);
        };

        this.sourceNode.connect(this.workletNode);
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0;
        this.workletNode.connect(silentGain);
        silentGain.connect(this.audioContext.destination);
        useWorkletSuccess = true;
      } catch (err) {
        console.warn('AudioWorklet failed, using ScriptProcessorNode fallback:', err);
        useWorkletSuccess = false;
      }
    }

    // Fallback to ScriptProcessor if AudioWorklet unavailable
    if (!useWorkletSuccess) {
      const bufferSize = 2048;
      const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.scriptProcessorNode = processor;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.isRunning) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(inputData);
        this.handleAudioChunk(chunk, sampleRate);
      };

      this.sourceNode.connect(processor);
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(this.audioContext.destination);
    }
  }

  private handleAudioChunk(chunk: Float32Array, sampleRate: number) {
    const chunkDurationMs = (chunk.length / sampleRate) * 1000;

    // Calculate RMS
    let sumSq = 0;
    for (let i = 0; i < chunk.length; i++) {
      sumSq += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sumSq / chunk.length);

    if (this.callbacks?.onRmsUpdate) {
      const inEchoWindow = (this.isSpeaking || Date.now() < this.echoSuppressUntil) && !this.isSpeechActive;
      const nextRms = inEchoWindow && rms < getSpeechOnsetThreshold(this.noiseFloor, true) ? 0 : rms;
      const now = Date.now();
      if (
        now - this.lastRmsEmitAt >= 40 &&
        !(nextRms === 0 && this.lastEmittedRms === 0)
      ) {
        this.lastRmsEmitAt = now;
        this.lastEmittedRms = nextRms;
        this.callbacks.onRmsUpdate(nextRms);
      }
    }

    this.processVadChunk(chunk, rms, chunkDurationMs);
  }

  private processVadChunk(chunk: Float32Array, rms: number, chunkDurationMs: number) {
    if (!this.isSpeechActive) {
      const inSpeakingOrTail = this.isSpeaking || Date.now() < this.echoSuppressUntil;

      // Always keep the 400ms pre-roll buffer warm so hands-free barge-in never clips opening words
      this.preRollBuffer.push(chunk);
      this.preRollLengthSamples += chunk.length;
      while (this.preRollLengthSamples > this.maxPreRollSamples && this.preRollBuffer.length > 0) {
        const removed = this.preRollBuffer.shift()!;
        this.preRollLengthSamples -= removed.length;
      }

      // Adaptive noise floor only updates while the assistant is quiet so playback never inflates noiseFloor
      if (!inSpeakingOrTail && rms < this.noiseFloor * 1.5) {
        this.noiseFloor = Math.max(0.005, this.noiseFloor * 0.98 + rms * 0.02);
      }

      const threshold = getSpeechOnsetThreshold(this.noiseFloor, inSpeakingOrTail);
      const requiredOnsetMs = getRequiredOnsetMs(inSpeakingOrTail);

      if (rms > threshold) {
        this.speechStartDurationMs += chunkDurationMs;
        if (this.speechStartDurationMs >= requiredOnsetMs) {
          const wasSpeaking = this.isSpeaking;
          this.isSpeaking = false;
          this.echoSuppressUntil = 0;
          this.isSpeechActive = true;
          this.isManualListening = false;
          this.hasHeardSpeech = true;
          this.silenceDurationMs = 0;
          this.totalSpeechDurationMs = 0;
          this.currentFallbackTranscript = '';

          if (this.speechRecognition) {
            try {
              this.speechRecognition.start();
            } catch {
              // ignore if already started
            }
          }

          this.recordedChunks = [...this.preRollBuffer];
          this.callbacks?.onSpeechStart(wasSpeaking);
        }
      } else {
        this.speechStartDurationMs = Math.max(0, this.speechStartDurationMs - chunkDurationMs * 0.5);
      }
    } else {
      // Speech is active, accumulate chunk
      this.recordedChunks.push(chunk);
      this.totalSpeechDurationMs += chunkDurationMs;

      const silenceThreshold = Math.max(0.012, this.noiseFloor * 2.0);
      if (rms >= silenceThreshold) {
        this.hasHeardSpeech = true;
        this.silenceDurationMs = 0;
      } else {
        this.silenceDurationMs += chunkDurationMs;
      }

      const silenceLimitMs = getSilenceLimitMs(this.hasHeardSpeech, this.totalSpeechDurationMs);
      // Hard-stop at 25 s (API limit is 30 s) OR silence duration >= limit
      if (this.silenceDurationMs >= silenceLimitMs || this.totalSpeechDurationMs >= 25000) {
        this.finishSpeechCapture();
      }
    }
  }

  /**
   * Finishes current speech capture and emits WAV Blob + optional fallback transcript
   */
  private finishSpeechCapture() {
    if (!this.isSpeechActive) return;

    this.isSpeechActive = false;
    this.isManualListening = false;
    this.speechStartDurationMs = 0;
    this.silenceDurationMs = 0;

    // Stop fallback speech recognition
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {
        // ignore
      }
    }

    const totalDuration = this.totalSpeechDurationMs;
    const fallbackText = this.currentFallbackTranscript.trim();
    const chunks = this.recordedChunks;
    this.recordedChunks = [];
    this.preRollBuffer = [];
    this.preRollLengthSamples = 0;
    this.currentFallbackTranscript = '';

    // If clip is shorter than 400ms or empty, notify callback with empty WAV to return to OBSERVING
    if (totalDuration < 400 || chunks.length === 0) {
      const emptyWav = createWavBlob(new Float32Array(0), 16000);
      this.callbacks?.onSpeechEnd(emptyWav, 0, '');
      return;
    }

    // Combine chunks
    let totalSamples = 0;
    for (const c of chunks) {
      totalSamples += c.length;
    }
    const combined = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    // Downsample from AudioContext rate to 16 kHz
    const sourceRate = this.audioContext?.sampleRate || 48000;
    const downsampled = downsampleAudio(combined, sourceRate, 16000);

    // Encode to 16-bit PCM WAV
    const wavBlob = createWavBlob(downsampled, 16000);

    this.callbacks?.onSpeechEnd(wavBlob, totalDuration, fallbackText);
  }

  /**
   * Cancels active speech capture without emitting onSpeechEnd (used on double-tap)
   */
  cancelCurrentSpeech() {
    this.isSpeechActive = false;
    this.isManualListening = false;
    this.speechStartDurationMs = 0;
    this.silenceDurationMs = 0;
    this.totalSpeechDurationMs = 0;
    this.currentFallbackTranscript = '';
    if (this.speechRecognition) {
      try {
        this.speechRecognition.abort();
      } catch {
        // ignore
      }
    }
    this.recordedChunks = [];
    this.preRollBuffer = [];
    this.preRollLengthSamples = 0;
  }

  /**
   * Forces speech capture to complete immediately (used on tap fallback)
   */
  forceEndCaptureNow() {
    if (this.isSpeechActive) {
      this.finishSpeechCapture();
    }
  }

  /**
   * Forces start listening mode (used for push-to-talk tap or tap-to-interrupt)
   */
  forceStartListening() {
    this.isSpeaking = false;
    this.echoSuppressUntil = 0;
    this.isSpeechActive = true;
    this.isManualListening = true;
    this.hasHeardSpeech = false;
    this.speechStartDurationMs = 0;
    this.silenceDurationMs = 0;
    this.totalSpeechDurationMs = 0;
    this.currentFallbackTranscript = '';
    this.preRollBuffer = [];
    this.preRollLengthSamples = 0;
    if (this.speechRecognition) {
      try {
        this.speechRecognition.start();
      } catch {
        // ignore
      }
    }
    this.recordedChunks = [];
    this.callbacks?.onSpeechStart(false);
  }

  stop() {
    this.isRunning = false;
    this.isSpeechActive = false;
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch {
        // ignore
      }
      this.speechRecognition = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.recordedChunks = [];
    this.preRollBuffer = [];
    this.callbacks = null;
  }
}
