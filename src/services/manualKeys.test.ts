import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanManualKey,
  isDeployedEnvironment,
  readStoredKey,
  writeStoredKey,
  KeyStorageLike,
} from './manualKeys';

function createMemoryStorage(): KeyStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test('cleanManualKey trims whitespace and surrounding quotes', () => {
  assert.equal(cleanManualKey('  "AIzaSyTestKey123456"  '), 'AIzaSyTestKey123456');
  assert.equal(cleanManualKey(" 'gnani-key-abc' "), 'gnani-key-abc');
  assert.equal(cleanManualKey('   '), '');
});

test('isDeployedEnvironment hides box in local dev and AI Studio dev preview', () => {
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: false,
      hostname: 'localhost',
      serverRuntime: 'node',
    }),
    false
  );
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: false,
      hostname: '127.0.0.1',
      serverRuntime: 'node',
    }),
    false
  );
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: false,
      hostname: 'ais-dev-u3yx2mmipfypvnj7c6t5ze-782659439587.asia-southeast1.run.app',
      serverRuntime: 'node',
    }),
    false
  );
});

test('isDeployedEnvironment enables box in deployed/hosted environments', () => {
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: true,
      hostname: 'localhost',
      serverRuntime: 'node',
    }),
    true
  );
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: false,
      hostname: 'ais-pre-u3yx2mmipfypvnj7c6t5ze-782659439587.asia-southeast1.run.app',
      serverRuntime: 'node',
    }),
    true
  );
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: true,
      hostname: 'drishti-ai.vercel.app',
      serverRuntime: 'vercel',
    }),
    true
  );
  assert.equal(
    isDeployedEnvironment({
      isProdBuild: false,
      hostname: 'localhost',
      search: '?deployed=1',
      serverRuntime: 'node',
    }),
    true
  );
});

test('writeStoredKey and readStoredKey persist, clean, and remove keys', () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  const stores = [local, session];

  const saved = writeStoredKey('test_key', '  "AIzaSyDemo123" ', stores);
  assert.equal(saved, 'AIzaSyDemo123');
  assert.equal(readStoredKey('test_key', stores), 'AIzaSyDemo123');

  writeStoredKey('test_key', '   ', stores);
  assert.equal(readStoredKey('test_key', stores), '');
});
