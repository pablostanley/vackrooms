import {
  CELL,
  CHUNK,
  HEIGHT,
  SPAN,
  E,
  W,
  N,
  S,
  canStand,
  ceilingAt,
  cellAt,
  directions,
  inLandmark,
  poolBounds,
  random,
  type ChunkData,
} from "./maze";

export interface SoundPosition {
  x: number;
  y: number;
  z: number;
}
export type RoomSound = "office" | "hall" | "pool" | "corridor";
export const ROOM_SOUNDS: Record<
  RoomSound,
  { decay: number; wet: number; cutoff: number }
> = {
  office: { decay: 0.3, wet: 0.07, cutoff: 1800 },
  hall: { decay: 1.05, wet: 0.17, cutoff: 3400 },
  pool: { decay: 1.85, wet: 0.23, cutoff: 4600 },
  corridor: { decay: 0.8, wet: 0.13, cutoff: 2400 },
};

export function roomSoundAt(
  chunks: Map<string, ChunkData>,
  p: SoundPosition,
): RoomSound {
  const cell = cellAt(chunks, p.x, p.z);
  if (!cell) return "office";
  if (inLandmark(cell.chunk.landmark, cell.cx, cell.cz)) {
    switch (cell.chunk.landmark.kind) {
      case "levelFun":
        return "office";
      case "poolroom":
        return "pool";
      case "corridor":
        return "corridor";
      default:
        return "hall";
    }
  }
  return "office";
}

export function hardFloorAt(chunks: Map<string, ChunkData>, p: SoundPosition) {
  const cell = cellAt(chunks, p.x, p.z);
  if (!cell || !inLandmark(cell.chunk.landmark, cell.cx, cell.cz)) return false;
  // Only these landmarks replace the base carpet with a poured floor.
  return (
    cell.chunk.landmark.kind === "poolroom" ||
    cell.chunk.landmark.kind === "foodCourt" ||
    cell.chunk.landmark.kind === "courtyard"
  );
}

export type FootstepSurface = "carpet" | "hard" | "water";
// Match the recessed water plane and the 0.36m coping in landmarks.ts.
export const POOL_WATER_Y = -0.18;

/** The position is at the feet, so standing on the rim never splashes. */
export function footstepSurfaceAt(
  chunks: Map<string, ChunkData>,
  feet: SoundPosition,
): FootstepSurface {
  const cell = cellAt(chunks, feet.x, feet.z);
  const basin = cell && poolBounds(cell.chunk.landmark);
  if (cell && basin && feet.y <= POOL_WATER_Y) {
    const x = feet.x - cell.chunk.x * SPAN,
      z = feet.z - cell.chunk.z * SPAN;
    if (
      x > basin.x + 0.18 && x < basin.x + basin.width - 0.18 &&
      z > basin.z + 0.18 && z < basin.z + basin.length - 0.18
    ) return "water";
  }
  return hardFloorAt(chunks, feet) ? "hard" : "carpet";
}

/** Trace actual cell boundaries, including negative coordinates and streamed seams.
 * Stop after three partitions: anything farther through walls is effectively silent.
 * Ceiling-height changes also have solid headers above ordinary office doorways.
 */
export function wallsBetween(
  chunks: Map<string, ChunkData>,
  from: SoundPosition,
  to: SoundPosition,
) {
  let x = Math.floor(from.x / CELL),
    z = Math.floor(from.z / CELL),
    walls = 0;
  const tx = Math.floor(to.x / CELL),
    tz = Math.floor(to.z / CELL);
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const sx = Math.sign(dx),
    sz = Math.sign(dz);
  const strideX = dx ? CELL / Math.abs(dx) : Infinity;
  const strideZ = dz ? CELL / Math.abs(dz) : Infinity;
  let nextX = dx ? ((x + (sx > 0 ? 1 : 0)) * CELL - from.x) / dx : Infinity;
  let nextZ = dz ? ((z + (sz > 0 ? 1 : 0)) * CELL - from.z) / dz : Infinity;
  const at = (cx: number, cz: number) =>
    cellAt(chunks, (cx + 0.5) * CELL, (cz + 0.5) * CELL);
  let cell = at(x, z);
  if (!cell || !at(tx, tz)) return 3;
  const blocked = (
    a: NonNullable<typeof cell>,
    b: NonNullable<typeof cell>,
    bit: number,
    opposite: number,
    t: number,
  ) => {
    const height = ceilingAt(a.chunk, a.cx, a.cz);
    const nextHeight = ceilingAt(b.chunk, b.cx, b.cz);
    const header =
      height !== nextHeight && from.y + (to.y - from.y) * t > HEIGHT;
    return Number(!(a.bits & bit) || !(b.bits & opposite) || header);
  };
  for (let i = 0; (x !== tx || z !== tz) && i < 64; i++) {
    // At an exact corner, either pair of adjoining walls can block the ray.
    // Checking both makes transmission reciprocal and prevents corner sound leaks.
    if (x !== tx && z !== tz && Math.abs(nextX - nextZ) < 1e-9) {
      const acrossX = at(x + sx, z),
        acrossZ = at(x, z + sz),
        diagonal = at(x + sx, z + sz);
      if (!acrossX || !acrossZ || !diagonal) return 3;
      const xb = sx > 0 ? E : W,
        xo = sx > 0 ? W : E;
      const zb = sz > 0 ? S : N,
        zo = sz > 0 ? N : S;
      walls += Math.max(
        blocked(cell, acrossX, xb, xo, nextX) +
          blocked(acrossX, diagonal, zb, zo, nextX),
        blocked(cell, acrossZ, zb, zo, nextZ) +
          blocked(acrossZ, diagonal, xb, xo, nextZ),
      );
      if (walls >= 3) return 3;
      x += sx;
      z += sz;
      nextX += strideX;
      nextZ += strideZ;
      cell = diagonal;
      continue;
    }
    const crossX = x !== tx && (z === tz || nextX < nextZ);
    const t = crossX ? nextX : nextZ;
    const bit = crossX ? (sx > 0 ? E : W) : sz > 0 ? S : N;
    const opposite = crossX ? (sx > 0 ? W : E) : sz > 0 ? N : S;
    if (crossX) {
      x += sx;
      nextX += strideX;
    } else {
      z += sz;
      nextZ += strideZ;
    }
    const next = at(x, z);
    if (!next) return 3;
    walls += blocked(cell, next, bit, opposite, t);
    if (walls >= 3) return 3;
    cell = next;
  }
  return x === tx && z === tz ? walls : 3;
}

