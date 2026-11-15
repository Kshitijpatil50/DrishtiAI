/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import {
  formatKeyDiagnostic,
  KeyBadgeTone,
  RuntimeConfigResponse,
} from '../services/configDiagnostics';

interface ConfigDiagnosticsProps {
  compact?: boolean;
  manualGeminiSet?: boolean;
  manualGnaniSet?: boolean;
  onConfigLoaded?: (config: RuntimeConfigResponse) => void;
}

function StatusIcon({ tone }: { tone: KeyBadgeTone }) {
  if (tone === 'ok') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />;
  }
  if (tone === 'warn') {
    return <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />;
  }
  return <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />;
}

function badgeClasses(tone: KeyBadgeTone): string {
  if (tone === 'ok') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  if (tone === 'warn') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-red-50 text-red-700 border-red-200';
}

export const ConfigDiagnostics: React.FC<ConfigDiagnosticsProps> = ({
  compact = false,
  manualGeminiSet = false,
  manualGnaniSet = false,
  onConfigLoaded,
}) => {
  const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onConfigLoadedRef = useRef(onConfigLoaded);
  onConfigLoadedRef.current = onConfigLoaded;

  const checkConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `/api/config returned ${response.status}${text ? `: ${text.slice(0, 80)}` : ''}`
        );
      }
      if (!contentType.includes('application/json')) {
        throw new Error(`/api/config returned ${contentType || 'non-JSON'} (check API rewrite)`);
      }
      const data = (await response.json()) as RuntimeConfigResponse;
      setConfig(data);
      onConfigLoadedRef.current?.(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to reach /api/config');
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConfig();
  }, [checkConfig]);

  const geminiSummary = manualGeminiSet
    ? {
        label: 'Manual key',
        tone: 'ok' as KeyBadgeTone,
        detail: 'Using manually entered Gemini key',
      }
    : config
    ? formatKeyDiagnostic(config.gemini, config.hasGeminiKey)
    : null;
  const gnaniSummary = manualGnaniSet
    ? {
        label: 'Manual key',
        tone: 'ok' as KeyBadgeTone,
        detail: 'Using manually entered Gnani key',
      }
    : config
    ? formatKeyDiagnostic(config.gnani, config.hasGnaniKey)
    : null;

  return (
    <section
      className={`w-full bg-white border border-line rounded-[10px] text-left shadow-xs ${
        compact ? 'p-3' : 'p-3.5'
      }`}
      aria-label="Runtime API key diagnostics"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-medium text-ink tracking-tight">
            API Diagnostics
          </h2>
          {config?.runtime && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-[#FCF7F2] border border-line rounded-[4px] text-muted">
              {config.runtime}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            checkConfig();
          }}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ink bg-[#F9FAFB] hover:bg-gray-100 border border-line rounded-[6px] px-2 py-1 cursor-pointer disabled:opacity-50 transition-colors"
          aria-label="Refresh API status"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{loading ? 'Checking' : 'Refresh'}</span>
        </button>
      </div>

      {error ? (
        <div className="mt-2.5 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-[8px] p-2">
          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="break-words">{error}</span>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          {/* Gemini status row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {geminiSummary ? (
                <StatusIcon tone={geminiSummary.tone} />
              ) : (
                <span className="w-3.5 h-3.5 rounded-[2px] bg-gray-200 animate-pulse shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink leading-tight">Gemini Vision</p>
                <p className="text-[11px] text-muted truncate">
                  {geminiSummary ? geminiSummary.detail : 'Checking /api/config...'}
                </p>
              </div>
            </div>
            {geminiSummary && (
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 border rounded-[4px] shrink-0 ${badgeClasses(
                  geminiSummary.tone
                )}`}
              >
                {geminiSummary.label}
              </span>
            )}
          </div>

          {/* Gnani status row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {gnaniSummary ? (
                <StatusIcon tone={gnaniSummary.tone} />
              ) : (
                <span className="w-3.5 h-3.5 rounded-[2px] bg-gray-200 animate-pulse shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink leading-tight">Gnani Voice</p>
                <p className="text-[11px] text-muted truncate">
                  {gnaniSummary ? gnaniSummary.detail : 'Checking /api/config...'}
                </p>
              </div>
            </div>
            {gnaniSummary && (
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 border rounded-[4px] shrink-0 ${badgeClasses(
                  gnaniSummary.tone
                )}`}
              >
                {gnaniSummary.label}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
