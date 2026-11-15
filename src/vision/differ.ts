/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const THUMBNAIL_WIDTH = 32;
export const THUMBNAIL_HEIGHT = 24;
export const THUMBNAIL_PIXELS = THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT;

/**
 * Computes mean absolute difference between two grayscale thumbnails.
 */
export function calculateMeanAbsoluteDifference(
  thumbnailA: Uint8Array,
  thumbnailB: Uint8Array
): number {
  if (thumbnailA.length !== thumbnailB.length || thumbnailA.length === 0) {
    return 0;
  }

  let totalDiff = 0;
  for (let i = 0; i < thumbnailA.length; i++) {
    totalDiff += Math.abs(thumbnailA[i] - thumbnailB[i]);
  }

  return totalDiff / thumbnailA.length;
}

export const MIN_DIFF_THRESHOLD = 8;
export const CALL_COOLDOWN_MS = 1500;
export const MAX_SILENCE_TIMEOUT_MS = 5000;

/**
 * Checks whether the proactive vision narration should trigger based on:
 * - diff > 8 AND at least 1.8s (1800ms) since the last Gemini call
 * OR
 * - 5s (5000ms) since the last narration
 */
export function shouldTriggerSceneNarration(
  diff: number,
  timeSinceLastCallMs: number,
  timeSinceLastNarrationMs: number
): boolean {
  if (timeSinceLastCallMs < CALL_COOLDOWN_MS) {
    return false;
  }
  if (timeSinceLastNarrationMs >= MAX_SILENCE_TIMEOUT_MS) {
    return true;
  }
  if (diff > MIN_DIFF_THRESHOLD) {
    return true;
  }
  return false;
}

/**
 * Resamples RGBA image pixels into a 32x24 8-bit grayscale array.
 */
export function resampleToGrayscaleThumbnail(
  sourceRgba: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = THUMBNAIL_WIDTH,
  targetHeight = THUMBNAIL_HEIGHT
): Uint8Array {
  const result = new Uint8Array(targetWidth * targetHeight);
  const xRatio = sourceWidth / targetWidth;
  const yRatio = sourceHeight / targetHeight;

  for (let ty = 0; ty < targetHeight; ty++) {
    const sy = Math.floor(ty * yRatio);
    for (let tx = 0; tx < targetWidth; tx++) {
      const sx = Math.floor(tx * xRatio);
      const srcIdx = (sy * sourceWidth + sx) * 4;
      const r = sourceRgba[srcIdx] || 0;
      const g = sourceRgba[srcIdx + 1] || 0;
      const b = sourceRgba[srcIdx + 2] || 0;
      // Rec. 601 luma formula
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      result[ty * targetWidth + tx] = gray;
    }
  }

  return result;
}
