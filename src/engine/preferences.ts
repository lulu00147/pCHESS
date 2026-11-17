export type ThreadPreference = 'auto' | 1 | 2 | 4;
export type HashPreference = 'auto' | 16 | 32 | 64 | 128 | 256;

export interface EnginePreferences {
  readonly threads: ThreadPreference;
  readonly hashMb: HashPreference;
}

export const DEFAULT_ENGINE_PREFERENCES: EnginePreferences = {
  threads: 'auto',
  hashMb: 'auto',
};

const STORAGE_KEY = 'pchess:v1:engine';
const THREADS: readonly ThreadPreference[] = ['auto', 1, 2, 4];
const HASHES: readonly HashPreference[] = ['auto', 16, 32, 64, 128, 256];

export function loadEnginePreferences(): EnginePreferences {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<EnginePreferences>;
    return {
      threads: THREADS.includes(parsed.threads as ThreadPreference)
        ? (parsed.threads as ThreadPreference)
        : 'auto',
      hashMb: HASHES.includes(parsed.hashMb as HashPreference)
        ? (parsed.hashMb as HashPreference)
        : 'auto',
    };
  } catch {
    return DEFAULT_ENGINE_PREFERENCES;
  }
}

export function saveEnginePreferences(preferences: EnginePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    
  }
}

export function resolveEngineOptions(
  preferences: EnginePreferences,
  auto: { readonly threads: number; readonly hashMb: number },
): { threads: number; hashMb: number } {
  return {
    threads: preferences.threads === 'auto' ? auto.threads : preferences.threads,
    hashMb: preferences.hashMb === 'auto' ? auto.hashMb : preferences.hashMb,
  };
}
