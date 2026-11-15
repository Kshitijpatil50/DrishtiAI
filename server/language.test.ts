import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLang,
  detectQuestionLanguage,
  detectRequestedLanguageSwitch,
  resolveQuestionLanguage,
} from './language.js';

test('normalizeLang handles language variants cleanly', () => {
  assert.equal(normalizeLang('en-IN'), 'en');
  assert.equal(normalizeLang('hi-IN'), 'hi');
  assert.equal(normalizeLang('mr-IN'), 'mr');
  assert.equal(normalizeLang('Marathi'), 'mr');
  assert.equal(normalizeLang('', 'hi'), 'hi');
});

test('resolveQuestionLanguage enforces English answer for English question even when UI language is Marathi or Hindi', () => {
  const fromMr = resolveQuestionLanguage({
    rawQuestion: 'What is in front of me?',
    requestedLanguage: 'mr',
  });
  assert.equal(fromMr.effectiveLanguage, 'en');
  assert.equal(fromMr.explicitSwitchTarget, null);

  const fromHi = resolveQuestionLanguage({
    rawQuestion: 'Where did you see my keys?',
    requestedLanguage: 'hi',
  });
  assert.equal(fromHi.effectiveLanguage, 'en');
});

test('resolveQuestionLanguage enforces Hindi and Marathi strictly when asked in those languages', () => {
  const hi = resolveQuestionLanguage({
    rawQuestion: 'मेरे सामने क्या है?',
    requestedLanguage: 'en',
  });
  assert.equal(hi.effectiveLanguage, 'hi');

  const mr = resolveQuestionLanguage({
    rawQuestion: 'माझ्या समोर काय आहे?',
    requestedLanguage: 'en',
  });
  assert.equal(mr.effectiveLanguage, 'mr');
});

test('detectQuestionLanguage handles Romanized indic queries without misclassifying English', () => {
  assert.equal(detectQuestionLanguage('Mere samne kya hai?', 'en'), 'hi');
  assert.equal(detectQuestionLanguage('Paayrya kuthe aahet?', 'en'), 'mr');
  assert.equal(detectQuestionLanguage('Are there stairs ahead?', 'mr'), 'en');
  assert.equal(detectQuestionLanguage('What does नमस्ते mean?', 'hi'), 'en');
});

test('detectRequestedLanguageSwitch honors explicit requests to switch language', () => {
  assert.equal(detectRequestedLanguageSwitch('Please speak in Hindi'), 'hi');
  assert.equal(detectRequestedLanguageSwitch('Can you reply in Marathi?'), 'mr');
  assert.equal(detectRequestedLanguageSwitch('अंग्रेज़ी में बोलो'), 'en');
  assert.equal(detectRequestedLanguageSwitch('What is in front of me?'), null);
});
