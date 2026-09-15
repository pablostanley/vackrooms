import { hash } from "./maze";

export const CRUSH_DURATION = 3.8;
export const DEATH_HOLD = 1.2;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

/** Watching stays reliable for a full opening, then permits isolated little steps. */
export function watchedSpeedLimit(age: number, grace: number) {
  const erosion = age - grace;
  if (erosion <= 0) return 0;
  if (erosion < 32) return erosion % 10 < 0.65 ? 0.22 : 0;
  if (erosion < 68) return erosion % 8 < 1.2 ? 0.42 : 0;
  if (erosion < 105) return erosion % 6 < 2.1 ? 0.7 : 0;
  // Only after several minutes does staring gradually lose the rest of its hold.
  return 0.7 + smooth((erosion - 105) / 35) * 4;
}

export function crushEnvelope(seconds: number, steady = false) {
  const squeeze = smooth((seconds - 0.35) / 1.65);
  // Two broad compression pulses per second; no white flashes or large jolts.
  const pulse = steady ? 0.5 : (1 - Math.cos(seconds * Math.PI * 4)) * 0.5;
  return {
    squeeze,
    red: smooth(seconds / 0.25) * (0.15 + squeeze * 0.18 + pulse * 0.13),
    shake: steady ? 0 : (0.15 + squeeze * 0.5) * pulse,
    blackout: smooth((seconds - 3.15) / (CRUSH_DURATION - 3.15)),
  };
}

/** Death is reproducible from a tape, but always loads a different tape number. */
export function nextLifeSeed(seed: number) {
  const next = 100000 + (hash(seed, 0x63727573, 0x687567) % 900000);
  return next === seed ? 100000 + ((next - 100000 + 1) % 900000) : next;
}
