export const CELL = 4.8;
export const CHUNK = 6;
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
export interface ChunkData {
  x: number;
  z: number;
  cells: Uint8Array;
  theme: Theme;
  seed: number;
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
): ChunkData {
  const chunkSeed = hash(x, z, seed + depth * 7919);
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
    const rx = Math.floor(rng() * 4),
      rz = Math.floor(rng() * 4);
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
  const west = 1 + (hash(x, z, seed + 73) % (CHUNK - 2));
  const east = 1 + (hash(x + 1, z, seed + 73) % (CHUNK - 2));
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
  return { x, z, cells, theme, seed: chunkSeed };
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
