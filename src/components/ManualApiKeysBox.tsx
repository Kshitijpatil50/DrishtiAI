/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Check, Trash2 } from 'lucide-react';
import {
  cleanManualKey,
  clearStoredManualKeys,
  getStoredGeminiKey,
  getStoredGnaniKey,
  setStoredGeminiKey,
  setStoredGnaniKey,
} from '../services/manualKeys';

interface ManualApiKeysBoxProps {
  compact?: boolean;
  language?: 'en' | 'hi';
  onKeysChanged?: () => void;
}

export const ManualApiKeysBox: React.FC<ManualApiKeysBoxProps> = ({
  compact = false,
  language = 'en',
  onKeysChanged,
}) => {
  const [geminiInput, setGeminiInput] = useState<string>(() => getStoredGeminiKey());
  const [gnaniInput, setGnaniInput] = useState<string>(() => getStoredGnaniKey());
  const [savedGemini, setSavedGemini] = useState<string>(() => getStoredGeminiKey());
  const [savedGnani, setSavedGnani] = useState<string>(() => getStoredGnaniKey());
  const [showGemini, setShowGemini] = useState(false);
  const [showGnani, setShowGnani] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const hasSavedAny = Boolean(savedGemini || savedGnani);
  const hasSavedBoth = Boolean(savedGemini && savedGnani);
  const isDirty =
    cleanManualKey(geminiInput) !== savedGemini ||
    cleanManualKey(gnaniInput) !== savedGnani;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextGemini = setStoredGeminiKey(geminiInput);
    const nextGnani = setStoredGnaniKey(gnaniInput);

    setGeminiInput(nextGemini);
    setGnaniInput(nextGnani);
    setSavedGemini(nextGemini);
    setSavedGnani(nextGnani);

    if (nextGemini || nextGnani) {
      setStatusMessage(
        language === 'hi'
          ? 'एपीआई की सहेजी गईं।'
          : 'API keys saved for this browser.'
      );
    } else {
      setStatusMessage(
        language === 'hi' ? 'एपीआई की हटाई गईं।' : 'Manual API keys cleared.'
      );
    }
    onKeysChanged?.();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearStoredManualKeys();
    setGeminiInput('');
    setGnaniInput('');
    setSavedGemini('');
    setSavedGnani('');
    setStatusMessage(
      language === 'hi' ? 'एपीआई की हटाई गईं।' : 'Manual API keys cleared.'
    );
    onKeysChanged?.();
  };

  return (
    <section
      className={`w-full bg-white border border-line rounded-[10px] text-left shadow-xs ${
        compact ? 'p-3' : 'p-3.5'
      }`}
      aria-label="Manual API keys for deployed app"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-line">
        <div className="flex items-center gap-1.5 min-w-0">
          <KeyRound className="w-3.5 h-3.5 text-[#2F3BE0] shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-medium text-ink tracking-tight">
            {language === 'hi' ? 'एपीआई की (मैन्युअल)' : 'Manual API Keys'}
          </h2>
        </div>

        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 border rounded-[4px] shrink-0 ${
            hasSavedBoth
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : hasSavedAny
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-[#FCF7F2] text-muted border-line'
          }`}
        >
          {hasSavedBoth
            ? '2/2 saved'
            : hasSavedAny
            ? '1/2 saved'
            : 'Hosted mode'}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-muted leading-snug">
        {language === 'hi'
          ? 'होस्ट किए गए ऐप को चलाने के लिए अपनी Gemini और Gnani API key दर्ज करें।'
          : 'Enter your Gemini and Gnani API keys to run Drishti AI in this hosted version.'}
      </p>

      <form onSubmit={handleSave} className="mt-2.5 space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="manual-gemini-key"
              className="text-[11px] font-medium text-ink"
            >
              Gemini API Key
            </label>
            {savedGemini && (
              <span className="text-[10px] text-emerald-700 font-medium">
                Saved ({savedGemini.length} chars)
              </span>
            )}
          </div>
          <div className="relative flex items-center">
            <input
              id="manual-gemini-key"
              type={showGemini ? 'text' : 'password'}
              value={geminiInput}
              onChange={(e) => {
                setGeminiInput(e.target.value);
                setStatusMessage(null);
              }}
              placeholder="AIza..."
              autoComplete="off"
              spellCheck={false}
              className="w-full text-xs pl-2.5 pr-8 py-1.5 bg-[#F9FAFB] border border-line rounded-[8px] text-ink focus:outline-none focus:border-[#2F3BE0] focus:bg-white placeholder:text-gray-400"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowGemini((prev) => !prev);
              }}
              className="absolute right-2 p-0.5 text-muted hover:text-ink cursor-pointer"
              aria-label={showGemini ? 'Hide Gemini API key' : 'Show Gemini API key'}
            >
              {showGemini ? (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label
              htmlFor="manual-gnani-key"
              className="text-[11px] font-medium text-ink"
            >
              Gnani API Key
            </label>
            {savedGnani && (
              <span className="text-[10px] text-emerald-700 font-medium">
                Saved ({savedGnani.length} chars)
              </span>
            )}
          </div>
          <div className="relative flex items-center">
            <input
              id="manual-gnani-key"
              type={showGnani ? 'text' : 'password'}
              value={gnaniInput}
              onChange={(e) => {
                setGnaniInput(e.target.value);
                setStatusMessage(null);
              }}
              placeholder="Enter Gnani X-API-Key-ID"
              autoComplete="off"
              spellCheck={false}
              className="w-full text-xs pl-2.5 pr-8 py-1.5 bg-[#F9FAFB] border border-line rounded-[8px] text-ink focus:outline-none focus:border-[#2F3BE0] focus:bg-white placeholder:text-gray-400"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowGnani((prev) => !prev);
              }}
              className="absolute right-2 p-0.5 text-muted hover:text-ink cursor-pointer"
              aria-label={showGnani ? 'Hide Gnani API key' : 'Show Gnani API key'}
            >
              {showGnani ? (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            type="submit"
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 bg-[#2F3BE0] hover:bg-[#2530c0] active:scale-[0.99] text-white text-xs font-medium rounded-[8px] transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {isDirty
                ? language === 'hi'
                  ? 'की सहेजें'
                  : 'Save keys'
                : language === 'hi'
                ? 'की अपडेट करें'
                : 'Save keys'}
            </span>
          </button>

          {(hasSavedAny || geminiInput || gnaniInput) && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center justify-center gap-1 py-1.5 px-2.5 bg-[#F9FAFB] hover:bg-gray-100 border border-line text-ink text-xs font-medium rounded-[8px] transition-colors cursor-pointer"
              aria-label="Clear saved API keys"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {statusMessage && (
          <p
            role="status"
            className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[6px] px-2 py-1"
          >
            {statusMessage}
          </p>
        )}
      </form>
    </section>
  );
};
