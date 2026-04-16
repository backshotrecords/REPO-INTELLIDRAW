/**
 * Sound settings — fetched from the server (Supabase-backed global admin config).
 * Cached in memory so WorkspacePage/VoiceMicButton don't need an extra fetch on every play.
 */

import { apiGetSoundConfig } from "./api";

export interface SoundSettings {
  /** Global volume from 0 to 1 */
  volume: number;
  /** Whether sound is enabled globally */
  enabled: boolean;
  /** URL of the canvas-update notification sound */
  soundUrl: string;
  /** Original filename if a custom canvas sound was uploaded */
  soundFileName?: string | null;
  /** URL of the voice-transcription notification sound */
  voiceSoundUrl: string;
  /** Original filename if a custom voice sound was uploaded */
  voiceSoundFileName?: string | null;
}

const DEFAULTS: SoundSettings = {
  volume: 0.5,
  enabled: true,
  soundUrl: "/intellidraw-v2.mp3",
  soundFileName: null,
  voiceSoundUrl: "/intellisend_v2.mp3",
  voiceSoundFileName: null,
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
      enabled: data.enabled ?? DEFAULTS.enabled,
      soundUrl: data.soundUrl ?? DEFAULTS.soundUrl,
      soundFileName: data.soundFileName ?? null,
      voiceSoundUrl: data.voiceSoundUrl ?? DEFAULTS.voiceSoundUrl,
      voiceSoundFileName: data.voiceSoundFileName ?? null,
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
