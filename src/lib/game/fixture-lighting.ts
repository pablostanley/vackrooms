import { BufferAttribute, MathUtils, type BufferGeometry } from "three";

/** Fade the last fixtures to zero before their cached shadow slots are reused. */
export function fixtureStrength(distance: number, nextDistance: number) {
  const edge = Math.min(16, nextDistance);
  return 1 - MathUtils.smoothstep(distance, edge * 0.65, edge);
}

/** A fixture keeps its own faint ballast fluctuation when shadow slots change. */
export function fixturePhase(x: number, z: number) {
  return Math.sin(x * 12.9898 + z * 78.233) * Math.PI;
}

type Behavior = "steady" | "stutter" | "dying" | "starter" | "buzz";

/**
 * Ceiling fixtures share a handful of channels, so each keeps one merged panel
 * batch per section. Channel 0 is the ordinary full-strength tube. The rest are
 * tired tubes and failing ballasts; fixtures on one channel fail together, but
 * they are rare and scattered enough to read as separate faults.
 */
export const FIXTURE_CHANNELS: readonly { behavior: Behavior; level: number; salt: number }[] = [
  { behavior: "steady", level: 1, salt: 0 },
  { behavior: "steady", level: 0.7, salt: 0 },
  { behavior: "steady", level: 0.46, salt: 0 },
  { behavior: "stutter", level: 1, salt: 1.7 },
  { behavior: "stutter", level: 0.86, salt: 4.3 },
  { behavior: "dying", level: 0.4, salt: 2.9 },
  { behavior: "starter", level: 0.95, salt: 6.1 },
  { behavior: "starter", level: 1, salt: 8.9 },
  { behavior: "buzz", level: 0.84, salt: 3.4 },
];

/** Most tubes stay oppressively bright; a lone light left in an outage is often failing. */
export function pickFixtureChannel(roll: number, pick: number, lonely: boolean) {
  const flickering = FIXTURE_CHANNELS.length - 3;
  if (lonely) return roll < 0.5 ? 3 + Math.floor(pick * flickering) : roll < 0.75 ? 1 : 0;
  if (roll < 0.74) return 0;
  if (roll < 0.83) return 1;
  if (roll < 0.88) return 2;
  return 3 + Math.floor(pick * flickering);
}

// A tube that has failed still glows faintly at its cathodes.
const OFF = 0.04;
const hash = (n: number, salt: number) => {
  const v = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/** Mostly steady, with short irregular bursts where the arc keeps dropping out. */
function stutter(t: number, salt: number, level: number) {
  const window = 2.8, w = Math.floor(t / window), local = t - w * window;
  // Now and then the whole tube gives up for a few seconds.
  if (hash(w, salt + 2.2) > 0.94) return OFF;
  if (hash(w, salt) < 0.5) return level;
  const start = hash(w, salt + 0.3) * (window - 0.8);
  const length = 0.12 + hash(w, salt + 0.7) * 0.6;
  if (local < start || local > start + length) return level;
  const v = hash(Math.floor(t * 14), salt + 1.1);
  return v < 0.45 ? OFF : v < 0.7 ? level * 0.4 : level;
}

/** A dim, sagging tube that occasionally surges bright before it drops away. */
function dying(t: number, salt: number, level: number) {
  const window = 1.7, w = Math.floor(t / window), local = t - w * window;
  const sag = level * (0.85 + 0.15 * Math.sin(t * 2.1 + salt * 5));
  const roll = hash(w, salt);
  const start = hash(w, salt + 0.5) * (window - 0.45);
  if (roll > 0.82 && local > start && local < start + 0.2)
    return hash(Math.floor(t * 18), salt + 0.9) < 0.6 ? 1 : OFF;
  if (roll > 0.7 && roll <= 0.82 && local > start && local < start + 0.1 + hash(w, salt + 1.3) * 0.3)
    return OFF;
  return sag;
}

/** Cuts out, sits dark, then strikes with a few stuttering flashes and holds. */
function starter(t: number, salt: number, level: number) {
  const cycle = 7, c = Math.floor(t / cycle), local = t - c * cycle;
  if (hash(c, salt) < 0.55) return level;
  const dark = 0.8 + hash(c, salt + 0.4) * 2.4;
  if (local < dark) return OFF;
  const strike = local - dark;
  if (strike < 0.9) {
    const step = Math.floor(strike * 11);
    return step > 7 || hash(step + c * 31, salt + 0.8) > 0.5 ? level : OFF;
  }
  return level;
}

/** Nervous shimmer with an occasional double blink. */
function buzz(t: number, salt: number, level: number) {
  const window = 3.3, w = Math.floor(t / window), local = t - w * window;
  if (hash(w, salt) > 0.6) {
    const at = hash(w, salt + 0.2) * (window - 0.3);
    if ((local > at && local < at + 0.07) || (local > at + 0.16 && local < at + 0.22))
      return level * 0.12;
  }
  return level * (0.92 + 0.08 * hash(Math.floor(t * 24), salt + 0.6));
}

/** Tag a panel for the shared tube batch; merging keeps its channel per vertex. */
export function markTubePanel(geometry: BufferGeometry, channel: number) {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  geometry.setAttribute("tube", new BufferAttribute(new Float32Array(count).fill(channel), 1));
}

/** Write each tube's current level into its merged batch's vertex colors. */
export function applyTubeLevels(geometry: BufferGeometry, levels: ArrayLike<number>) {
  const color = geometry.getAttribute("color") as BufferAttribute;
  const tube = geometry.getAttribute("tube");
  const values = color.array as Float32Array;
  let changed = false;
  for (let i = 0; i < tube.count; i++) {
    const level = Math.fround(levels[tube.getX(i)]);
    if (values[i * 3] === level) continue;
    values[i * 3] = values[i * 3 + 1] = values[i * 3 + 2] = level;
    changed = true;
  }
  if (changed) color.needsUpdate = true;
}

/** Current brightness multiplier for a channel. Reduced motion holds each tube steady. */
export function fixtureLevel(channel: number, time: number, still = false) {
  const { behavior, level, salt } = FIXTURE_CHANNELS[channel] ?? FIXTURE_CHANNELS[0];
  if (still || behavior === "steady") return level;
  if (behavior === "stutter") return stutter(time, salt, level);
  if (behavior === "dying") return dying(time, salt, level);
  if (behavior === "starter") return starter(time, salt, level);
  return buzz(time, salt, level);
}
