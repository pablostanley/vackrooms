import type { GameSettings } from "./settings";

export type RenderQuality = "auto" | "high" | "balanced" | "low";
export type RenderSettings = Pick<GameSettings, "quality" | "contactShadows" | "tapeEffects">;

/** Pixel budgets change rendering only; world generation and simulation stay intact. */
export function qualityProfile(quality: RenderQuality) {
  if (quality === "high") return { maxPixels: 3840 * 2160, maxDpr: 2 };
  if (quality === "low") return { maxPixels: 1280 * 720, maxDpr: 1 };
  return { maxPixels: 1920 * 1080, maxDpr: 1.25 };
}

export function contactShadowsEnabled(settings: RenderSettings) {
  return settings.contactShadows && settings.quality !== "low";
}
