/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LanguageCode } from '../state/machine';

const EN_NUMBER_WORDS: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '11': 'eleven',
  '12': 'twelve',
  '15': 'fifteen',
  '20': 'twenty',
  '30': 'thirty',
  '50': 'fifty',
  '100': 'one hundred',
};

const HI_NUMBER_WORDS: Record<string, string> = {
  '0': 'शून्य',
  '1': 'एक',
  '2': 'दो',
  '3': 'तीन',
  '4': 'चार',
  '5': 'पाँच',
  '6': 'छह',
  '7': 'सात',
  '8': 'आठ',
  '9': 'नौ',
  '10': 'दस',
  '11': 'ग्यारह',
  '12': 'बारह',
  '15': 'पंद्रह',
  '20': 'बीस',
  '30': 'तीस',
  '50': 'पचास',
  '100': 'सौ',
  // Devanagari digits ०-९
  '०': 'शून्य',
  '१': 'एक',
  '२': 'दो',
  '३': 'तीन',
  '४': 'चार',
  '५': 'पाँच',
  '६': 'छह',
  '७': 'सात',
  '८': 'आठ',
  '९': 'नौ',
};

const MR_NUMBER_WORDS: Record<string, string> = {
  '0': 'शून्य',
  '1': 'एक',
  '2': 'दोन',
  '3': 'तीन',
  '4': 'चार',
  '5': 'पाच',
  '6': 'सहा',
  '7': 'सात',
  '8': 'आठ',
  '9': 'नऊ',
  '10': 'दहा',
  '11': 'अकरा',
  '12': 'बारा',
  '15': 'पंधरा',
  '20': 'वीस',
  '30': 'तीस',
  '50': 'पन्नास',
  '100': 'शंभर',
  // Devanagari digits ०-९
  '०': 'शून्य',
  '१': 'एक',
  '२': 'दोन',
  '३': 'तीन',
  '४': 'चार',
  '५': 'पाच',
  '६': 'सहा',
  '७': 'सात',
  '८': 'आठ',
  '९': 'नऊ',
};

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function englishIntToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 9999) {
    return String(n)
      .split('')
      .map((d) => EN_ONES[Number(d)] ?? d)
      .join(' ');
  }
  if (n < 20) return EN_ONES[n];
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const rem = n % 10;
    return rem === 0 ? EN_TENS[ten] : `${EN_TENS[ten]} ${EN_ONES[rem]}`;
  }
  if (n < 1000) {
    const hund = Math.floor(n / 100);
    const rem = n % 100;
    return rem === 0
      ? `${EN_ONES[hund]} hundred`
      : `${EN_ONES[hund]} hundred ${englishIntToWords(rem)}`;
  }
  const thou = Math.floor(n / 1000);
  const rem = n % 1000;
  return rem === 0
    ? `${EN_ONES[thou]} thousand`
    : `${EN_ONES[thou]} thousand ${englishIntToWords(rem)}`;
}

const HI_DECIMAL_DIGITS: Record<string, string> = {
  '0': 'शून्य', '1': 'एक', '2': 'दो', '3': 'तीन', '4': 'चार',
  '5': 'पाँच', '6': 'छह', '7': 'सात', '8': 'आठ', '9': 'नौ',
  '०': 'शून्य', '१': 'एक', '२': 'दो', '३': 'तीन', '४': 'चार',
  '५': 'पाँच', '६': 'छह', '७': 'सात', '८': 'आठ', '९': 'नौ',
};

const MR_DECIMAL_DIGITS: Record<string, string> = {
  '0': 'शून्य', '1': 'एक', '2': 'दोन', '3': 'तीन', '4': 'चार',
  '5': 'पाच', '6': 'सहा', '7': 'सात', '8': 'आठ', '9': 'नऊ',
  '०': 'शून्य', '१': 'एक', '२': 'दोन', '३': 'तीन', '४': 'चार',
  '५': 'पाच', '६': 'सहा', '७': 'सात', '८': 'आठ', '९': 'नऊ',
};

