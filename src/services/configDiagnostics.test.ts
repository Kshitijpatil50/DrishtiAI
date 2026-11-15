import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKeyDiagnostic } from './configDiagnostics';

test('formatKeyDiagnostic reports connected status with source and length', () => {
  const result = formatKeyDiagnostic(
    {
      configured: true,
      present: true,
      length: 53,
      formatValid: true,
      isPlaceholder: false,
      hasSurroundingQuotesOrWhitespace: false,
      envSource: 'GEMINI_API_KEY',
    },
    true
  );

  assert.equal(result.label, 'Connected');
  assert.equal(result.tone, 'ok');
  assert.equal(result.detail, 'GEMINI_API_KEY • 53 chars');
});

test('formatKeyDiagnostic flags placeholders, missing keys, and bad formats', () => {
  const placeholder = formatKeyDiagnostic(
    {
      configured: false,
      present: true,
      length: 19,
      formatValid: false,
      isPlaceholder: true,
      hasSurroundingQuotesOrWhitespace: false,
      envSource: 'GEMINI_API_KEY',
    },
    false
  );
  assert.equal(placeholder.label, 'Placeholder');
  assert.equal(placeholder.tone, 'error');

  const missing = formatKeyDiagnostic(
    {
      configured: false,
      present: false,
      length: 0,
      formatValid: false,
      isPlaceholder: false,
      hasSurroundingQuotesOrWhitespace: false,
      envSource: null,
    },
    false
  );
  assert.equal(missing.label, 'Missing');
  assert.equal(missing.tone, 'error');

  const warn = formatKeyDiagnostic(
    {
      configured: true,
      present: true,
      length: 8,
      formatValid: false,
      isPlaceholder: false,
      hasSurroundingQuotesOrWhitespace: false,
      envSource: 'GNANI_API_KEY',
    },
    true
  );
  assert.equal(warn.label, 'Check format');
  assert.equal(warn.tone, 'warn');
});
