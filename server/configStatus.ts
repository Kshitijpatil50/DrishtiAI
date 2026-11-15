export interface ApiKeyStatus {
  configured: boolean;
  present: boolean;
  length: number;
  formatValid: boolean;
  isPlaceholder: boolean;
  hasSurroundingQuotesOrWhitespace: boolean;
  envSource: string | null;
}

export interface RuntimeConfigStatus {
  hasGeminiKey: boolean;
  hasGnaniKey: boolean;
  runtime: string;
  gemini: ApiKeyStatus;
  gnani: ApiKeyStatus;
}

function cleanEnvValue(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^(['"])(.*)\1$/, '$2');
  return unquoted.trim();
}

export function resolveEnvKey(
  candidates: ReadonlyArray<readonly [string, string | undefined]>
): { value: string; raw: string; source: string | null } {
  for (const [name, rawVal] of candidates) {
    if (typeof rawVal === 'string' && cleanEnvValue(rawVal).length > 0) {
      return {
        value: cleanEnvValue(rawVal),
        raw: rawVal,
        source: name,
      };
    }
  }
  return { value: '', raw: '', source: null };
}

export function inspectApiKey(
  candidates: ReadonlyArray<readonly [string, string | undefined]>,
  kind: 'gemini' | 'gnani'
): ApiKeyStatus {
  const { value, raw, source } = resolveEnvKey(candidates);
  const present = value.length > 0;
  const isPlaceholder =
    present &&
    (/^(your|my|enter|replace|sample|placeholder|changeme|dummy)[_-]?/i.test(value) ||
      /_(api_)?key$/i.test(value));
  const hasInternalWhitespace = /\s/.test(value);
  const hasSurroundingQuotesOrWhitespace = present && raw !== value;

  const formatValid =
    present &&
    !isPlaceholder &&
    !hasInternalWhitespace &&
    (kind === 'gemini'
      ? /^[A-Za-z0-9._-]{20,}$/.test(value)
      : value.length >= 16);

  return {
    configured: present && !isPlaceholder,
    present,
    length: value.length,
    formatValid,
    isPlaceholder,
    hasSurroundingQuotesOrWhitespace,
    envSource: source,
  };
}

export function buildConfigStatus(env: Record<string, string | undefined>): RuntimeConfigStatus {
  const gemini = inspectApiKey(
    [
      ['GEMINI_API_KEY', env.GEMINI_API_KEY],
      ['VITE_GEMINI_API_KEY', env.VITE_GEMINI_API_KEY],
    ],
    'gemini'
  );

  const gnani = inspectApiKey(
    [
      ['GNANI_API_KEY', env.GNANI_API_KEY],
      ['VITE_GNANI_API_KEY', env.VITE_GNANI_API_KEY],
      ['GNANI_KEY', env.GNANI_KEY],
    ],
    'gnani'
  );

  return {
    hasGeminiKey: gemini.configured,
    hasGnaniKey: gnani.configured,
    runtime: env.VERCEL ? 'vercel' : 'node',
    gemini,
    gnani,
  };
}
