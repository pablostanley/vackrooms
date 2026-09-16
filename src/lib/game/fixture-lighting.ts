import { MathUtils } from "three";

/** Fade the last fixtures to zero before their cached shadow slots are reused. */
export function fixtureStrength(distance: number, nextDistance: number) {
  const edge = Math.min(16, nextDistance);
  return 1 - MathUtils.smoothstep(distance, edge * 0.65, edge);
}

/** A fixture keeps its own faint ballast fluctuation when shadow slots change. */
export function fixturePhase(x: number, z: number) {
  return Math.sin(x * 12.9898 + z * 78.233) * Math.PI;
}
