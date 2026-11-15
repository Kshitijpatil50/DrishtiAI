/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { buildConfigStatus, resolveEnvKey, resolveRequestKey } from './configStatus.js';
import {
  GnaniServerQueue,
  isGnaniBusyResponse,
  isGnaniTransientError,
} from './gnaniConcurrency.js';
import {
  SCENE_MODELS,
  QUESTION_MODELS,
  generateContentWithFallback,
} from './geminiFallback.js';
import {
  type LanguageCode,
  normalizeLang,
  getLanguageDisplayName,
  detectQuestionLanguage,
  resolveQuestionLanguage,
} from './language.js';

dotenv.config();

const gnaniServerQueue = new GnaniServerQueue({ cooldownAfterAbortMs: 450 });

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener(
      'abort',
      () => {
        if (!controller.signal.aborted) {
          controller.abort(sig.reason);
        }
      },
      { once: true }
    );
  }
  return controller.signal;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export const app = express();

// Preserve pre-parsed request bodies (e.g. Vercel @vercel/node) so express.json/raw never hang or clobber
app.use((req: any, _res: Response, next) => {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string' && req.headers['content-type']?.includes('application/json')) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // Leave unparsed
      }
    } else if (Buffer.isBuffer(req.body) && req.headers['content-type']?.includes('application/json')) {
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        // Leave unparsed
      }
    }
    req._body = true;
  }
  next();
});
// Middleware for parsing JSON with ample limit for base64 images
app.use(express.json({ limit: '20mb' }));
// Middleware for parsing raw audio buffers
app.use(express.raw({ type: ['audio/wav', 'audio/*', 'application/octet-stream'], limit: '20mb' }));

// Helper to get environment keys (supporting standard and VITE_ prefixes, trimmed and unquoted safely)
export function getGeminiKey(): string {
  const resolved = resolveEnvKey([
    ['GEMINI_API_KEY', process.env.GEMINI_API_KEY],
    ['VITE_GEMINI_API_KEY', process.env.VITE_GEMINI_API_KEY],
  ]);
  const detected = resolved.value.length > 0;
  console.log(
    `[Env Debug] getGeminiKey: detected=${detected} source=${resolved.source ?? 'none'} length=${resolved.value.length} runtime=${process.env.VERCEL ? 'vercel' : 'node'}`
  );
  return resolved.value;
}

export function getGnaniKey(): string {
  const resolved = resolveEnvKey([
    ['GNANI_API_KEY', process.env.GNANI_API_KEY],
    ['VITE_GNANI_API_KEY', process.env.VITE_GNANI_API_KEY],
    ['GNANI_KEY', process.env.GNANI_KEY],
  ]);
  const detected = resolved.value.length > 0;
  console.log(
    `[Env Debug] getGnaniKey: detected=${detected} source=${resolved.source ?? 'none'} length=${resolved.value.length} runtime=${process.env.VERCEL ? 'vercel' : 'node'}`
  );
  return resolved.value;
}

export const GEMINI_MODEL = 'gemini-4-hydrogen';
let cachedAiKey: string | null = null;
let cachedAiClient: GoogleGenAI | null = null;

function getGenAIClient(apiKey: string): GoogleGenAI {
  if (cachedAiClient && cachedAiKey === apiKey) {
    return cachedAiClient;
  }
  cachedAiKey = apiKey;
  cachedAiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedAiClient;
}

