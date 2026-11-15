import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeForTTS,
  convertDigitsToWords,
  splitSentences,
  batchSentencesForTTS,
  isEchoOfAssistantSpeech,
} from './sanitize';

test('converts English digits to spoken words', () => {
  assert.equal(convertDigitsToWords('about 2 steps ahead', 'en'), 'about two steps ahead');
  assert.equal(convertDigitsToWords('door is 5 meters away', 'en'), 'door is five meters away');
});

test('converts Hindi digits to spoken words', () => {
  assert.equal(convertDigitsToWords('लगभग 2 मीटर दूर', 'hi'), 'लगभग दो मीटर दूर');
  assert.equal(convertDigitsToWords('लगभग २ कदम दूर', 'hi'), 'लगभग दो कदम दूर');
});

test('strips markdown, asterisks, and emojis', () => {
  const dirty = '⚠️ **Hazard ahead**: Watch out for 3 stairs! 🛑 *Caution*';
  const clean = sanitizeForTTS(dirty, 'en');
  assert.ok(!clean.includes('*'));
  assert.ok(!clean.includes('⚠️'));
  assert.ok(!clean.includes('🛑'));
  assert.equal(clean, 'Hazard ahead, Watch out for three stairs! Caution');
});

test('splits text into English sentences correctly', () => {
  const speech = 'There is an open door ahead. Watch out for a small step. Be careful.';
  const sentences = splitSentences(speech);
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0], 'There is an open door ahead.');
  assert.equal(sentences[1], 'Watch out for a small step.');
  assert.equal(sentences[2], 'Be careful.');
});

test('splits text into Hindi sentences with danda', () => {
  const speech = 'सामने एक कुर्सी है। लगभग दो कदम दूर।';
  const sentences = splitSentences(speech);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0], 'सामने एक कुर्सी है।');
  assert.equal(sentences[1], 'लगभग दो कदम दूर।');
});

test('detects recent verbatim and near-verbatim speaker echo', () => {
  const spoken = "Hi, I'm Drishti. There is a wooden desk and a silver laptop ahead.";
  assert.equal(isEchoOfAssistantSpeech('wooden desk and a silver laptop', spoken, 1200), true);
  assert.equal(isEchoOfAssistantSpeech('wooden desk silver laptop ahead', spoken, 2500), true);
  assert.equal(
    isEchoOfAssistantSpeech("I'll tell you what's in front of you", "I'll tell you what's in front of you. Please stay careful.", 800),
    true
  );
});

test('does not reject genuine user questions or stale speech', () => {
  const spoken = 'There is a wooden desk and a silver laptop ahead.';
  assert.equal(isEchoOfAssistantSpeech("What's in front of me?", spoken, 1000), false);
  assert.equal(isEchoOfAssistantSpeech('What color is the mug?', spoken, 1000), false);
  assert.equal(isEchoOfAssistantSpeech('Read the text on the sign', spoken, 1000), false);
  assert.equal(isEchoOfAssistantSpeech('wooden desk and a silver laptop', spoken, 12000), false);
});

test('batchSentencesForTTS merges short adjacent sentences into fewer TTS chunks', () => {
  const shortReply = ['There is a chair ahead.', 'It is about two steps away.'];
  assert.deepEqual(batchSentencesForTTS(shortReply), [
    'There is a chair ahead. It is about two steps away.',
  ]);

  const greeting = [
    "Hi, I'm Drishti, and I'll describe what's ahead.",
    'Speak or tap anywhere to ask me anything.',
    'Please still use your cane or guide carefully.',
  ];
  const batched = batchSentencesForTTS(greeting);
  assert.equal(batched.length, 2);
  assert.equal(batched[0], "Hi, I'm Drishti, and I'll describe what's ahead. Speak or tap anywhere to ask me anything.");
  assert.equal(batched[1], 'Please still use your cane or guide carefully.');

  // Conversational 2-sentence reply under single-breath budget coalesces cleanly
  const twoSentenceReply = [
    'There is a wooden chair about two steps to your left.',
    'The path straight ahead looks clear right now.',
  ];
  assert.deepEqual(batchSentencesForTTS(twoSentenceReply, 210, 260), [
    'There is a wooden chair about two steps to your left. The path straight ahead looks clear right now.',
  ]);
});

test('converts multi-digit integers and decimals into natural spoken words', () => {
  assert.equal(convertDigitsToWords('It is 24 degrees and 500 meters away.', 'en'), 'It is twenty four degrees and five hundred meters away.');
  assert.equal(convertDigitsToWords('About 1.5 steps ahead.', 'en'), 'About one point five steps ahead.');
  assert.equal(convertDigitsToWords('लगभग 1.5 कदम आगे।', 'hi'), 'लगभग एक दशमलव पाँच कदम आगे।');
});


