/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Downsamples a mono Float32 audio buffer from sourceSampleRate to targetSampleRate.
 */
export function downsampleAudio(
  buffer: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = 16000
): Float32Array {
  if (sourceSampleRate === targetSampleRate) {
    return buffer;
  }
  if (sourceSampleRate < targetSampleRate) {
    // If source is already lower, return as is
    return buffer;
  }

  const sampleRateRatio = sourceSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    // Simple window average for anti-aliasing downsampling
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

/**
 * Encodes a mono Float32Array into a 16-bit PCM WAV byte array.
 * RIFF header + fmt chunk + data chunk.
 */
export function encodeWAV(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Helper to write ASCII string
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF identifier
  writeString(0, 'RIFF');
  // RIFF chunk length: 36 + dataSize
  view.setUint32(4, 36 + dataSize, true);
  // RIFF type
  writeString(8, 'WAVE');
  // format chunk identifier
  writeString(12, 'fmt ');
  // format chunk length: 16 for PCM
  view.setUint32(16, 16, true);
  // audio format (1 = Linear PCM)
  view.setUint16(20, 1, true);
  // number of channels (1 = mono)
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate
  view.setUint32(28, byteRate, true);
  // block align
  view.setUint16(32, blockAlign, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(36, 'data');
  // data chunk length
  view.setUint32(40, dataSize, true);

  // Write PCM 16-bit samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1.0, 1.0]
    let s = Math.max(-1, Math.min(1, samples[i]));
    // Convert to signed 16-bit integer [-32768, 32767]
    const pcm = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Creates a Blob from 16-bit PCM WAV bytes.
 */
export function createWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const bytes = encodeWAV(samples, sampleRate);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/**
 * Encodes a Uint8Array into base64 using chunked String.fromCharCode
 * to avoid per-byte string concatenation overhead on large audio buffers.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return btoa(parts.join(''));
}