const SYSTEM_INSTRUCTION_TEMPLATE = `You are Drishti, a warm, calm, attentive human-sounding voice guide helping a blind person see and navigate with their phone camera. Speak strictly in {LANG} (en = natural, friendly Indian English with everyday contractions like "there's" and "it's"; hi = warm everyday spoken Hindi in Devanagari script, feminine first person; mr = warm, natural everyday spoken Marathi in Devanagari script, feminine first person).
Since your reply is spoken aloud by a human voice: write short, flowing sentences as you would naturally say them in conversation — zero markdown, no lists, no emojis, write small numbers as words.
CRITICAL LANGUAGE MATCHING: Always reply strictly in the exact language of the user's CURRENT question (English question -> English answer; Hindi question -> Hindi Devanagari answer; Marathi question -> Marathi Devanagari answer), regardless of what language earlier conversation turns used, unless the user explicitly asks you to switch to another language.
CONVERSATION & FOLLOW-UPS: Pay attention to recent conversation turns so pronouns like "it", "that", "there", or "say that again" make immediate sense. If the user simply greets you, thanks you, or chats, answer warmly and naturally like a friend without forcing a camera rundown.
VISUAL MEMORY & WHEREABOUTS: You may also receive earlier camera frames labeled with how many seconds ago they were seen. When the user asks where an object, landmark, door, exit, or way is, check BOTH the current live camera view AND those recent earlier frames. If it is in the current view, guide them directly. If it is not in the current view but appeared in an earlier frame, tell them clearly where it appeared relative to that view and roughly when (for example, "I saw the stairs to your left about twelve seconds ago, so try turning left"), without claiming it is directly ahead right now. If it is not in the current or recent frames, say so honestly and invite them to pan slowly.
ANSWERING VISUAL QUESTIONS: Answer directly what was asked in one or two crisp, natural sentences from what you actually see. For text, labels, currency, medicine strips, or signs, read the exact words or value clearly. For distance or size, give an honest conversational estimate with "about" (e.g., "about two steps to your left"). If the view is blurry, dark, or cropped, say so gently and guide the camera ("tilt a little to your left so I can see better"). If asked to switch languages, switch cleanly and set "language".
SCENE & SAFETY: Put any hazard first. Never promise a path is completely safe—use natural phrasing like "Looks clear right ahead, just keep using your cane." Never guess someone's identity; if unsure, say so honestly.`;

const apiRouter = express.Router();

// Configuration endpoint (returns safe non-secret injection & format diagnostics)
apiRouter.get('/config', (_req: Request, res: Response) => {
  const status = buildConfigStatus(process.env);
  console.log(
    `[Env Debug] /api/config: gemini=${status.gemini.configured} (${status.gemini.envSource ?? 'none'}, len=${status.gemini.length}), gnani=${status.gnani.configured} (${status.gnani.envSource ?? 'none'}, len=${status.gnani.length}), runtime=${status.runtime}`
  );
  res.json(status);
});

const SCENE_INSTRUCTION_EN = `You are Drishti, a warm, calm voice guide helping a blind person with a phone camera pointed ahead.
Return JSON: {"urgency":"hazard"|"info"|"silent","speech":"...","language":"en"}
Rules:
- Speak naturally in 1 or 2 short sentences (under 20 words total), using natural contractions ("There's", "It's"). Spoken plain text only—no markdown, emojis, or raw digits.
- Any hazard (stairs, drop, vehicle, approaching person, obstacle, wet floor, low object) comes first with urgency "hazard".
- Mention direction (left, right, ahead) and approximate distance ("about two steps").
- If nothing meaningful changed since recent narrations, return urgency "silent" and empty speech.
- Never promise a path is completely safe.`;

const SCENE_INSTRUCTION_HI = `आप दृष्टि हैं, दृष्टिहीन व्यक्ति की दोस्त जैसी शांत और भरोसेमंद वॉइस गाइड।
JSON दें: {"urgency":"hazard"|"info"|"silent","speech":"...","language":"hi"}
नियम:
- सहज बोलचाल की हिंदी में 1-2 छोटे वाक्य (20 शब्दों से कम) बोलें। कोई मार्कडाउन या इमोजी नहीं।
- कोई भी खतरा (सीढ़ियाँ, वाहन, गड्ढा, बाधा, व्यक्ति पास आना) पहले बताएं और urgency "hazard" रखें।
- दिशा (बाएँ, दाएँ, सामने) और अनुमानित दूरी बताएं (जैसे "लगभग दो कदम आगे")।
- अगर पहले बताई चीज़ों से कुछ खास नहीं बदला है, तो urgency "silent" और speech खाली रखें।`;

