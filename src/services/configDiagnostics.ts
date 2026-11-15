export interface ApiKeyDiagnostic {
  configured: boolean;
  present: boolean;
  length: number;
  formatValid: boolean;
  isPlaceholder: boolean;
  hasSurroundingQuotesOrWhitespace: boolean;
  envSource: string | null;
}

export interface RuntimeConfigResponse {
  hasGeminiKey: boolean;
  hasGnaniKey: boolean;
  runtime?: string;
  gemini?: ApiKeyDiagnostic;
  gnani?: ApiKeyDiagnostic;
}

export type KeyBadgeTone = 'ok' | 'warn' | 'error';

export interface FormattedKeySummary {
  label: string;
  tone: KeyBadgeTone;
  detail: string;
}

export function formatKeyDiagnostic(
  diag: ApiKeyDiagnostic | undefined,
  legacyHasKey: boolean
): FormattedKeySummary {
  if (!diag) {
    return legacyHasKey
      ? { label: 'Connected', tone: 'ok', detail: 'Detected on server' }
      : { label: 'Missing', tone: 'error', detail: 'Not set in environment' };
  }

  if (diag.isPlaceholder) {
    return {
      label: 'Placeholder',
      tone: 'error',
      detail: `${diag.envSource || 'Env var'} contains placeholder text`,
    };
  }

  if (!diag.present || !diag.configured) {
    return {
      label: 'Missing',
      tone: 'error',
      detail: 'Not injected in runtime env',
    };
  }

  if (!diag.formatValid) {
    return {
      label: 'Check format',
      tone: 'warn',
      detail: `${diag.envSource || 'Env var'} • ${diag.length} chars (unexpected format)`,
    };
  }

  const trimNote = diag.hasSurroundingQuotesOrWhitespace ? ' • trimmed' : '';
  return {
    label: 'Connected',
    tone: 'ok',
    detail: `${diag.envSource || 'Env var'} • ${diag.length} chars${trimNote}`,
  };
}
