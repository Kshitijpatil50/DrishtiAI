/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LanguageCode = 'en' | 'hi' | 'mr';

export function normalizeLang(value: unknown, fallback: LanguageCode = 'en'): LanguageCode {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'mr' || normalized.startsWith('mr-') || normalized === 'marathi') return 'mr';
  if (normalized === 'hi' || normalized.startsWith('hi-') || normalized === 'hindi') return 'hi';
  if (normalized === 'en' || normalized.startsWith('en-') || normalized === 'english') return 'en';
  return fallback;
}

export function getLanguageDisplayName(lang: LanguageCode): string {
  switch (lang) {
    case 'mr':
      return 'Marathi';
    case 'hi':
      return 'Hindi';
    case 'en':
    default:
      return 'English';
  }
}

const DEVANAGARI_GLOBAL_RE = /[\u0900-\u097F]/g;
const LATIN_GLOBAL_RE = /[A-Za-z]/g;
const MARATHI_CHAR_RE = /[\u0933\u0972\u090D\u0911\u0945\u0949]/;
const MARATHI_WORD_RE =
  /(?:^|[\s,?.!।])(आहे|आहेत|नाहीत|काय|कुठे|कोठे|कुठं|कोण|कसा|कशी|कसे|कसं|माझा|माझी|माझे|माझ्या|तुमचा|तुमची|तुमचे|तुमच्या|तुम्ही|आम्ही|मला|समोर|पाठीमागे|बाजूला|सांगा|सांग|दाखवा|दिसतं|दिसलं|दिसला|दिसली|पाहिलं|पायऱ्या|जिना|इथे|तिथे|वरती|खाली)(?=$|[\s,?.!।])/g;
const HINDI_WORD_RE =
  /(?:^|[\s,?.!।])(है|हैं|हूँ|कहाँ|क्या|कैसे|कैसा|कैसी|मेरा|मेरी|मेरे|नहीं|बताइए|बताओ|बताएं|दिख|रहा|रही|रहे|सामने|मुझे|यहाँ|वहाँ|आप|तुम|हम|क्यों)(?=$|[\s,?.!।])/g;
const ENGLISH_WORD_RE =
  /\b(what|where|when|which|who|whom|whose|how|why|is|are|was|were|am|be|the|this|that|these|those|there|here|front|behind|left|right|near|far|can|could|would|should|will|do|does|did|please|tell|read|see|look|find|show|check|my|your|our|me|you|it|in|on|at|to|of|for|with|from|and|or|not|no|yes|hello|hey|hi|thanks|thank|speak|talk|answer|reply)\b/gi;
const ROMAN_MARATHI_WORD_RE =
  /\b(kuthe|kothe|kuthay|aahe|aahet|nahit|samor|pathimage|bajula|sanga|sang|dakhva|dakhav|disat|disla|disli|disle|pahila|pahile|payrya|paayrya|jina|mazya|majhya|maza|mazi|maze|tumcha|tumchi|tumche|ithe|tithe|varti|khali|kaay)\b/gi;
const ROMAN_HINDI_WORD_RE =
  /\b(kya|kahan|kaha|kidhar|kaise|kaisa|kaisi|samne|saamne|peeche|piche|batao|bataiye|bataen|dikhao|dikhai|dikh|raha|rahi|rahe|mera|meri|mere|nahi|nahin|yahan|wahan|mujhe|aap|tum|hum|kyon|kyun|seedhi|sidhiyan|darwaza|hai|hain|hoon|boliye|bolo)\b/gi;

export function detectQuestionLanguage(
  text: string,
  fallback: LanguageCode = 'en'
): LanguageCode {
  const cleaned = text.trim();
  if (!cleaned) return fallback;

  const devanagariCount = cleaned.match(DEVANAGARI_GLOBAL_RE)?.length ?? 0;
  const latinCount = cleaned.match(LATIN_GLOBAL_RE)?.length ?? 0;

  if (devanagariCount === 0 && latinCount === 0) {
    return fallback;
  }

  if (devanagariCount > 0 && (latinCount === 0 || devanagariCount >= latinCount)) {
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

  const enScore = cleaned.match(ENGLISH_WORD_RE)?.length ?? 0;
  const romanMrScore = cleaned.match(ROMAN_MARATHI_WORD_RE)?.length ?? 0;
  const romanHiScore = cleaned.match(ROMAN_HINDI_WORD_RE)?.length ?? 0;
  const indicScore = romanMrScore + romanHiScore;

  if (indicScore >= 2 && indicScore > enScore) {
    if (romanMrScore > romanHiScore) return 'mr';
    if (romanHiScore > romanMrScore) return 'hi';
    return fallback === 'mr' || fallback === 'hi' ? fallback : 'hi';
  }

  return 'en';
}

const SWITCH_TO_EN_RE =
  /\b(?:speak|talk|reply|answer|switch)\b[^.?!]*\benglish\b|इंग्लिश|अंग्रेजी|अंग्रेज़ी|इंग्रजी/i;
const SWITCH_TO_HI_RE =
  /\b(?:speak|talk|reply|answer|switch)\b[^.?!]*\bhindi\b|hindi\s+(?:me|mein|m)\s+(?:bol|bolo|boliye|batao)|हिंदी\s*में|हिन्दी\s*में/i;
const SWITCH_TO_MR_RE =
  /\b(?:speak|talk|reply|answer|switch)\b[^.?!]*\bmarathi\b|marathi\s+(?:madhe|madhye|me)\s+(?:bol|bola|sanga)|मराठीत|मराठी\s*मध्ये/i;

export function detectRequestedLanguageSwitch(text: string): LanguageCode | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  if (SWITCH_TO_MR_RE.test(cleaned)) return 'mr';
  if (SWITCH_TO_HI_RE.test(cleaned)) return 'hi';
  if (SWITCH_TO_EN_RE.test(cleaned)) return 'en';
  return null;
}

export function resolveQuestionLanguage(options: {
  rawQuestion: string;
  requestedLanguage: unknown;
}): {
  effectiveLanguage: LanguageCode;
  explicitSwitchTarget: LanguageCode | null;
} {
  const reqLang = normalizeLang(options.requestedLanguage, 'en');
  const trimmed = options.rawQuestion.trim();
  if (!trimmed) {
    return { effectiveLanguage: reqLang, explicitSwitchTarget: null };
  }
  const explicitSwitchTarget = detectRequestedLanguageSwitch(trimmed);
  if (explicitSwitchTarget) {
    return {
      effectiveLanguage: explicitSwitchTarget,
      explicitSwitchTarget,
    };
  }
  return {
    effectiveLanguage: detectQuestionLanguage(trimmed, reqLang),
    explicitSwitchTarget: null,
  };
}
