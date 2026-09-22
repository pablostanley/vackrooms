import { random } from "./maze";
import type { SoundPosition } from "./acoustics";

export type PropMaterial = "wood" | "metal" | "plastic" | "cardboard";
export type PropSoundKind = "scrape" | "impact";
export interface PropSound {
  kind: PropSoundKind;
  material: PropMaterial;
  position: SoundPosition;
  strength: number;
}

/** Per-body debounce: one contact can span many legs, manifolds, and substeps. */
export class PropSoundGate {
  private impactWait = 0.4;
  private scrapeWait = 0.4;
  sample(dt: number, speed: number, impulse: number, supported: boolean) {
    this.impactWait = Math.max(0, this.impactWait - dt);
    this.scrapeWait = Math.max(0, this.scrapeWait - dt);
    if (impulse > 0.32 && this.impactWait === 0) {
      this.impactWait = 0.22;
      this.scrapeWait = 0.16;
      return { kind: "impact" as const, strength: Math.min(1, impulse / 2.5) };
    }
    if (supported && speed > 0.16 && this.scrapeWait === 0) {
      this.scrapeWait = 0.18;
      return { kind: "scrape" as const, strength: Math.min(1, speed / 2) };
    }
    return null;
  }
}

/** Short, padded, deterministic foley; no asset download or sharp click at either end. */
export function propSoundSamples(kind: PropSoundKind, material: PropMaterial, sampleRate: number) {
  const materials: PropMaterial[] = ["wood", "metal", "plastic", "cardboard"];
  const index = materials.indexOf(material);
  const rng = random(73013 + index * 97 + (kind === "scrape" ? 1 : 0));
  const duration = kind === "scrape" ? 0.24 : 0.22;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const frequency = [115, 205, 155, 82][index];
  const cutoff = kind === "scrape" ? 850 : 1500;
  const blend = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
  let noise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, progress = i / (samples.length - 1);
    noise += ((rng() * 2 - 1) - noise) * blend;
    const envelope = kind === "scrape"
      ? Math.sin(Math.PI * progress) ** 2
      : Math.min(1, t / 0.004) * Math.exp(-t * 25) * (1 - progress);
    const body = kind === "scrape" ? 0 : Math.sin(2 * Math.PI * frequency * t) * 0.42;
    const ring = kind === "impact" && material === "metal"
      ? Math.sin(2 * Math.PI * 730 * t) * 0.09 : 0;
    samples[i] = envelope * (noise * (kind === "scrape" ? 0.7 : 0.3) + body + ring);
  }
  return samples;
}