const SCENE_INSTRUCTION_MR = `तुम्ही दृष्टी आहात, एका अंध व्यक्तीला मदत करणाऱ्या शांत, प्रेमळ आणि विश्वासू व्हॉइस गाइड.
JSON द्या: {"urgency":"hazard"|"info"|"silent","speech":"...","language":"mr"}
नियम:
- रोजच्या साध्या, नैसर्गिक बोलचालच्या मराठीत एक किंवा दोन छोटी वाक्ये (वीस शब्दांपेक्षा कमी) बोला. मार्कडाउन, याद्या किंवा इमोजी वापरू नका.
- कोणताही धोका (पायऱ्या, वाहन, खड्डा, अडथळा, जवळ येणारी व्यक्ती, ओली जमीन) आधी सांगा आणि urgency "hazard" ठेवा.
- दिशा (डावीकडे, उजवीकडे, समोर) आणि अंदाजे अंतर सांगा (उदा. "अंदाजे दोन पावले समोर").
- आधी सांगितलेल्या गोष्टींपेक्षा काहीही महत्त्वाचे बदलले नसेल, तर urgency "silent" आणि speech रिकामे ठेवा.
- रस्ता पूर्णपणे सुरक्षित आहे असे कधीही आश्वासन देऊ नका.`;

// Helper to safely parse JSON responses (stripping optional markdown fences)
function parseModelJson<T>(rawText: string | undefined, fallback: T): T {
  if (!rawText) return fallback;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// Proactive Scene Narration endpoint
apiRouter.post('/gemini/scene', async (req: Request, res: Response) => {
  const clientAbort = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  res.on('close', onClientClose);

  try {
    const { imageBase64, recentNarration = [], language: rawLanguage = 'en' } = req.body || {};
    const reqLanguage = normalizeLang(rawLanguage, 'en');
    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required' });
      return;
    }

    const resolvedGemini = resolveRequestKey(
      req.headers['x-gemini-api-key'],
      getGeminiKey()
    );
    const apiKey = resolvedGemini.value;
    if (!apiKey) {
      res.status(200).json({
        urgency: 'silent',
        speech: '',
        error: 'Missing GEMINI_API_KEY on server',
      });
      return;
    }

    const ai = getGenAIClient(apiKey);
    const systemInstruction =
      reqLanguage === 'mr'
        ? SCENE_INSTRUCTION_MR
        : reqLanguage === 'hi'
        ? SCENE_INSTRUCTION_HI
        : SCENE_INSTRUCTION_EN;

    const isFirstObservation = recentNarration.length === 0;
    const promptText = isFirstObservation
      ? 'What is directly in front of the camera right now? If any obstacle, furniture, door, or path is visible, describe it briefly.'
      : `Recent: ${recentNarration.slice(-3).map((n: string) => `"${n}"`).join(', ')}. If scene changed or obstacle is closer, describe it. Otherwise urgency "silent".`;

    const mimeType = imageBase64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
    const response = await generateContentWithFallback(
      ai,
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
              {
                text: promptText,
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              urgency: {
                type: Type.STRING,
              },
              speech: {
                type: Type.STRING,
              },
              language: {
                type: Type.STRING,
              },
            },
            required: ['urgency', 'speech', 'language'],
          },
        },
      },
      {
        totalBudgetMs: 18000,
        attemptTimeoutMs: 11000,
        models: SCENE_MODELS,
        hedge: false,
        cacheKey: 'scene',
        signal: clientAbort.signal,
      }
    );

    if (res.writableEnded || clientAbort.signal.aborted) return;

    const parsed = parseModelJson<any>(response.text, {
      urgency: 'silent',
      speech: '',
      language: reqLanguage,
    });
    const normalizedUrgency =
      parsed.urgency === 'hazard' || parsed.urgency === 'info' ? parsed.urgency : 'silent';
    const normalizedLang = normalizeLang(parsed.language, reqLanguage);

    res.json({
      urgency: normalizedUrgency,
      speech: typeof parsed.speech === 'string' ? parsed.speech : '',
      language: normalizedLang,
    });
  } catch (err: any) {
    if (clientAbort.signal.aborted || res.writableEnded) return;
    console.warn('Gemini scene narration skipped:', err?.message || err);
    res.status(200).json({
      urgency: 'silent',
      speech: '',
      error: err?.message || 'Gemini error',
    });
  } finally {
    res.off('close', onClientClose);
  }
});

