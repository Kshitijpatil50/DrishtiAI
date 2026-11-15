/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getActiveManualGeminiKey } from './manualKeys';
import type { MemoryFramePayload } from '../vision/memory';
import type { LanguageCode } from '../state/machine';

// Model constant specified in single constant at the top
export const GEMINI_MODEL = 'gemini-4-hydrogen';

export interface SceneNarrationResult {
  urgency: 'hazard' | 'info' | 'silent';
  speech: string;
  language: LanguageCode;
  error?: string;
}

export interface QuestionResult {
  speech: string;
  language: LanguageCode;
  question?: string;
  error?: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

function buildGeminiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const manualKey = getActiveManualGeminiKey();
  if (manualKey) {
    headers['X-Gemini-API-Key'] = manualKey;
  }
  return headers;
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `${label} failed with status ${response.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ''}`
    );
  }
  if (!contentType.includes('application/json')) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `${label} returned non-JSON (${contentType || 'unknown'}): ${bodyText.slice(0, 120)}`
    );
  }
  return (await response.json()) as T;
}

/**
 * Calls Gemini server endpoint to narrate current scene.
 */
export async function narrateScene(
  imageBase64: string,
  recentNarration: string[] = [],
  language: LanguageCode = 'en',
  signal?: AbortSignal
): Promise<SceneNarrationResult> {
  const response = await fetch('/api/gemini/scene', {
    method: 'POST',
    headers: buildGeminiHeaders(),
    body: JSON.stringify({
      imageBase64,
      recentNarration,
      language,
    }),
    signal,
  });

  const data = await parseJsonResponse<SceneNarrationResult>(response, 'Scene narration');
  return {
    urgency: data.urgency || 'silent',
    speech: data.speech || '',
    language: data.language || language,
    error: data.error,
  };
}

/**
 * Calls Gemini server endpoint to answer user question based on camera view.
 */
export async function answerQuestion(
  question: string,
  imageBase64: string,
  history: ConversationTurn[] = [],
  language: LanguageCode = 'en',
  signal?: AbortSignal,
  audioBase64?: string,
  recentFrames: MemoryFramePayload[] = []
): Promise<QuestionResult> {
  const response = await fetch('/api/gemini/question', {
    method: 'POST',
    headers: buildGeminiHeaders(),
    body: JSON.stringify({
      question,
      imageBase64,
      history,
      language,
      audioBase64,
      recentFrames,
    }),
    signal,
  });

  const data = await parseJsonResponse<QuestionResult>(response, 'Question answering');
  return {
    speech: data.speech || '',
    language: data.language || language,
    question: data.question,
    error: data.error,
  };
}

