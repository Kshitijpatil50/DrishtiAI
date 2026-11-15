/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  resampleToGrayscaleThumbnail,
  calculateMeanAbsoluteDifference,
  shouldTriggerSceneNarration,
  THUMBNAIL_WIDTH,
  THUMBNAIL_HEIGHT,
} from './differ';

export interface CapturedFrame {
  base64Data: string;
  thumbnail: Uint8Array;
}

/**
 * Generates a synthetic camera frame if video feed has not provided dimensions yet
 */
export function getFallbackFrameBase64(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#E5E7EB';
    ctx.fillRect(0, 0, 640, 480);
    // Floor
    ctx.fillStyle = '#D1D5DB';
    ctx.fillRect(0, 260, 640, 220);
    // Door ahead
    ctx.fillStyle = '#9CA3AF';
    ctx.fillRect(260, 100, 120, 240);
    // Table on left
    ctx.fillStyle = '#6B7280';
    ctx.fillRect(40, 240, 160, 100);
  }
  return canvas.toDataURL('image/jpeg', 0.7).replace(/^data:image\/jpeg;base64,/, '');
}

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

let thumbCanvas: HTMLCanvasElement | null = null;
let thumbCtx: CanvasRenderingContext2D | null = null;

/**
 * Captures only the lightweight 32x24 grayscale thumbnail for change detection,
 * avoiding expensive JPEG data-URL encoding when the scene hasn't changed.
 */
export function captureVideoThumbnail(video: HTMLVideoElement): Uint8Array | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  if (video.paused && video.srcObject) {
    video.play().catch(() => {});
  }

  if (!thumbCanvas) {
    thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMBNAIL_WIDTH;
    thumbCanvas.height = THUMBNAIL_HEIGHT;
  }
  if (!thumbCtx) {
    thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = thumbCtx;
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  const imgData = ctx.getImageData(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  return resampleToGrayscaleThumbnail(
    imgData.data,
    THUMBNAIL_WIDTH,
    THUMBNAIL_HEIGHT,
    THUMBNAIL_WIDTH,
    THUMBNAIL_HEIGHT
  );
}

/**
 * Encodes only the base64 JPEG from the current video frame (without thumbnail recomputation).
 */
export function encodeVideoFrameBase64(
  video: HTMLVideoElement,
  maxWidth = 320,
  quality = 0.5
): string | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  if (video.paused && video.srcObject) {
    video.play().catch(() => {});
  }

  const origWidth = video.videoWidth;
  const origHeight = video.videoHeight;

  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (targetWidth > maxWidth) {
    const ratio = maxWidth / targetWidth;
    targetWidth = maxWidth;
    targetHeight = Math.round(origHeight * ratio);
  }

  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
  }
  if (sharedCanvas.width !== targetWidth) sharedCanvas.width = targetWidth;
  if (sharedCanvas.height !== targetHeight) sharedCanvas.height = targetHeight;

  if (!sharedCtx) {
    sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = sharedCtx;
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
  return sharedCanvas.toDataURL('image/jpeg', quality).replace(/^data:image\/jpeg;base64,/, '');
}

/**
 * Grabs a frame from the live video element.
 * Scales down to max width 320px, encodes as JPEG quality 0.5 for fast low-latency processing.
 */
export function captureVideoFrame(
  video: HTMLVideoElement,
  maxWidth = 320,
  quality = 0.5
): CapturedFrame | null {
  const base64Data = encodeVideoFrameBase64(video, maxWidth, quality);
  if (!base64Data) return null;
  const thumbnail = captureVideoThumbnail(video);
  if (!thumbnail) return null;

  return {
    base64Data,
    thumbnail,
  };
}

/**
 * Manages vision loop states and difference computations
 */
export class VisionTracker {
  private lastDescribedThumbnail: Uint8Array | null = null;
  private lastGeminiCallTime = 0;
  private lastNarrationTime = 0;
  private holdUntilTime = 0;
  private isProcessing = false;

  get isBusy(): boolean {
    return this.isProcessing;
  }

  markProcessing(busy: boolean) {
    this.isProcessing = busy;
    this.lastGeminiCallTime = Date.now();
  }

  markNarrationSpoken(thumbnail?: Uint8Array) {
    this.lastNarrationTime = Date.now();
    if (thumbnail) {
      this.lastDescribedThumbnail = thumbnail;
    }
  }

  /**
   * Records that an interactive answer just described the current scene so
   * proactive background narration pauses briefly instead of repeating the answer.
   */
  markSceneAcknowledged(thumbnail?: Uint8Array | null, holdMs = 1800) {
    const now = Date.now();
    this.lastNarrationTime = now;
    this.lastGeminiCallTime = now;
    this.holdUntilTime = now + holdMs;
    if (thumbnail) {
      this.lastDescribedThumbnail = thumbnail;
    }
  }

  /**
   * Evaluates if a frame should trigger a Gemini scene narration
   */
  checkShouldTrigger(currentThumbnail: Uint8Array): { trigger: boolean; diff: number } {
    if (this.isProcessing) {
      return { trigger: false, diff: 0 };
    }

    const now = Date.now();
    if (now < this.holdUntilTime) {
      return { trigger: false, diff: 0 };
    }

    const timeSinceLastCall =
      this.lastGeminiCallTime === 0 ? 999999 : now - this.lastGeminiCallTime;
    const timeSinceLastNarration =
      this.lastNarrationTime === 0 ? 999999 : now - this.lastNarrationTime;

    let diff = 0;
    if (this.lastDescribedThumbnail) {
      diff = calculateMeanAbsoluteDifference(currentThumbnail, this.lastDescribedThumbnail);
    } else {
      // First frame ever
      diff = 100;
    }

    const trigger = shouldTriggerSceneNarration(diff, timeSinceLastCall, timeSinceLastNarration);
    return { trigger, diff };
  }

  reset() {
    this.lastDescribedThumbnail = null;
    this.lastGeminiCallTime = 0;
    this.lastNarrationTime = 0;
    this.holdUntilTime = 0;
    this.isProcessing = false;
  }
}

/**
 * Creates a synthetic camera & audio MediaStream for test/headless environments
 */
export function createSimulatedMediaStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;

  let frameCount = 0;
  const draw = () => {
    frameCount++;
    // Draw simple simulated scene: floor, door, table
    ctx.fillStyle = '#E5E7EB';
    ctx.fillRect(0, 0, 640, 480);

    // Floor
    ctx.fillStyle = '#D1D5DB';
    ctx.fillRect(0, 260, 640, 220);

    // Door ahead
    ctx.fillStyle = '#9CA3AF';
    ctx.fillRect(260, 100, 120, 240);

    // Table on left
    ctx.fillStyle = '#6B7280';
    ctx.fillRect(40, 240, 160, 100);

    // Subtle movement to simulate user holding camera
    const driftX = Math.sin(frameCount * 0.05) * 5;
    ctx.fillStyle = '#1F2937';
    ctx.fillRect(280 + driftX, 220, 15, 15); // door handle

    requestAnimationFrame(draw);
  };
  draw();

  const videoTrack = (canvas as any).captureStream(20).getVideoTracks()[0];

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();
  const audioTrack = dest.stream.getAudioTracks()[0];

  return new MediaStream([videoTrack, audioTrack]);
}