const DEVANAGARI_TO_ASCII: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

function toAsciiDigits(raw: string): string {
  return raw.replace(/[०-९]/g, (d) => DEVANAGARI_TO_ASCII[d] ?? d);
}

/**
 * Replaces numbers in text with natural spoken words according to the target language.
 */
export function convertDigitsToWords(text: string, lang: LanguageCode = 'en'): string {
  const dictionary =
    lang === 'mr' ? MR_NUMBER_WORDS : lang === 'hi' ? HI_NUMBER_WORDS : EN_NUMBER_WORDS;
  const decimalDict = lang === 'mr' ? MR_DECIMAL_DIGITS : HI_DECIMAL_DIGITS;

  // Handle decimal numbers like 1.5 -> "one point five" first
  let out = text.replace(/([0-9०-९]+)\.([0-9०-९]+)/g, (_m, wholeRaw, fracRaw) => {
    const whole = toAsciiDigits(wholeRaw);
    const frac = toAsciiDigits(fracRaw);
    if (lang === 'hi' || lang === 'mr') {
      const wholeWord =
        dictionary[wholeRaw] ||
        dictionary[whole] ||
        whole.split('').map((d) => decimalDict[d] || d).join(' ');
      const fracWords = frac.split('').map((d) => decimalDict[d] || d).join(' ');
      const sep = lang === 'mr' ? 'दशांश' : 'दशमलव';
      return `${wholeWord} ${sep} ${fracWords}`;
    }
    const wholeNum = Number.parseInt(whole, 10);
    const wholeWord = Number.isNaN(wholeNum) ? whole : englishIntToWords(wholeNum);
    const fracWords = frac.split('').map((d) => EN_ONES[Number(d)] ?? d).join(' ');
    return `${wholeWord} point ${fracWords}`;
  });

  // Replace remaining integers
  out = out.replace(/[0-9०-९]+/g, (match) => {
    if (lang === 'hi' || lang === 'mr') {
      const ascii = toAsciiDigits(match);
      if (dictionary[match]) return dictionary[match];
      if (dictionary[ascii]) return dictionary[ascii];
      return match
        .split('')
        .map((digit) => decimalDict[digit] || digit)
        .join(' ');
    }
    const num = Number.parseInt(toAsciiDigits(match), 10);
    if (!Number.isNaN(num) && match.length <= 4) {
      return englishIntToWords(num);
    }
    if (dictionary[match]) {
      return dictionary[match];
    }
    return match
      .split('')
      .map((digit) => dictionary[digit] || digit)
      .join(' ');
  });

  return out;
}

/**
 * Sanitizes text before sending to Gnani TTS:
 * - Strips emojis and symbol icons
 * - Strips Markdown syntax (bold, italic, code, bullets, links)
 * - Converts raw digits to spoken words
 * - Normalizes spacing and punctuation
 */