// Answering User Question endpoint
apiRouter.post('/gemini/question', async (req: Request, res: Response) => {
  const { imageBase64, question, audioBase64, history = [], recentFrames = [] } = req.body || {};
  const rawQuestion = typeof question === 'string' ? question.trim() : '';
  const { effectiveLanguage: language, explicitSwitchTarget } = resolveQuestionLanguage({
    rawQuestion,
    requestedLanguage: req.body?.language,
  });

  const clientAbort = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  res.on('close', onClientClose);

  try {
    if (!rawQuestion && !audioBase64) {
      res.status(200).json({
        speech:
          language === 'mr'
            ? 'कृपया तुमचा प्रश्न विचारा.'
            : language === 'hi'
            ? 'कृपया अपना सवाल पूछिए।'
            : 'Please ask a question.',
        language,
      });
      return;
    }

    const resolvedGemini = resolveRequestKey(
      req.headers['x-gemini-api-key'],
      getGeminiKey()
    );
    const apiKey = resolvedGemini.value;
    if (!apiKey) {
      res.status(200).json({
        speech:
          language === 'mr'
            ? 'दृष्टीची जेमिनी एपीआई की अद्याप सेट केलेली नाही. कृपया एपीआई की बॉक्समध्ये ती टाका.'
            : language === 'hi'
            ? 'दृष्टि का विज़न एपीआई की सेट नहीं है।'
            : "My vision service doesn't have a Gemini API key yet. Please add it in the API keys box.",
        language,
        error: 'Missing GEMINI_API_KEY on server',
      });
      return;
    }

    const ai = getGenAIClient(apiKey);

    const fallbackQuestion =
      language === 'mr'
        ? 'माझ्या समोर काय आहे?'
        : language === 'hi'
        ? 'मेरे सामने क्या है?'
        : 'What is in front of me?';
    const needsAudioTranscription = !rawQuestion && Boolean(audioBase64);

    const langDisplay = getLanguageDisplayName(language);
    const systemInstruction = needsAudioTranscription
      ? SYSTEM_INSTRUCTION_TEMPLATE.replace(
          '{LANG}',
          `the exact language spoken by the user in their audio clip (English "en", Hindi "hi", or Marathi "mr"; default ${langDisplay} "${language}" only if unclear)`
        )
      : SYSTEM_INSTRUCTION_TEMPLATE.replace('{LANG}', `${langDisplay} (code "${language}")`);

    const sanitizedMemoryFrames = Array.isArray(recentFrames)
      ? recentFrames
          .filter(
            (f: any) =>
              f &&
              typeof f.imageBase64 === 'string' &&
              f.imageBase64.length > 0 &&
              typeof f.secondsAgo === 'number'
          )
          .slice(-5)
      : [];

    const parts: any[] = [];
    if (sanitizedMemoryFrames.length > 0) {
      parts.push({
        text: 'Recent earlier camera frames (chronological visual memory, oldest to newest):',
      });
      for (const frame of sanitizedMemoryFrames) {
        const mimeType = frame.imageBase64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
        const note =
          typeof frame.narration === 'string' && frame.narration.trim()
            ? ` — previously noted: "${frame.narration.trim()}"`
            : '';
        parts.push({ text: `[Earlier view, ${Math.max(1, Math.round(frame.secondsAgo))} seconds ago${note}]` });
        parts.push({
          inlineData: {
            mimeType,
            data: frame.imageBase64,
          },
        });
      }
    }

    if (imageBase64) {
      if (sanitizedMemoryFrames.length > 0) {
        parts.push({ text: '[Current live camera view, right now]' });
      }
      const mimeType = imageBase64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
      parts.push({
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      });
    }

    if (needsAudioTranscription && audioBase64) {
      parts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64,
        },
      });
    }

    const recentTurns = (history || []).slice(-4);
    const historyText = recentTurns.length > 0 ? `Recent conversation:\n${recentTurns.map((t: any) => `${t.role === 'user' ? 'User' : 'Drishti'}: ${t.text}`).join('\n')}\n` : '';
    const languageDirective = explicitSwitchTarget
      ? `LANGUAGE RULE: The user explicitly asked to respond in ${langDisplay}. Write JSON "speech" in ${langDisplay} and set JSON "language" to "${language}".`
      : `MANDATORY LANGUAGE RULE: The user's current question is in ${langDisplay}. You MUST write JSON "speech" strictly in ${langDisplay} and set JSON "language" to "${language}". Do NOT answer in any other language even if earlier conversation turns used another language.`;

    const promptWithHistory = needsAudioTranscription
      ? `${historyText}Listen carefully to the user's voice clip (English, Hindi, or Marathi). Put their exact words in JSON "question" in the language they spoke (or "${fallbackQuestion}" if unclear). MANDATORY LANGUAGE RULE: Detect which language they spoke in the clip (English="en", Hindi="hi", Marathi="mr"), set JSON "language" to that exact code, and write JSON "speech" strictly in THAT SAME spoken language (never switch to another language from earlier turns unless they asked to switch). Respond naturally in one or two short spoken sentences, checking both the live camera view and recent earlier frames if they ask where something or a path is.`
      : `${historyText}User's current question: "${rawQuestion || fallbackQuestion}"
${languageDirective}
${
  imageBase64
    ? 'Respond naturally and directly in one or two short spoken sentences, checking the current live camera view first and the recent earlier frames whenever they ask where an object, landmark, or way is.'
    : 'Respond naturally in one or two short spoken sentences; if they asked about what is around them, gently ask them to point the camera ahead.'
}`;

    parts.push({ text: promptWithHistory });

    const questionConfig = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          speech: {
            type: Type.STRING,
          },
          language: {
            type: Type.STRING,
          },
          question: {
            type: Type.STRING,
          },
        },
        required: ['speech', 'language'],
      },
    };

    let response: any;
    try {
      response = await generateContentWithFallback(
        ai,
        {
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          config: questionConfig,
        },
        {
          totalBudgetMs: 32000,
          attemptTimeoutMs: 22000,
          hedgeDelayMs: 2500,
          models: QUESTION_MODELS,
          hedge: true,
          cacheKey: 'question',
          signal: clientAbort.signal,
        }
      );
    } catch (primaryErr: any) {
      const msg = String(primaryErr?.message || '');
      const canRetryLean =
        sanitizedMemoryFrames.length > 0 &&
        Boolean(imageBase64) &&
        !clientAbort.signal.aborted &&
        primaryErr?.name !== 'AbortError' &&
        !/api[_\s-]?key|permission_denied|unauthorized|\b401\b|\b403\b/i.test(msg);

      if (!canRetryLean) {
        throw primaryErr;
      }

      console.warn('Retrying /api/gemini/question with live frame only after multi-frame failure:', msg);
      const leanParts: any[] = [
        {
          inlineData: {
            mimeType: imageBase64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg',
            data: imageBase64,
          },
        },
      ];
      if (needsAudioTranscription && audioBase64) {
        leanParts.push({
          inlineData: {
            mimeType: 'audio/wav',
            data: audioBase64,
          },
        });
      }
      leanParts.push({ text: promptWithHistory });

      response = await generateContentWithFallback(
        ai,
        {
          contents: [{ role: 'user', parts: leanParts }],
          config: questionConfig,
        },
        {
          totalBudgetMs: 16000,
          attemptTimeoutMs: 12000,
          hedgeDelayMs: 2000,
          models: QUESTION_MODELS,
          hedge: true,
          cacheKey: 'question',
          signal: clientAbort.signal,
        }
      );
    }

    if (res.writableEnded || clientAbort.signal.aborted) return;

    const defaultUnclearSpeech =
      language === 'mr'
        ? 'मला हे नीट दिसले नाही.'
        : language === 'hi'
        ? 'मुझे यह समझ नहीं आया।'
        : "I couldn't quite see that clearly.";

    const parsed = parseModelJson<any>(response.text, {
      speech: defaultUnclearSpeech,
      language,
    });
    const resolvedQuestion =
      rawQuestion ||
      (typeof parsed.question === 'string' && parsed.question.trim()
        ? parsed.question.trim()
        : fallbackQuestion);
    const resolvedSpeech =
      typeof parsed.speech === 'string' && parsed.speech.trim()
        ? parsed.speech
        : defaultUnclearSpeech;
    const responseLanguage: LanguageCode =
      needsAudioTranscription
        ? detectQuestionLanguage(
            resolvedSpeech,
            detectQuestionLanguage(resolvedQuestion, normalizeLang(parsed.language, language))
          )
        : language;

    res.json({
      speech: resolvedSpeech,
      language: responseLanguage,
      question: resolvedQuestion,
    });
  } catch (err: any) {
    if (clientAbort.signal.aborted || res.writableEnded) return;
    console.error('Gemini question answering error:', err);
    const errMsg = String(err?.message || '');
    const isAuthError =
      /api[_\s-]?key[_\s-]?(invalid|not valid)|permission_denied|unauthorized|\b401\b|\b403\b/i.test(
        errMsg
      );
    res.status(200).json({
      speech: isAuthError
        ? language === 'mr'
          ? 'माझी जेमिनी एपीआई की काम करत नाही आहे. कृपया तुमची की तपासा.'
          : language === 'hi'
          ? 'मेरी जेमिनी एपीआई की काम नहीं कर रही है। कृपया अपनी की जांचें।'
          : "My Gemini API key wasn't accepted. Please check your Gemini API key."
        : language === 'mr'
          ? 'माफ करा, मला आत्ता नीट दिसत नाही आहे. कृपया पुन्हा विचारा.'
          : language === 'hi'
          ? 'माफ़ कीजिए, मैं अभी देख नहीं पा रही हूँ। कृपया दोबारा पूछें।'
          : "Sorry, I couldn't see that clearly right now. Please ask again.",
      language,
      error: err?.message || 'Gemini error',
    });
  } finally {
    res.off('close', onClientClose);
  }
});

