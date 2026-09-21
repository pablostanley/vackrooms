export const qualityPresets = ["auto", "high", "balanced", "low"] as const;
export type QualityPreset = typeof qualityPresets[number];

export interface GameSettings {
  volume: number;
  sensitivity: number;
  tape: number;
  reducedMotion: boolean;
  quality: QualityPreset;
  contactShadows: boolean;
  tapeEffects: boolean;
  entities: boolean;
}

export interface SavedSettings extends GameSettings {
  lastVolume: number;
}

export const SETTINGS_KEY = "vackrooms.settings.v1";
export const defaultSettings: SavedSettings = {
  volume: 0.65,
  lastVolume: 0.65,
  sensitivity: 1,
  tape: 0.65,
  reducedMotion: false,
  quality: "auto",
  contactShadows: true,
  tapeEffects: true,
  entities: true,
};

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

// Storage can be blocked or full. Preferences must never prevent playing.
export function loadSettings(
  reducedMotion: boolean,
  storage: () => Pick<Storage, "getItem"> = () => window.localStorage,
): SavedSettings {
  const defaults = { ...defaultSettings, reducedMotion };
  try {
    const saved: unknown = JSON.parse(storage().getItem(SETTINGS_KEY) ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    const value = saved as Record<string, unknown>;
    const volume = numberInRange(value.volume, defaults.volume, 0, 1);
    return {
      volume,
      lastVolume: volume > 0
        ? volume
        : numberInRange(value.lastVolume, defaults.lastVolume, 0.01, 1),
      sensitivity: numberInRange(value.sensitivity, defaults.sensitivity, 0.3, 2.5),
      tape: numberInRange(value.tape, defaults.tape, 0, 1),
      reducedMotion: typeof value.reducedMotion === "boolean"
        ? value.reducedMotion
        : defaults.reducedMotion,
      quality: qualityPresets.includes(value.quality as QualityPreset)
        ? value.quality as QualityPreset
        : defaults.quality,
      contactShadows: typeof value.contactShadows === "boolean"
        ? value.contactShadows
        : defaults.contactShadows,
      tapeEffects: typeof value.tapeEffects === "boolean"
        ? value.tapeEffects
        : defaults.tapeEffects,
      entities: typeof value.entities === "boolean"
        ? value.entities
        : defaults.entities,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(
  settings: SavedSettings,
  storage: () => Pick<Storage, "setItem"> = () => window.localStorage,
) {
  try {
    storage().setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}

export function setVolume(settings: SavedSettings, value: number): SavedSettings {
  const volume = numberInRange(value, settings.volume, 0, 1);
  return { ...settings, volume, lastVolume: volume > 0 ? volume : settings.lastVolume };
}

export function toggleMute(settings: SavedSettings): SavedSettings {
  return setVolume(settings, settings.volume > 0 ? 0 : settings.lastVolume);
}
