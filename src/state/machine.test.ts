import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_STATE, transitionState } from './machine';

test('transitions from IDLE to OBSERVING on START', () => {
  const s1 = transitionState(INITIAL_STATE, { type: 'START' });
  assert.equal(s1.state, 'OBSERVING');
});

test('transitions to LISTENING and increments requestToken on barge-in or tap', () => {
  const s1 = transitionState(INITIAL_STATE, { type: 'START' });
  const s2 = transitionState(s1, { type: 'SPEAKING_START', text: 'Hello' });
  assert.equal(s2.state, 'SPEAKING');
  assert.equal(s2.requestToken, 0);

  const s3 = transitionState(s2, { type: 'BARGE_IN_OR_TAP' });
  assert.equal(s3.state, 'LISTENING');
  assert.equal(s3.requestToken, 1);
});

test('handles full voice cycle: LISTENING -> TRANSCRIBING -> THINKING -> SPEAKING -> OBSERVING', () => {
  let s = transitionState(INITIAL_STATE, { type: 'START' });
  s = transitionState(s, { type: 'START_LISTENING' });
  assert.equal(s.state, 'LISTENING');

  s = transitionState(s, { type: 'SPEECH_CAPTURED' });
  assert.equal(s.state, 'TRANSCRIBING');

  s = transitionState(s, {
    type: 'TRANSCRIPTION_SUCCESS',
    transcript: 'What is ahead?',
    detectedLanguage: 'en',
  });
  assert.equal(s.state, 'THINKING');
  assert.equal(s.lastTranscript, 'What is ahead?');

  s = transitionState(s, { type: 'SPEAKING_START', text: 'A wooden table is ahead.' });
  assert.equal(s.state, 'SPEAKING');
  assert.equal(s.lastSpokenText, 'A wooden table is ahead.');

  s = transitionState(s, { type: 'SPEAKING_FINISHED' });
  assert.equal(s.state, 'OBSERVING');
});

test('empty transcript silently returns to OBSERVING', () => {
  let s = transitionState(INITIAL_STATE, { type: 'START' });
  s = transitionState(s, { type: 'START_LISTENING' });
  s = transitionState(s, { type: 'SPEECH_CAPTURED' });
  s = transitionState(s, { type: 'TRANSCRIPTION_EMPTY' });
  assert.equal(s.state, 'OBSERVING');
});

test('toggles QUIET mode', () => {
  let s = transitionState(INITIAL_STATE, { type: 'START' });
  assert.equal(s.state, 'OBSERVING');
  assert.equal(s.isQuiet, false);

  s = transitionState(s, { type: 'TOGGLE_QUIET' });
  assert.equal(s.state, 'QUIET');
  assert.equal(s.isQuiet, true);

  s = transitionState(s, { type: 'TOGGLE_QUIET' });
  assert.equal(s.state, 'OBSERVING');
  assert.equal(s.isQuiet, false);
});

test('toggling QUIET during THINKING resets state to QUIET and increments requestToken', () => {
  let s = transitionState(INITIAL_STATE, { type: 'START' });
  s = transitionState(s, { type: 'THINKING_START' });
  const prevToken = s.requestToken;

  s = transitionState(s, { type: 'TOGGLE_QUIET' });
  assert.equal(s.state, 'QUIET');
  assert.equal(s.isQuiet, true);
  assert.equal(s.requestToken, prevToken + 1);
});

test('REQUEST_FAILED safely returns from THINKING to base state', () => {
  let s = transitionState(INITIAL_STATE, { type: 'START' });
  s = transitionState(s, { type: 'THINKING_START' });
  s = transitionState(s, { type: 'REQUEST_FAILED' });
  assert.equal(s.state, 'OBSERVING');
});