export function sanitizeForTTS(rawText: string, lang: LanguageCode = 'en'): string {
  if (!rawText) return '';

  let cleaned = rawText;

  // Remove code blocks and inline code
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Remove Markdown formatting like **bold**, *italic*, __underline__, # headers
  cleaned = cleaned.replace(/[*_#~>]/g, ' ');
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // markdown links
  cleaned = cleaned.replace(/^[\s-–—*+]\s+/gm, ''); // list markers

  // Remove emojis and pictographs including variation selectors
  cleaned = cleaned.replace(
    /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
    ''
  );

  // Convert digits to spoken words
  cleaned = convertDigitsToWords(cleaned, lang);

  // Convert colon/semicolon to natural pauses (comma or period)
  cleaned = cleaned.replace(/[:;]/g, ',');

  // Clean unwanted symbols while preserving Hindi Devanagari, English, and standard sentence punctuation
  // Allowed: Latin letters, Devanagari range (\u0900-\u097F), commas, periods, question marks, exclamation marks, Hindi danda (\u0964)
  cleaned = cleaned.replace(/[^\p{L}\p{M}\p{N}\s.,!?'"।-]/gu, ' ');

  // Remove spaces before punctuation
  cleaned = cleaned.replace(/\s+([.,!?।])/g, '$1');

  // Normalize multiple spaces and line breaks into single space
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Splits text into individual sentences for incremental TTS streaming / playback.
 * Supports English punctuation (. ? !) and Hindi danda (।).
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];

  // Match sentence ending punctuation followed by whitespace or end of string
  const parts = text
    .split(/([.!?।]+(?:\s+|$))/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentences: string[] = [];
  let buffer = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^[.!?।]+$/.test(part)) {
      if (buffer) {
        sentences.push((buffer + part).trim());
        buffer = '';
      }
    } else {
      if (buffer) {
        sentences.push(buffer);
      }
      buffer = part;
    }
  }

  if (buffer) {
    sentences.push(buffer);
  }

  return sentences.filter((s) => s.length > 0);
}

/**
 * Groups adjacent short sentences for TTS synthesis so 1-2 sentence replies run in a single
 * Gnani call (no inter-sentence pause), while longer replies still start quickly on chunk 1.
 */
export function batchSentencesForTTS(
  sentences: string[],
  firstMaxChars = 110,
  nextMaxChars = 175
): string[] {
  if (sentences.length <= 1) return sentences;

  const chunks: string[] = [];
  let current = '';

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (!current) {
      current = sentence;
      continue;
    }

    const limit = chunks.length === 0 ? firstMaxChars : nextMaxChars;
    if (current.length + 1 + sentence.length <= limit) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

const ECHO_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'front', 'have', 'here', 'how', 'i', 'im', 'in', 'is', 'it', 'its',
  'me', 'my', 'of', 'on', 'or', 'please', 'right', 'see', 'tell', 'that', 'the', 'there',
  'these', 'this', 'to', 'was', 'were', 'what', 'whats', 'where', 'which', 'who', 'why',
  'will', 'with', 'you', 'your',
  // Common Hindi stop/question tokens
  'क्या', 'कहाँ', 'कौन', 'कैसे', 'है', 'हैं', 'हूँ', 'में', 'के', 'की', 'को', 'से', 'एक',
  'मेरे', 'सामने', 'बताओ', 'बताइए', 'कृपया', 'यह', 'वह', 'और',
  // Common Marathi stop/question tokens
  'काय', 'कुठे', 'कोठे', 'कोण', 'कसे', 'आहे', 'आहेत', 'मी', 'माझ्या', 'समोर', 'सांगा',
  'हे', 'ते', 'आणि', 'मध्ये', 'पासून', 'वर', 'खाली',
]);

function normalizeForEchoCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether a captured user transcript is likely acoustic echo from
 * Drishti's own recently spoken output.
 */
export function isEchoOfAssistantSpeech(
  transcript: string,
  lastSpokenText: string,
  msSinceSpoken: number
): boolean {
  if (msSinceSpoken < 0 || msSinceSpoken > 8000) return false;

  const normUser = normalizeForEchoCheck(transcript);
  const normAssistant = normalizeForEchoCheck(lastSpokenText);
  if (!normUser || !normAssistant) return false;

  // Exact or long substring match from assistant speech
  if (normUser.length >= 14 && normAssistant.includes(normUser)) {
    return true;
  }

  // Meaningful content-word overlap check (handles slight STT distortion of speaker output)
  const assistantWords = new Set(normAssistant.split(' ').filter((w) => w.length >= 2));
  const userWords = normUser.split(' ').filter((w) => w.length >= 2);
  const contentWords = userWords.filter((w) => !ECHO_STOP_WORDS.has(w));

  if (contentWords.length >= 3) {
    let matched = 0;
    for (const w of contentWords) {
      if (assistantWords.has(w)) {
        matched += 1;
      }
    }
    if (matched / contentWords.length >= 0.75) {
      return true;
    }
  }

  return false;
}

