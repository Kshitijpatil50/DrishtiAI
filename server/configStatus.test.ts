import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfigStatus,
  inspectApiKey,
  resolveEnvKey,
  resolveRequestKey,
} from './configStatus';

test('inspectApiKey detects valid Gemini and Gnani keys without leaking values', () => {
  const status = buildConfigStatus({
    GEMINI_API_KEY: 'AIzaSyDummyValidKeyFormat12345678901234',
    GNANI_API_KEY: 'gnani-live-token-1234567890',
    VERCEL: '1',
  });

  assert.equal(status.hasGeminiKey, true);
  assert.equal(status.hasGnaniKey, true);
  assert.equal(status.runtime, 'vercel');
  assert.equal(status.gemini.configured, true);
  assert.equal(status.gemini.formatValid, true);
  assert.equal(status.gemini.envSource, 'GEMINI_API_KEY');
  assert.equal(status.gemini.length, 39);
  assert.equal(status.gnani.configured, true);
  assert.equal(status.gnani.formatValid, true);
  assert.equal(status.gnani.envSource, 'GNANI_API_KEY');

  const injectedStatus = buildConfigStatus({
    GEMINI_API_KEY: 'aistudio-injected-proxy-token-value-12345678901234567',
  });
  assert.equal(injectedStatus.gemini.formatValid, true);
  assert.equal(injectedStatus.gemini.length, 53);
});

test('inspectApiKey flags template placeholders and surrounding quotes/whitespace', () => {
  const placeholder = inspectApiKey([['GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY']], 'gemini');
  assert.equal(placeholder.present, true);
  assert.equal(placeholder.isPlaceholder, true);
  assert.equal(placeholder.configured, false);
  assert.equal(placeholder.formatValid, false);

  const quoted = inspectApiKey(
    [['GNANI_API_KEY', '  "gnani-valid-key-123456"  ']],
    'gnani'
  );
  assert.equal(quoted.configured, true);
  assert.equal(quoted.formatValid, true);
  assert.equal(quoted.hasSurroundingQuotesOrWhitespace, true);
  assert.equal(quoted.length, 22);
});

test('resolveEnvKey strips surrounding quotes and selects fallback env alias', () => {
  const resolved = resolveEnvKey([
    ['GNANI_API_KEY', '   '],
    ['VITE_GNANI_API_KEY', '"abc123def456ghi789"'],
  ]);
  assert.equal(resolved.source, 'VITE_GNANI_API_KEY');
  assert.equal(resolved.value, 'abc123def456ghi789');
});

test('buildConfigStatus reports missing keys cleanly', () => {
  const status = buildConfigStatus({});
  assert.equal(status.hasGeminiKey, false);
  assert.equal(status.hasGnaniKey, false);
  assert.equal(status.runtime, 'node');
  assert.equal(status.gemini.envSource, null);
  assert.equal(status.gnani.envSource, null);
});

test('resolveRequestKey prioritizes manual header key over server env fallback', () => {
  assert.deepEqual(
    resolveRequestKey('  "manual-gemini-key"  ', 'broken-server-key'),
    { value: 'manual-gemini-key', source: 'manual-header' }
  );
  assert.deepEqual(
    resolveRequestKey('   ', 'server-env-key'),
    { value: 'server-env-key', source: 'server-env' }
  );
  assert.deepEqual(
    resolveRequestKey(undefined, ''),
    { value: '', source: 'none' }
  );
});