export function transmission(walls: number, distance: number) {
  const index = Math.max(0, Math.min(3, Math.floor(walls)));
  return {
    gain: [1, 0.36, 0.12, 0.025][index],
    cutoff: Math.max(
      180,
      [7200, 1100, 480, 240][index] / (1 + distance * 0.035),
    ),
  };
}

export interface BuildingSound {
  kind: "steps" | "duct" | "settle";
  positions: SoundPosition[];
  interval: number;
}

/** Independent from synthesis randomness and wall-clock time. Pausing cannot catch up events. */
export class BuildingSoundSchedule {
  private rng: () => number;
  private next: number;
  constructor(seed: number) {
    this.rng = random(seed ^ 0x41c6ce57);
    this.next = 40 + this.rng() * 36;
  }
  defer(time: number) {
    this.next = time + 52 + this.rng() * 52;
  }
  poll(
    time: number,
    chunks: Map<string, ChunkData>,
    listener: SoundPosition,
  ): BuildingSound | null {
    if (time < this.next) return null;
    this.defer(time);
    // Silence is intentional; no forced cue if the architecture has no suitable source.
    if (this.rng() < 0.22) return null;
    const candidates: SoundPosition[] = [];
    for (const chunk of chunks.values())
      for (let cz = 0; cz < CHUNK; cz++)
        for (let cx = 0; cx < CHUNK; cx++) {
          const p = {
            x: chunk.x * SPAN + (cx + 0.5) * CELL,
            y: 0.12,
            z: chunk.z * SPAN + (cz + 0.5) * CELL,
          };
          const distance = Math.hypot(p.x - listener.x, p.z - listener.z);
          if (
            distance < 9 ||
            distance > 24 ||
            !canStand(chunks, p.x, p.z, 0.25)
          )
            continue;
          const walls = wallsBetween(chunks, listener, p);
          if (walls === 1 || walls === 2) candidates.push(p);
        }
    // Map insertion order changes after streaming; source selection must not depend on it.
    candidates.sort((a, b) => a.x - b.x || a.z - b.z);
    if (!candidates.length) return null;
    const origin = candidates[Math.floor(this.rng() * candidates.length)];
    const choice = this.rng();
    const kind = choice < 0.58 ? "steps" : choice < 0.86 ? "duct" : "settle";
    const positions = [origin];
    if (kind === "steps") {
      const cell = cellAt(chunks, origin.x, origin.z)!;
      const routes = directions.filter((d) => {
        if (!(cell.bits & d.bit)) return false;
        for (let step = 1; step <= 4; step++) {
          const p = {
            x: origin.x + d.dx * step * 0.8,
            y: origin.y,
            z: origin.z + d.dz * step * 0.8,
          };
          if (
            !canStand(chunks, p.x, p.z, 0.25) ||
            wallsBetween(chunks, origin, p)
          )
            return false;
        }
        return true;
      });
      if (!routes.length) return null;
      const route = routes[Math.floor(this.rng() * routes.length)];
      const count = 3 + Math.floor(this.rng() * 3);
      for (let i = 1; i < count; i++)
        positions.push({
          x: origin.x + route.dx * i * 0.8,
          y: origin.y,
          z: origin.z + route.dz * i * 0.8,
        });
    }
    return { kind, positions, interval: 0.65 + this.rng() * 0.22 };
  }
}
