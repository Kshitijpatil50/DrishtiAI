/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Computes the adaptive RMS threshold to trigger voice onset.
 * While Drishti is actively speaking, require much stronger energy so
 * normal speaker output cancelled by AEC does not cause false self-barge-in,
 * while intentional human speech interrupts cleanly.
 */
export function getSpeechOnsetThreshold(
  noiseFloor: number,
  isAssistantSpeaking: boolean
): number {
  if (isAssistantSpeaking) {
    return Math.max(0.048, noiseFloor * 6.0);
  }
  return Math.max(0.014, noiseFloor * 2.8);
}

/**
 * Sustained speech duration required to confirm onset.
 * 400ms pre-roll preserves the opening syllable in both modes.
 */
export function getRequiredOnsetMs(isAssistantSpeaking: boolean): number {
  return isAssistantSpeaking ? 140 : 75;
}

/**
 * Dynamic end-of-utterance silence limit so turns end promptly without
 * cutting off mid-phrase pauses.
 */
export function getSilenceLimitMs(
  hasHeardSpeech: boolean,
  totalSpeechDurationMs: number
): number {
  if (!hasHeardSpeech) {
    return 1800;
  }
  return totalSpeechDurationMs >= 500 ? 420 : 520;
}
