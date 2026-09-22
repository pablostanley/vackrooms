import { interiorSeed, type GenerationVersion } from "./generation";

export const CELL = 4.8;
export const CHUNK = 12;
export const SPAN = CELL * CHUNK;
export const HEIGHT = 3.15;
export const N = 1,
  E = 2,
  S = 4,
  W = 8;
export const directions = [
  { dx: 0, dz: -1, bit: N, opposite: S },
  { dx: 1, dz: 0, bit: E, opposite: W },
  { dx: 0, dz: 1, bit: S, opposite: N },
  { dx: -1, dz: 0, bit: W, opposite: E },
];
export type Theme = "offices" | "service" | "pool" | "archive";
export type LandmarkKind =
  | "lobby"
  | "foodCourt"
  | "poolroom"
  | "corridor"
  | "levelFun"
  | "courtyard"
  | "neighborhood";
export interface Landmark {
  kind: LandmarkKind;
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  courtyard?: "ground" | "overlook";
  pool?: "colonnade";
}
export interface PoolBounds {
  x: number;
  z: number;
  width: number;
  length: number;
}
export interface ChunkData {
  x: number;
  z: number;
  cells: Uint8Array;
  theme: Theme;
  seed: number;
  landmark: Landmark;
}
const modulo = (n: number, size: number) => ((n % size) + size) % size;

