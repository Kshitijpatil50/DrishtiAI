/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const MANUAL_GEMINI_STORAGE_KEY = 'drishti_manual_gemini_api_key';
export const MANUAL_GNANI_STORAGE_KEY = 'drishti_gnani_api_key';

export interface EnvironmentContext {
  isProdBuild: boolean;
  hostname: string;
  search?: string;
  serverRuntime?: string;
}

export interface KeyStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Strips whitespace and accidental surrounding single/double quotes from pasted keys.
 */
export function cleanManualKey(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^(['"])(.*)\1$/, '$2');
  return unquoted.trim();
}

/**
 * Determines whether the app is running in a deployed/hosted environment
 * (e.g. Vercel, AI Studio Shared App `ais-pre-*`, production build, or non-local host).
 * Keeps local dev (`localhost` / `127.0.0.1`) and AI Studio dev preview (`ais-dev-*`) clean.
 */
export function isDeployedEnvironment(ctx: EnvironmentContext): boolean {
  const searchParams = new URLSearchParams(ctx.search || '');
  const override = searchParams.get('deployed');
  if (override === '1') return true;
  if (override === '0') return false;

  const host = (ctx.hostname || '').toLowerCase();
  if (host.startsWith('ais-dev-')) {
    return false;
  }

  if (ctx.serverRuntime === 'vercel' || ctx.isProdBuild) {
    return true;
  }

  const isLocalHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local');

  if (host && !isLocalHost) {
    return true;
  }

  return false;
}

export function getBrowserDeployedFlag(serverRuntime?: string): boolean {
  const isProdBuild = Boolean((import.meta as any)?.env?.PROD);
  if (typeof window === 'undefined') {
    return isDeployedEnvironment({
      isProdBuild,
      hostname: '',
      serverRuntime,
    });
  }
  return isDeployedEnvironment({
    isProdBuild,
    hostname: window.location.hostname || '',
    search: window.location.search || '',
    serverRuntime,
  });
}

function getDefaultStorages(): KeyStorageLike[] {
  if (typeof window === 'undefined') return [];
  const storages: KeyStorageLike[] = [];
  try {
    if (window.localStorage) storages.push(window.localStorage);
  } catch {
    // ignore storage access restrictions
  }
  try {
    if (window.sessionStorage) storages.push(window.sessionStorage);
  } catch {
    // ignore storage access restrictions
  }
  return storages;
}

export function readStoredKey(
  storageKey: string,
  storages: KeyStorageLike[] = getDefaultStorages()
): string {
  for (const store of storages) {
    try {
      const value = cleanManualKey(store.getItem(storageKey) || '');
      if (value) return value;
    } catch {
      // ignore storage errors
    }
  }
  return '';
}

export function writeStoredKey(
  storageKey: string,
  value: string,
  storages: KeyStorageLike[] = getDefaultStorages()
): string {
  const cleaned = cleanManualKey(value);
  for (const store of storages) {
    try {
      if (cleaned) {
        store.setItem(storageKey, cleaned);
      } else {
        store.removeItem(storageKey);
      }
    } catch {
      // ignore storage errors
    }
  }
  return cleaned;
}

export function getStoredGeminiKey(): string {
  return readStoredKey(MANUAL_GEMINI_STORAGE_KEY);
}

export function setStoredGeminiKey(key: string): string {
  return writeStoredKey(MANUAL_GEMINI_STORAGE_KEY, key);
}

export function getStoredGnaniKey(): string {
  return readStoredKey(MANUAL_GNANI_STORAGE_KEY);
}

export function setStoredGnaniKey(key: string): string {
  return writeStoredKey(MANUAL_GNANI_STORAGE_KEY, key);
}

export function clearStoredManualKeys(): void {
  writeStoredKey(MANUAL_GEMINI_STORAGE_KEY, '');
  writeStoredKey(MANUAL_GNANI_STORAGE_KEY, '');
}

export function getActiveManualGeminiKey(serverRuntime?: string): string {
  if (!getBrowserDeployedFlag(serverRuntime)) return '';
  return getStoredGeminiKey();
}

export function getActiveManualGnaniKey(serverRuntime?: string): string {
  if (!getBrowserDeployedFlag(serverRuntime)) return '';
  return getStoredGnaniKey();
}
