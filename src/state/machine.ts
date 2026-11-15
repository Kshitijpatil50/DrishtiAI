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

export type LanguageCode = 'en' | 'hi' | 'mr';

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

export function normalizeLanguageCode(
  value: unknown,
  fallback: LanguageCode = 'en'
): LanguageCode {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'mr' || normalized.startsWith('mr-') || normalized === 'marathi') {
    return 'mr';
  }
  if (normalized === 'hi' || normalized.startsWith('hi-') || normalized === 'hindi') {
    return 'hi';
  }
  if (normalized === 'en' || normalized.startsWith('en-') || normalized === 'english') {
    return 'en';
  }
  return fallback;
}

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const LATIN_RE = /[A-Za-z]/;
const MARATHI_CHAR_RE = /[\u0933\u0972\u090D\u0911\u0945\u0949]/; // ळ, ॲ, ऑ, etc.
const MARATHI_WORD_RE =
  /(?:^|[\s,?.!।])(आहे|आहेत|नाहीत|काय|कुठे|कोठे|कुठं|कोण|कसा|कशी|कसे|कसं|माझा|माझी|माझे|माझ्या|तुमचा|तुमची|तुमचे|तुमच्या|तुम्ही|आम्ही|मला|समोर|पाठीमागे|बाजूला|सांगा|सांग|दाखवा|दिसतं|दिसलं|दिसला|दिसली|पाहिलं|पायऱ्या|जिना|इथे|तिथे|वरती|खाली)(?=$|[\s,?.!।])/g;
const HINDI_WORD_RE =
  /(?:^|[\s,?.!।])(है|हैं|हूँ|कहाँ|क्या|कैसे|कैसा|कैसी|मेरा|मेरी|मेरे|नहीं|बताइए|बताओ|बताएं|दिख|रहा|रही|रहे|सामने|मुझे|यहाँ|वहाँ|आप|तुम|हम|क्यों)(?=$|[\s,?.!।])/g;

export function detectTextLanguage(
  text: string,
  fallback: LanguageCode = 'en'
): LanguageCode {
  const cleaned = text.trim();
  if (!cleaned) return fallback;

  if (!DEVANAGARI_RE.test(cleaned)) {
    if (LATIN_RE.test(cleaned)) return 'en';
    return fallback;
  }

  let mrScore = MARATHI_CHAR_RE.test(cleaned) ? 2 : 0;
  let hiScore = 0;

  const mrMatches = cleaned.match(MARATHI_WORD_RE);
  if (mrMatches) mrScore += mrMatches.length * 2;

  const hiMatches = cleaned.match(HINDI_WORD_RE);
  if (hiMatches) hiScore += hiMatches.length * 2;

  if (mrScore > hiScore) return 'mr';
  if (hiScore > mrScore) return 'hi';

  return fallback === 'mr' || fallback === 'hi' ? fallback : 'hi';
}

