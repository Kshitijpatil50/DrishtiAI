import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWAV, downsampleAudio } from './wav';

test('encodes valid 44-byte WAV header', () => {
  const samples = new Float32Array(1600); // 100ms at 16kHz
  const wavBytes = encodeWAV(samples, 16000);

  // Total length = 44 + 1600 * 2 = 3244
  assert.equal(wavBytes.length, 3244);

  // Check RIFF header
  const riff = String.fromCharCode(...wavBytes.slice(0, 4));
  assert.equal(riff, 'RIFF');

  // Check WAVE
  const wave = String.fromCharCode(...wavBytes.slice(8, 12));
  assert.equal(wave, 'WAVE');

  // Check fmt
  const fmt = String.fromCharCode(...wavBytes.slice(12, 16));
  assert.equal(fmt, 'fmt ');

  // Check data
  const data = String.fromCharCode(...wavBytes.slice(36, 40));
  assert.equal(data, 'data');

  // Verify channels = 1 (offset 22)
  const view = new DataView(wavBytes.buffer);
  assert.equal(view.getUint16(22, true), 1);

  // Verify sample rate = 16000 (offset 24)
  assert.equal(view.getUint32(24, true), 16000);

  // Verify bits per sample = 16 (offset 34)
  assert.equal(view.getUint16(34, true), 16);
});

test('downsamples 48kHz to 16kHz accurately', () => {
  const sourceLength = 48000; // 1 second at 48kHz
  const samples = new Float32Array(sourceLength).fill(0.5);

  const downsampled = downsampleAudio(samples, 48000, 16000);
  assert.equal(downsampled.length, 16000);
  // Averaging 0.5 values should yield 0.5
  assert.ok(Math.abs(downsampled[0] - 0.5) < 0.001);
});