// Gnani STT Proxy endpoint
apiRouter.post('/gnani/stt', async (req: Request, res: Response) => {
  const clientAbort = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  res.on('close', onClientClose);

  try {
    const resolvedGnani = resolveRequestKey(req.headers['x-api-key-id'], getGnaniKey());
    const apiKey = resolvedGnani.value;
    if (!apiKey) {
      res.status(401).json({ error: 'Missing GNANI_API_KEY on server' });
      return;
    }

    const { audioBase64, language: rawLanguage } = req.body || {};
    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required' });
      return;
    }

    const sttLanguageHint = normalizeLang(rawLanguage, 'en');
    const sttLanguageCode =
      sttLanguageHint === 'mr' ? 'mr-IN,hi-IN,en-IN' : 'hi-IN,en-IN,mr-IN';
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const result = await gnaniServerQueue.enqueue(async (queueSignal) => {
      const deadlineAt = Date.now() + 16000;
      let lastStatus = 500;
      let lastIsJson = true;
      let lastBody: any = { error: 'Gnani STT proxy failed' };
      let activeLanguageCode = sttLanguageCode;

      for (let attempt = 0; attempt < 4; attempt++) {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 500) break;

        const formData = new FormData();
        formData.append('audio_file', new Blob([audioBuffer], { type: 'audio/wav' }), 'speech.wav');
        formData.append('model', 'prisma-v3.0');
        formData.append('language_code', activeLanguageCode);
        formData.append('format', 'codemix');

        const attemptSignal = combineAbortSignals([
          queueSignal,
          AbortSignal.timeout(Math.min(10000, remaining)),
        ]);

        try {
          const gnaniRes = await fetch('https://api.vachana.ai/stt/v3', {
            method: 'POST',
            headers: {
              'X-API-Key-ID': apiKey,
            },
            body: formData,
            signal: attemptSignal,
          });

          const contentType = gnaniRes.headers.get('content-type') || '';
          const isJson = contentType.includes('application/json');
          const body = isJson ? await gnaniRes.json() : await gnaniRes.text();

          if (gnaniRes.ok) {
            return { status: gnaniRes.status, isJson, body };
          }

          lastStatus = gnaniRes.status;
          lastIsJson = isJson;
          lastBody = body;

          if ((gnaniRes.status === 400 || gnaniRes.status === 422) && activeLanguageCode.includes('mr-IN')) {
            activeLanguageCode = activeLanguageCode === 'mr-IN,hi-IN,en-IN' ? 'mr-IN' : 'hi-IN,en-IN';
            continue;
          }

          if (attempt < 3 && isGnaniTransientError(gnaniRes.status, body)) {
            const busyDelays = [450, 800, 1200];
            const waitMs = isGnaniBusyResponse(gnaniRes.status, body) ? busyDelays[attempt] : 200;
            if (deadlineAt - Date.now() > waitMs + 1000) {
              await abortableSleep(waitMs, queueSignal);
              continue;
            }
          }
          return { status: lastStatus, isJson: lastIsJson, body: lastBody };
        } catch (err: any) {
          if (queueSignal.aborted) throw err;
          lastStatus = 504;
          lastIsJson = true;
          lastBody = { error: err?.message || 'Gnani STT request timed out' };
          if (attempt < 2 && deadlineAt - Date.now() > 1500) {
            await abortableSleep(200, queueSignal);
            continue;
          }
          throw err;
        }
      }

      return { status: lastStatus, isJson: lastIsJson, body: lastBody };
    }, clientAbort.signal);

    if (res.writableEnded || clientAbort.signal.aborted) return;
    if (result.isJson) {
      res.status(result.status).json(result.body);
    } else {
      res.status(result.status).send(result.body);
    }
  } catch (err: any) {
    if (clientAbort.signal.aborted || res.writableEnded) return;
    console.error('Gnani STT proxy error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Gnani STT proxy failed' });
  } finally {
    res.off('close', onClientClose);
  }
});

