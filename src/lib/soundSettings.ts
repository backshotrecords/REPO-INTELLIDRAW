/**
 * Sound settings — fetched from the server (SQLite-backed global admin config).
 * Cached in memory so WorkspacePage doesn't need an extra fetch on every play.
 */

import { apiGetSoundConfig } from "./api";

export interface SoundSettings {
  /** Volume from 0 to 1 */
  volume: number;
  /** URL of the notification sound (defaults to bundled file) */
  soundUrl: string;
  /** Whether sound is enabled */
  enabled: boolean;
  /** Original filename if a custom sound was uploaded */
  soundFileName?: string | null;
}

const DEFAULTS: SoundSettings = {
  volume: 0.5,
  soundUrl: "/intellidraw-v2.mp3",
  enabled: true,
  soundFileName: null,
};

/** In-memory cache so playCanvasSound() can be synchronous */
let cachedSettings: SoundSettings = { ...DEFAULTS };
let hasFetched = false;

/**
 * Fetch sound settings from the server and cache locally.
 * Safe to call multiple times — subsequent calls refresh the cache.
 */
export async function fetchSoundSettings(): Promise<SoundSettings> {
  try {
    const data = await apiGetSoundConfig();
    cachedSettings = {
      volume: data.volume ?? DEFAULTS.volume,
      soundUrl: data.soundUrl ?? DEFAULTS.soundUrl,
      enabled: data.enabled ?? DEFAULTS.enabled,
      soundFileName: data.soundFileName ?? null,
    };
    hasFetched = true;
  } catch {
    // Use defaults on failure
  }
  return cachedSettings;
}

/**
 * Synchronous getter — returns the cached settings.
 * If the cache hasn't been populated yet, returns defaults.
 */
export function getSoundSettings(): SoundSettings {
  return cachedSettings;
}

/**
 * Whether we've successfully fetched from the server at least once.
 */
export function hasFetchedSoundSettings(): boolean {
  return hasFetched;
}
