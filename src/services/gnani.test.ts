import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GnaniSerialQueue,
  GnaniError,
  buildSttLanguageCode,
  resolveSttDetectedLanguage,
} from './gnani';

test('GnaniSerialQueue executes tasks serially', async () => {
  const queue = new GnaniSerialQueue();
  const order: number[] = [];

  const task1 = queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push(1);
    return 1;
  });

  const task2 = queue.enqueue(async () => {
    order.push(2);
    return 2;
  });

  await Promise.all([task1, task2]);
  assert.deepEqual(order, [1, 2]);
});

test('GnaniSerialQueue allows hazard speech to jump ahead of pending tasks', async () => {
  const queue = new GnaniSerialQueue();
  const order: string[] = [];

  // Start a slow in-flight task
  const slow = queue.enqueue(async () => {
    await new Promise((r) => setTimeout(r, 40));
    order.push('slow-start');
  });

  // Enqueue normal narration
  const normal = queue.enqueue(async () => {
    order.push('normal-narration');
  });

  // Enqueue hazard speech with priority
  const hazard = queue.enqueue(async () => {
    order.push('hazard-warning');
  }, true);

  await Promise.all([slow, normal, hazard]);
  // Hazard should run before normal narration!
  assert.deepEqual(order, ['slow-start', 'hazard-warning', 'normal-narration']);
});

test('GnaniError formats object details cleanly', () => {
  const err1 = new GnaniError(401, { message: 'Invalid API key', error_code: 'UNAUTHORIZED' });
  assert.equal(err1.message, 'Invalid API key');
  assert.equal(err1.errorCode, 'UNAUTHORIZED');

  const err2 = new GnaniError(429, 'Rate limit exceeded');
  assert.equal(err2.message, 'Rate limit exceeded');
});

test('Marathi STT language code building and language resolution', () => {
  assert.equal(buildSttLanguageCode('mr'), 'mr-IN,hi-IN,en-IN');
  assert.equal(buildSttLanguageCode('en'), 'hi-IN,en-IN,mr-IN');
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'mr-IN' }, 'माझ्या समोर काय आहे', 'en'),
    'mr'
  );
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'hi-IN' }, 'पायऱ्या कुठे आहेत', 'mr'),
    'mr'
  );
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'hi-IN' }, 'मेरे सामने क्या है', 'mr'),
    'hi'
  );
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'mr-IN' }, 'What is in front of me?', 'mr'),
    'en'
  );
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'hi-IN' }, 'Where is the door?', 'hi'),
    'en'
  );
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'en-IN' }, 'माझ्या समोर काय आहे?', 'en'),
    'mr'
  );
  assert.equal(
    resolveSttDetectedLanguage({ detected_language_code: 'mr-IN' }, 'दरवाजा', 'en'),
    'mr'
  );
});