/** A seeded cadence, rather than independent dice rolls with unbounded droughts. */
export function landmarkKind(x: number, z: number, seed: number): LandmarkKind {
  const kind = familiarLandmarkKind(x, z, seed);
  if (kind === "corridor" || kind === "levelFun" || kind === "courtyard")
    return kind;
  // One indoor street per 6x6 district: sporadic, and never the opening section.
  const bx = Math.floor(x / 6),
    bz = Math.floor(z / 6);
  const candidates: [number, number][] = [];
  for (let dz = 1; dz <= 4; dz++)
    for (let dx = 2; dx <= 3; dx++) {
      const cx = bx * 6 + dx,
        cz = bz * 6 + dz;
      // The ordinary kinds repeat every three sections. A street only takes a
      // slot whose twins on both sides survive, and those columns never host a
      // street themselves, so every 12-section walk keeps the familiar rooms.
      const existing = familiarLandmarkKind(cx, cz, seed);
      if (
        (existing === "lobby" ||
          existing === "foodCourt" ||
          existing === "poolroom") &&
        familiarLandmarkKind(cx - 3, cz, seed) === existing &&
        familiarLandmarkKind(cx + 3, cz, seed) === existing
      )
        candidates.push([cx, cz]);
    }
  if (!candidates.length) return kind;
  const site = candidates[hash(bx, bz, seed + 1291) % candidates.length];
  return site[0] === x && site[1] === z ? "neighborhood" : kind;
}
function familiarLandmarkKind(
  x: number,
  z: number,
  seed: number,
): LandmarkKind {
  const kind = ordinaryLandmarkKind(x, z, seed);
  if (kind === "corridor" || kind === "levelFun") return kind;
  // One courtyard per 5x5 district, separated by at least two ordinary sections.
  // Keep corridor runs and the rare party-room cadence intact.
  const bx = Math.floor(x / 5),
    bz = Math.floor(z / 5);
  const candidates: [number, number][] = [];
  for (let dz = 1; dz <= 3; dz++)
    for (let dx = 1; dx <= 3; dx++) {
      const cx = bx * 5 + dx,
        cz = bz * 5 + dz;
      const existing = ordinaryLandmarkKind(cx, cz, seed);
      if (existing !== "corridor" && existing !== "levelFun")
        candidates.push([cx, cz]);
    }
  const site = candidates[hash(bx, bz, seed + 941) % candidates.length];
  return site[0] === x && site[1] === z ? "courtyard" : kind;
}
function ordinaryLandmarkKind(
  x: number,
  z: number,
  seed: number,
): LandmarkKind {
  const phase = hash(0, 0, seed + 907);
  // Three adjacent sections share a corridor. Its two internal gates stay aligned
  // even when unseen office branches regenerate at a different depth.
  if (modulo(Math.floor(x / 3) + z + phase, 4) === 0) return "corridor";
  // One party room per 24-section band. Pick only non-corridor slots so the
  // three-section hallway runs survive, including at negative coordinates.
  const band = Math.floor(x / 24);
  const candidates = Array.from({ length: 24 }, (_, i) => band * 24 + i).filter(
    (cx) => modulo(Math.floor(cx / 3) + z + phase, 4) !== 0,
  );
  if (x === candidates[hash(band, z, seed + 1709) % candidates.length])
    return "levelFun";
  return (["lobby", "foodCourt", "poolroom"] as const)[
    modulo(x + z + phase, 3)
  ];
}
export function inLandmark(room: Landmark, x: number, z: number) {
  return (
    x >= room.x &&
    x < room.x + room.width &&
    z >= room.z &&
    z < room.z + room.length
  );
}
export function ceilingAt(data: ChunkData, x: number, z: number) {
  return inLandmark(data.landmark, x, z) ? data.landmark.height : HEIGHT;
}
export const COURTYARD_STOREY = 4.2;
/** The gallery remains at maze level; only the inaccessible patio is lower. */
export function courtyardBounds(room: Landmark) {
  if (room.kind !== "courtyard") return null;
  return {
    x: (room.x + 1) * CELL,
    z: (room.z + 1) * CELL,
    width: (room.width - 2) * CELL,
    length: (room.length - 2) * CELL,
    floorY: room.courtyard === "overlook" ? -3 * COURTYARD_STOREY : 0,
  };
}
export function poolBounds(room: Landmark): PoolBounds | null {
  if (room.kind !== "poolroom") return null;
  return {
    x: (room.x + room.width / 2) * CELL - 8,
    z: (room.z + room.length / 2) * CELL - 12.5,
    width: 16,
    length: 25,
  };
}
export function hash(x: number, z: number, seed: number): number {
  let h =
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateChunk(
  x: number,
  z: number,
  seed: number,
  depth = 0,
  generation: GenerationVersion = 1,
): ChunkData {
  // Keep global cadence, landmark selection, and shared boundary gates legacy.
  const chunkSeed = generation === 2
    ? interiorSeed(x, z, seed + depth * 7919)
    : hash(x, z, seed + depth * 7919);
  const rng = random(chunkSeed);
  const cells = new Uint8Array(CHUNK * CHUNK);
  const seen = new Set<number>([0]);
  const stack = [0];
  const connect = (a: number, b: number, bit: number, opposite: number) => {
    cells[a] |= bit;
    cells[b] |= opposite;
  };
  while (stack.length) {
    const current = stack[stack.length - 1];
    const cx = current % CHUNK;
    const cz = Math.floor(current / CHUNK);
    const options = directions.filter((d) => {
      const nx = cx + d.dx,
        nz = cz + d.dz;
      return (
        nx >= 0 &&
        nz >= 0 &&
        nx < CHUNK &&
        nz < CHUNK &&
        !seen.has(nz * CHUNK + nx)
      );
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const d = options[Math.floor(rng() * options.length)];
    const next = (cz + d.dz) * CHUNK + cx + d.dx;
    connect(current, next, d.bit, d.opposite);
    seen.add(next);
    stack.push(next);
  }
  // Open rooms within the maze: the spanning tree remains connected.
  for (let room = 0; room < 3; room++) {
    const rx = Math.floor(rng() * (CHUNK - 3)),
      rz = Math.floor(rng() * (CHUNK - 2));
    const width = 2 + Math.floor(rng() * 2),
      length = 2;
    for (let dz = 0; dz < length; dz++)
      for (let dx = 0; dx < width; dx++) {
        const at = (rz + dz) * CHUNK + rx + dx;
        if (dx < width - 1) connect(at, at + 1, E, W);
        if (dz < length - 1) connect(at, at + CHUNK, S, N);
      }
  }
  // Boundary gates depend on a shared global edge, not generation order.
  const north = 1 + (hash(x, z, seed + 31) % (CHUNK - 2));
  const south = 1 + (hash(x, z + 1, seed + 31) % (CHUNK - 2));
  const kind = landmarkKind(x, z, seed);
  const corridorRow = 6;
  const horizontalGate = (edgeX: number) =>
    landmarkKind(edgeX - 1, z, seed) === "corridor" &&
    landmarkKind(edgeX, z, seed) === "corridor"
      ? corridorRow
      : 1 + (hash(edgeX, z, seed + 73) % (CHUNK - 2));
  const west = horizontalGate(x);
  const east = horizontalGate(x + 1);
  cells[north] |= N;
  cells[(CHUNK - 1) * CHUNK + south] |= S;
  cells[west * CHUNK] |= W;
  cells[east * CHUNK + CHUNK - 1] |= E;
  if (x === 0 && z === 0) {
    for (let cz = 1; cz < 5; cz++)
      connect(cz * CHUNK + 2, (cz - 1) * CHUNK + 2, N, S);
    for (let cz = 2; cz < 5; cz++)
      connect(cz * CHUNK + 2, cz * CHUNK + 3, E, W);
    connect(3 * CHUNK + 3, 3 * CHUNK + 4, E, W);
  }
  const shape = random(hash(x, z, seed + 181));
  const landmark: Landmark =
    kind === "corridor"
      ? { kind, x: 0, z: corridorRow, width: CHUNK, length: 1, height: HEIGHT }
      : kind === "levelFun"
        ? {
            kind,
            x: 4,
            z: 2,
            width: 3,
            length: 2 + Math.floor(shape() * 2),
            height: HEIGHT,
          }
        : kind === "courtyard"
          ? {
              kind,
              x: 3,
              z: 2,
              width: 8,
              length: 9,
              courtyard: modulo(
                Math.floor(x / 5) + Math.floor(z / 5) + hash(0, 0, seed + 947),
                2,
              )
                ? "overlook"
                : "ground",
              height: 0,
            }
          : kind === "neighborhood"
            ? // A long street: house fronts occupy the two outer columns.
              { kind, x: 3, z: 1, width: 6, length: 10, height: 9.6 }
            : {
              kind,
              x: 4,
              z: 2,
              width: 7,
              length: 8 + Math.floor(shape() * 2),
              height: kind === "lobby" ? 8.4 : kind === "poolroom" ? 6.8 : 5.5,
            };
  // New-generation interiors only; the opening pool and all legacy tapes stay familiar.
  if (generation === 2 && kind === "poolroom" && (x !== 0 || z !== 0) &&
      interiorSeed(x, z, seed + 0x37c011) % 5 === 0)
    landmark.pool = "colonnade";
  if (kind === "courtyard")
    landmark.height = courtyardBounds(landmark)!.floorY + 5 * COURTYARD_STOREY;
  // Only remove walls: all original maze connections and shared gates survive.
  for (let rz = landmark.z; rz < landmark.z + landmark.length; rz++)
    for (let rx = landmark.x; rx < landmark.x + landmark.width; rx++) {
      const at = rz * CHUNK + rx;
      if (rx + 1 < landmark.x + landmark.width) connect(at, at + 1, E, W);
      if (rz + 1 < landmark.z + landmark.length) connect(at, at + CHUNK, S, N);
    }
  // Direct approaches from every boundary keep discoveries on walking routes.
  const approach = (ax: number, az: number, bx: number, bz: number) => {
    while (ax !== bx) {
      const dx = Math.sign(bx - ax),
        at = az * CHUNK + ax;
      connect(at, at + dx, dx > 0 ? E : W, dx > 0 ? W : E);
      ax += dx;
    }
    while (az !== bz) {
      const dz = Math.sign(bz - az),
        at = az * CHUNK + ax;
      connect(at, at + dz * CHUNK, dz > 0 ? S : N, dz > 0 ? N : S);
      az += dz;
    }
  };
  const rx = landmark.x,
    rz = landmark.z;
  const right = rx + landmark.width - 1,
    bottom = rz + landmark.length - 1;
  approach(north, 0, Math.max(rx, Math.min(right, north)), rz);
  approach(south, CHUNK - 1, Math.max(rx, Math.min(right, south)), bottom);
  approach(0, west, rx, Math.max(rz, Math.min(bottom, west)));
  approach(CHUNK - 1, east, right, Math.max(rz, Math.min(bottom, east)));
  if (x === 0 && z === 0) {
    if (kind === "corridor") approach(2, 4, 2, rz);
    else approach(2, 2, rx, rz);
  }
  if (kind === "levelFun" || kind === "neighborhood") {
    // Give the party room actual walls. Close only redundant perimeter edges:
    // never sever an office branch, alter a section gate, or lose the approach
    // from spawn. Two opposite entrances are always retained. The street also
    // keeps a doorway at each end, and its sealed sides become house lots.
    for (let cz = rz; cz <= bottom; cz++)
      for (let cx = rx; cx <= right; cx++)
        for (const d of directions) {
          const nx = cx + d.dx,
            nz = cz + d.dz;
          if (inLandmark(landmark, nx, nz)) continue;
          if (
            d.bit === W &&
            cz ===
              (x === 0 && z === 0 ? rz : Math.max(rz, Math.min(bottom, west)))
          )
            continue;
          if (d.bit === E && cz === Math.max(rz, Math.min(bottom, east)))
            continue;
          if (
            kind === "neighborhood" &&
            ((d.bit === N && cx === Math.max(rx, Math.min(right, north))) ||
              (d.bit === S && cx === Math.max(rx, Math.min(right, south))))
          )
            continue;
          const at = cz * CHUNK + cx,
            next = nz * CHUNK + nx;
          if (!(cells[at] & d.bit)) continue;
          cells[at] &= ~d.bit;
          cells[next] &= ~d.opposite;
          const reached = new Set([at]),
            queue = [at];
          for (const current of queue) {
            for (const step of directions) {
              const sx = (current % CHUNK) + step.dx,
                sz = Math.floor(current / CHUNK) + step.dz;
              if (
                sx < 0 ||
                sz < 0 ||
                sx >= CHUNK ||
                sz >= CHUNK ||
                !(cells[current] & step.bit)
              )
                continue;
              const neighbor = sz * CHUNK + sx;
              if (!reached.has(neighbor)) {
                reached.add(neighbor);
                queue.push(neighbor);
              }
            }
            if (reached.has(next)) break;
          }
          if (!reached.has(next)) connect(at, next, d.bit, d.opposite);
        }
  }
  const choice = rng();
  const theme: Theme =
    x === 0 && z === 0
      ? depth % 3 === 1
        ? "pool"
        : depth % 3 === 2
          ? "service"
          : "offices"
      : choice < 0.61
        ? "offices"
        : choice < 0.78
          ? "service"
          : choice < 0.91
            ? "archive"
            : "pool";
  return { x, z, cells, theme, seed: chunkSeed, landmark };
}
export function cellAt(
  chunks: Map<string, ChunkData>,
  worldX: number,
  worldZ: number,
) {
  const x = Math.floor(worldX / SPAN),
    z = Math.floor(worldZ / SPAN);
  const chunk = chunks.get(`${x},${z}`);
  if (!chunk) return null;
  const cx = Math.floor((worldX - x * SPAN) / CELL),
    cz = Math.floor((worldZ - z * SPAN) / CELL);
  return { chunk, cx, cz, bits: chunk.cells[cz * CHUNK + cx] };
}
export function canStand(
  chunks: Map<string, ChunkData>,
  x: number,
  z: number,
  radius = 0.22,
) {
  const cell = cellAt(chunks, x, z);
  if (!cell) return false;
  const basin = poolBounds(cell.chunk.landmark);
  const court = courtyardBounds(cell.chunk.landmark);
  if (court && court.floorY < 0) {
    const px = x - cell.chunk.x * SPAN,
      pz = z - cell.chunk.z * SPAN;
    const pad = radius + 0.16;
    if (
      px > court.x - pad &&
      px < court.x + court.width + pad &&
      pz > court.z - pad &&
      pz < court.z + court.length + pad
    )
      return false;
  }
  if (basin) {
    const px = x - cell.chunk.x * SPAN,
      pz = z - cell.chunk.z * SPAN;
    const coping = radius + 0.18;
    if (
      px > basin.x - coping &&
      px < basin.x + basin.width + coping &&
      pz > basin.z - coping &&
      pz < basin.z + basin.length + coping
    )
      return false;
  }
  const lx = x - (cell.chunk.x * SPAN + cell.cx * CELL),
    lz = z - (cell.chunk.z * SPAN + cell.cz * CELL);
  const pad = radius + 0.09;
  if (
    (lx < pad && !(cell.bits & W)) ||
    (lx > CELL - pad && !(cell.bits & E)) ||
    (lz < pad && !(cell.bits & N)) ||
    (lz > CELL - pad && !(cell.bits & S))
  )
    return false;
  // Circle clearance also catches the corner of a neighboring closed wall.
  for (const [dx, dz] of [
    [-radius, -radius],
    [radius, -radius],
    [-radius, radius],
    [radius, radius],
  ]) {
    const c = cellAt(chunks, x + dx, z + dz);
    if (!c) return false;
    const px = x + dx - (c.chunk.x * SPAN + c.cx * CELL),
      pz = z + dz - (c.chunk.z * SPAN + c.cz * CELL);
    if (
      (px < 0.09 && !(c.bits & W)) ||
      (px > CELL - 0.09 && !(c.bits & E)) ||
      (pz < 0.09 && !(c.bits & N)) ||
      (pz > CELL - 0.09 && !(c.bits & S))
    )
      return false;
  }
  return true;
}
