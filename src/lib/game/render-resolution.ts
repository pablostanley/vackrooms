import { qualityProfile, type RenderQuality } from "./render-quality";
const SCALES = [1, 0.85, 0.7, 0.5, 0.35] as const;

/** Bound GPU fill work independently of the native-resolution HTML HUD. */
export class RenderResolution {
  private level = 0;
  private warmup = 1000;
  private duration = 0;
  private frames = 0;
  private stalledFrames = 0;

  constructor(private quality: RenderQuality = "auto") {}

  setQuality(quality: RenderQuality) {
    if (this.quality === quality) return false;
    this.quality = quality;
    this.level = 0;
    this.resetSampling();
    return true;
  }

  pixelRatio(width: number, height: number, devicePixelRatio: number) {
    const profile = qualityProfile(this.quality);
    const native = Math.min(devicePixelRatio || 1, profile.maxDpr);
    const budget = Math.sqrt(profile.maxPixels / Math.max(1, width * height));
    return Math.min(native, budget) * SCALES[this.level];
  }

  resetSampling() {
    this.warmup = 1000;
    this.duration = 0;
    this.frames = 0;
    this.stalledFrames = 0;
  }

  recordFrame(milliseconds: number, playing: boolean) {
    if (this.quality !== "auto") return false;
    // Paused previews intentionally run at 30 Hz. Ignore tab switches, initial
    // compilation, and resize gaps; use raw intervals, not the physics dt cap.
    if (
      !playing ||
      !Number.isFinite(milliseconds) ||
      milliseconds <= 0
    ) {
      this.resetSampling();
      return false;
    }
    if (milliseconds > 250) {
      const stalled = this.stalledFrames + 1;
      this.resetSampling();
      this.stalledFrames = stalled;
      // An isolated gap is not evidence, but sustained sub-4-fps rendering
      // must still be able to recover on a device overwhelmed by the high tier.
      if (stalled < 3 || this.level === SCALES.length - 1) return false;
      this.level++;
      this.resetSampling();
      return true;
    }
    this.stalledFrames = 0;
    if (this.warmup > 0) {
      this.warmup -= milliseconds;
      return false;
    }
    if (this.level === SCALES.length - 1) return false;
    this.duration += milliseconds;
    this.frames++;
    if (this.duration < 2000) return false;
    const slow = (this.frames * 1000) / this.duration < 50;
    this.duration = 0;
    this.frames = 0;
    if (!slow) return false;
    this.level++;
    // Keep the lower budget for this session instead of bouncing between sizes.
    this.resetSampling();
    return true;
  }
}
