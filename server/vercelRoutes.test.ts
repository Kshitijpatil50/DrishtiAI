import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import configHandler from '../api/config';
import sceneHandler from '../api/gemini/scene';
import questionHandler from '../api/gemini/question';
import sttHandler from '../api/gnani/stt';
import ttsHandler from '../api/gnani/tts';

function invokeHandler(
  handler: (req: any, res: any) => unknown,
  opts: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    preParsedBody?: unknown;
    rawJsonBody?: string;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (opts.preParsedBody !== undefined) {
        (req as any).body = opts.preParsedBody;
      }
      handler(req, res);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Invalid test server address'));
        return;
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: opts.url,
          method: opts.method || 'GET',
          headers: opts.headers || {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close(() => {
              resolve({
                status: res.statusCode || 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
          });
        }
      );

      req.on('error', (err) => {
        server.close(() => reject(err));
      });

      if (opts.rawJsonBody) {
        req.write(opts.rawJsonBody);
      }
      req.end();
    });
  });
}

test('explicit Vercel API routes resolve both /api/* and stripped "/" paths without 404', async () => {
  const cfgFull = await invokeHandler(configHandler, { url: '/api/config' });
  assert.equal(cfgFull.status, 200);
  const cfgJson = JSON.parse(cfgFull.body);
  assert.equal(typeof cfgJson.hasGeminiKey, 'boolean');

  const cfgStripped = await invokeHandler(configHandler, { url: '/' });
  assert.equal(cfgStripped.status, 200);

  // /api/gnani/tts with missing text -> 400 (proves route matched, NOT 404), even with pre-parsed Vercel body
  const ttsStripped = await invokeHandler(ttsHandler, {
    method: 'POST',
    url: '/',
    headers: {
      'content-type': 'application/json',
      'x-api-key-id': 'manual-test-key-123456',
    },
    preParsedBody: {},
  });
  assert.equal(ttsStripped.status, 400);
  assert.match(ttsStripped.body, /text is required/);

  // /api/gnani/stt with missing audioBase64 -> 400 (proves route matched, NOT 404)
  const sttFull = await invokeHandler(sttHandler, {
    method: 'POST',
    url: '/api/gnani/stt',
    headers: {
      'content-type': 'application/json',
      'x-api-key-id': 'manual-test-key-123456',
    },
    preParsedBody: {},
  });
  assert.equal(sttFull.status, 400);
  assert.match(sttFull.body, /audioBase64 is required/);

  // /api/gemini/scene with missing imageBase64 -> 400 (proves route matched, NOT 404)
  const sceneStripped = await invokeHandler(sceneHandler, {
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    preParsedBody: {},
  });
  assert.equal(sceneStripped.status, 400);
  assert.match(sceneStripped.body, /imageBase64 is required/);

  // /api/gemini/question with empty question -> 200 prompt (proves route matched, NOT 404)
  const questionStripped = await invokeHandler(questionHandler, {
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    preParsedBody: { language: 'en' },
  });
  assert.equal(questionStripped.status, 200);
  assert.match(questionStripped.body, /Please ask a question/);
});
