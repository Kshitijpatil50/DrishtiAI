/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AppState =
  | 'IDLE'
  | 'OBSERVING'
  | 'LISTENING'
  | 'TRANSCRIBING'
  | 'THINKING'
  | 'SPEAKING'
  | 'QUIET';

export type LanguageCode = 'en' | 'hi';

export interface AssistantState {
  state: AppState;
  isQuiet: boolean;
  language: LanguageCode;
  requestToken: number;
  lastTranscript: string;
  lastSpokenText: string;
  recentNarration: string[]; // up to 3 recent descriptions
  consecutiveSttFailures: number;
}

export const INITIAL_STATE: AssistantState = {
  state: 'IDLE',
  isQuiet: false,
  language: 'en',
  requestToken: 0,
  lastTranscript: '',
  lastSpokenText: '',
  recentNarration: [],
  consecutiveSttFailures: 0,
};

export type StateAction =
  | { type: 'START' }
  | { type: 'START_LISTENING' }
  | { type: 'SPEECH_CAPTURED' }
  | { type: 'TRANSCRIPTION_SUCCESS'; transcript: string; detectedLanguage?: LanguageCode }
  | { type: 'TRANSCRIPTION_EMPTY' }
  | { type: 'TRANSCRIPTION_FAILED' }
  | { type: 'THINKING_START' }
  | { type: 'SPEAKING_START'; text: string; isNarration?: boolean }
  | { type: 'SPEAKING_FINISHED' }
  | { type: 'BARGE_IN_OR_TAP' }
  | { type: 'TOGGLE_QUIET' }
  | { type: 'REQUEST_FAILED' }
  | { type: 'SET_LANGUAGE'; language: LanguageCode };

export function transitionState(
  current: AssistantState,
  action: StateAction
): AssistantState {
  switch (action.type) {
    case 'START':
      return {
        ...current,
        state: current.isQuiet ? 'QUIET' : 'OBSERVING',
        consecutiveSttFailures: 0,
      };

    case 'START_LISTENING':
    case 'BARGE_IN_OR_TAP':
      // Barge-in or interrupt increments request token to invalidate in-flight tasks
      return {
        ...current,
        state: 'LISTENING',
        requestToken: current.requestToken + 1,
      };

    case 'SPEECH_CAPTURED':
      if (current.state === 'LISTENING') {
        return {
          ...current,
          state: 'TRANSCRIBING',
        };
      }
      return current;

    case 'TRANSCRIPTION_SUCCESS':
      return {
        ...current,
        state: 'THINKING',
        lastTranscript: action.transcript,
        language: action.detectedLanguage || current.language,
        consecutiveSttFailures: 0,
      };

    case 'TRANSCRIPTION_EMPTY':
      // Empty transcript is treated as noise, silently return to base state
      return {
        ...current,
        state: current.isQuiet ? 'QUIET' : 'OBSERVING',
      };

    case 'TRANSCRIPTION_FAILED': {
      const failures = current.consecutiveSttFailures + 1;
      return {
        ...current,
        state: current.isQuiet ? 'QUIET' : 'OBSERVING',
        consecutiveSttFailures: failures,
      };
    }

    case 'THINKING_START':
      return {
        ...current,
        state: 'THINKING',
      };

    case 'SPEAKING_START': {
      const recent =
        action.isNarration && current.recentNarration[0] !== action.text
          ? [action.text, ...current.recentNarration].slice(0, 3)
          : current.recentNarration;
      return {
        ...current,
        state: 'SPEAKING',
        lastSpokenText: action.text,
        recentNarration: recent,
      };
    }

    case 'SPEAKING_FINISHED':
      if (current.state === 'SPEAKING') {
        return {
          ...current,
          state: current.isQuiet ? 'QUIET' : 'OBSERVING',
        };
      }
      return current;

    case 'REQUEST_FAILED':
      return {
        ...current,
        state: current.isQuiet ? 'QUIET' : 'OBSERVING',
      };

    case 'TOGGLE_QUIET': {
      const nextQuiet = !current.isQuiet;
      return {
        ...current,
        isQuiet: nextQuiet,
        state: nextQuiet ? 'QUIET' : 'OBSERVING',
        requestToken: current.requestToken + 1,
      };
    }

    case 'SET_LANGUAGE':
      return {
        ...current,
        language: action.language,
      };

    default:
      return current;
  }
}