// Gnani TTS Proxy endpoint
apiRouter.post('/gnani/tts', async (req: Request, res: Response) => {
  const clientAbort = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) {
      clientAbort.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };
  res.on('close', onClientClose);

  try {
    const resolvedGnani = resolveRequestKey(req.headers['x-api-key-id'], getGnaniKey());
    const apiKey = resolvedGnani.value;
    if (!apiKey) {
      res.status(401).json({ error: 'Missing GNANI_API_KEY on server' });
      return;
    }

    const { text, voice = 'Shivani', speed = 1.05 } = req.body || {};
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const result = await gnaniServerQueue.enqueue(async (queueSignal) => {
      const deadlineAt = Date.now() + 17000;
      let lastErrorStatus = 502;
      let lastErrorBody: any = { error: 'Gnani TTS failed' };

      for (let attempt = 0; attempt < 4; attempt++) {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 500) break;

        const attemptSignal = combineAbortSignals([
          queueSignal,
          AbortSignal.timeout(Math.min(11000, remaining)),
        ]);

        try {
          const gnaniRes = await fetch('https://api.vachana.ai/api/v1/tts/inference', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key-ID': apiKey,
            },
            body: JSON.stringify({
              text,
              voice,
              model: 'timbre-v3.0',
              language: 'auto',
              speed,
              audio_config: {
                container: 'mp3',
                sample_rate: 24000,
                bitrate: '32k',
              },
            }),
            signal: attemptSignal,
          });

          if (!gnaniRes.ok) {
            let errBody: any;
            try {
              errBody = await gnaniRes.json();
            } catch {
              errBody = { detail: await gnaniRes.text() };
            }
            lastErrorStatus = gnaniRes.status;
            lastErrorBody = errBody;

            if (attempt < 3 && isGnaniTransientError(gnaniRes.status, errBody)) {
              const busyDelays = [450, 800, 1200];
              const waitMs = isGnaniBusyResponse(gnaniRes.status, errBody)
                ? busyDelays[attempt]
                : 200;
              if (deadlineAt - Date.now() > waitMs + 1200) {
                await abortableSleep(waitMs, queueSignal);
                continue;
              }
            }
            return { ok: false as const, status: lastErrorStatus, errBody: lastErrorBody };
          }

          const audioArrayBuffer = await gnaniRes.arrayBuffer();
          if (audioArrayBuffer.byteLength === 0) {
            lastErrorStatus = 502;
            lastErrorBody = { error: 'Gnani TTS returned empty audio' };
            if (attempt < 3 && deadlineAt - Date.now() > 1500) {
              await abortableSleep(200, queueSignal);
              continue;
            }
            return { ok: false as const, status: lastErrorStatus, errBody: lastErrorBody };
          }

          return { ok: true as const, buffer: Buffer.from(audioArrayBuffer) };
        } catch (err: any) {
          if (queueSignal.aborted) throw err;
          lastErrorStatus = 504;
          lastErrorBody = { error: err?.message || 'Gnani TTS request timed out' };
          if (attempt < 2 && deadlineAt - Date.now() > 1800) {
            await abortableSleep(250, queueSignal);
            continue;
          }
          throw err;
        }
      }

      return { ok: false as const, status: lastErrorStatus, errBody: lastErrorBody };
    }, clientAbort.signal);

    if (res.writableEnded || clientAbort.signal.aborted) return;
    if (!result.ok) {
      res.status(result.status).json(result.errBody);
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(result.buffer);
  } catch (err: any) {
    if (clientAbort.signal.aborted || res.writableEnded) return;
    console.error('Gnani TTS proxy error:', err?.message || err);
    res.status(504).json({ error: err?.message || 'Gnani TTS proxy timed out' });
  } finally {
    res.off('close', onClientClose);
  }
});

// Mount router on /api and root (supports direct and rewritten requests on Vercel)
app.use('/api', apiRouter);
app.use(apiRouter);

/**
 * Wraps the Express app for explicit Vercel Serverless Function files (e.g. api/gnani/tts.ts),
 * restoring routePath if the serverless adapter strips the path prefix to "/".
 */
export function createVercelHandler(routePath: string) {
  return (req: any, res: any) => {
    const currentUrl = typeof req.url === 'string' ? req.url : '/';
    if (currentUrl === '/' || currentUrl.startsWith('/?')) {
      const qsIndex = currentUrl.indexOf('?');
      const qs = qsIndex >= 0 ? currentUrl.slice(qsIndex) : '';
      req.url = `${routePath}${qs}`;
    }
    return app(req, res);
  };
}
