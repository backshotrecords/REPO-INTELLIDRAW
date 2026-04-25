import { apiGetCanvasConfig } from "./api";

export interface CanvasSettings {
  /** Maximum zoom level multiplier (e.g. 16 means 1600%) */
  maxZoomLevel: number;
}

const DEFAULTS: CanvasSettings = {
  maxZoomLevel: 16,
};

let cachedSettings: CanvasSettings = { ...DEFAULTS };
let hasFetched = false;

export async function fetchCanvasSettings(): Promise<CanvasSettings> {
  try {
    const data = await apiGetCanvasConfig();
    cachedSettings = {
      maxZoomLevel: data.maxZoomLevel ?? DEFAULTS.maxZoomLevel,
    };
    hasFetched = true;
  } catch {
    // Use defaults on failure
  }
  return cachedSettings;
}

export function getCanvasSettings(): CanvasSettings {
  return cachedSettings;
}

export function hasFetchedCanvasSettings(): boolean {
  return hasFetched;
}
