import { CELL, CHUNK, HEIGHT, N, E, S, W, directions } from "./grid";
import { inLandmark, random, type ChunkData, type Landmark } from "./maze";
import { interiorSeed } from "./generation";

/** A wall across one corner of a cell, from `a` meters along its north/south
 * wall to `b` meters along its west/east wall. Corners: 0 NW, 1 NE, 2 SE, 3 SW. */
export interface CornerCut {
  cell: number;
  corner: 0 | 1 | 2 | 3;
  a: number;
  b: number;
}
/** A flight that climbs along a closed wall to a sealed door. */
export interface StairRun {
  cell: number;
  wall: number;
  /** +1 climbs toward the wall's east/south end, -1 toward west/north. */
  dir: 1 | -1;
  steps: number;
  rise: number;
}

/** An inflatable play area: bouncy floor, puffed walls, arches, and balls. */
export interface Playroom {
  cells: number[];
  /** Offset into the vinyl palette, so neighboring play areas differ. */
  palette: number;
}

/** Corner walls sit on the room faces of the two walls they join. */
export const CUT_INSET = 0.09;
export const STAIR_TREAD = 0.3;
export const STAIR_WIDTH = 1.1;
export const STAIR_LANDING = 0.8;
export const STAIR_START = 0.3;
const corners = [
  { sx: 1, sz: 1, x: N, z: W },
  { sx: -1, sz: 1, x: N, z: E },
  { sx: -1, sz: -1, x: S, z: E },
  { sx: 1, sz: -1, x: S, z: W },
] as const;

/** Cell-local coordinates measured from a cut's corner, toward the room. */
export function cornerLocal(cut: CornerCut, lx: number, lz: number) {
  const { sx, sz } = corners[cut.corner];
  return {
    u: (sx > 0 ? lx : CELL - lx) - CUT_INSET,
    v: (sz > 0 ? lz : CELL - lz) - CUT_INSET,
  };
}
/** Signed distance from the cut's wall face; positive on the walkable side. */
export function cutClearance(cut: CornerCut, lx: number, lz: number) {
  const { u, v } = cornerLocal(cut, lx, lz);
  return ((u / cut.a + v / cut.b - 1) * cut.a * cut.b) / Math.hypot(cut.a, cut.b);
}
/** The wall's two ends in cell-local meters, and its room-facing normal. */
export function cutSegment(cut: CornerCut) {
  const { sx, sz } = corners[cut.corner];
  const cx = sx > 0 ? CUT_INSET : CELL - CUT_INSET,
    cz = sz > 0 ? CUT_INSET : CELL - CUT_INSET;
  const length = Math.hypot(cut.a, cut.b);
  return {
    corner: [cx, cz] as const,
    from: [cx + sx * cut.a, cz] as const,
    to: [cx, cz + sz * cut.b] as const,
    normal: [(sx * cut.b) / length, (sz * cut.a) / length] as const,
    length,
  };
}

const near = (room: Landmark, x: number, z: number) =>
  x >= room.x - 1 && x <= room.x + room.width &&
  z >= room.z - 1 && z <= room.z + room.length;

/** L, T, and cross footprints (cells as [dx, dz]) joined into one open room. */
const compoundRooms: [number, number][][] = [
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [2, 2], [1, 2]],
];

/** Generation 2 only: join a few irregular open rooms. Only removes walls, so
 * every maze branch, section gate, and landmark approach survives. */
export function openCompoundRooms(
  cells: Uint8Array,
  x: number,
  z: number,
  seed: number,
  landmark: Landmark,
) {
  const rng = random(interiorSeed(x, z, seed + 0x524f4f4d));
  const count = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const shape = compoundRooms[Math.floor(rng() * compoundRooms.length)];
    const flipX = rng() < 0.5, flipZ = rng() < 0.5;
    const ox = Math.floor(rng() * (CHUNK - 2)), oz = Math.floor(rng() * (CHUNK - 2));
    const footprint = shape.map(([dx, dz]) => [ox + (flipX ? 2 - dx : dx), oz + (flipZ ? 2 - dz : dz)]);
    if (footprint.some(([cx, cz]) =>
      near(landmark, cx, cz) || (x === 0 && z === 0 && cx <= 4 && cz <= 5)))
      continue;
    const inside = new Set(footprint.map(([cx, cz]) => cz * CHUNK + cx));
    for (const at of inside) {
      if (inside.has(at + 1) && at % CHUNK < CHUNK - 1) {
        cells[at] |= E;
        cells[at + 1] |= W;
      }
      if (inside.has(at + CHUNK)) {
        cells[at] |= S;
        cells[at + CHUNK] |= N;
      }
    }
  }
}

/** Rectangles (cell-local) that must stay walkable around authored shapes. */
function passages(bits: number) {
  const c = CELL / 2, core = 0.95, lane = 0.8;
  const rects: [number, number, number, number][] = [[c - core, c - core, c + core, c + core]];
  if (bits & N) rects.push([c - lane, 0, c + lane, c]);
  if (bits & S) rects.push([c - lane, c, c + lane, CELL]);
  if (bits & W) rects.push([0, c - lane, c, c + lane]);
  if (bits & E) rects.push([c, c - lane, CELL, c + lane]);
  return rects;
}
function cutClears(cut: CornerCut, bits: number) {
  // The triangle lies in the corner quadrant: it meets a rectangle only if the
  // rectangle's point nearest the corner lies inside it.
  return passages(bits).every(([x0, z0, x1, z1]) => {
    const points = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([px, pz]) => cornerLocal(cut, px, pz));
    const u = Math.max(0, Math.min(...points.map((p) => p.u))),
      v = Math.max(0, Math.min(...points.map((p) => p.v)));
    return u / cut.a + v / cut.b >= 1;
  });
}

/** Generation 2 only: ceiling heights, angled corners, and impossible stairs.
 * Planned from their own stream so connectivity and furnishing seeds stay put. */
export function planRoomShapes(data: ChunkData, seed: number, depth: number) {
  const rng = random(interiorSeed(data.x, data.z, seed + depth * 7919 + 0x5348));
  const origin = data.x === 0 && data.z === 0;
  const spawnArea = (cx: number, cz: number) => origin && cx <= 4 && cz <= 5;
  const ceilings = new Float64Array(CHUNK * CHUNK).fill(HEIGHT);
  // Section borders stay standard: each wall there is built by one section only.
  const tunable = (cx: number, cz: number) =>
    cx > 0 && cz > 0 && cx < CHUNK - 1 && cz < CHUNK - 1 &&
    !near(data.landmark, cx, cz) && !spawnArea(cx, cz);
  const zones = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < zones; i++) {
    const roll = rng();
    const [min, max, span, height] =
      roll < 0.34 ? [1, 3, 0, 2.45 + rng() * 0.3]
        : roll < 0.64 ? [1, 3, 0, 4.2 + rng() * 1.2]
          : roll < 0.84 ? [2, 3, 0, 6.2 + rng() * 1.4]
            : [1, 1, 1, 10.5 + rng() * 5.5];
    const w = span || min + Math.floor(rng() * (max - min + 1)),
      l = span || min + Math.floor(rng() * (max - min + 1));
    const zx = 1 + Math.floor(rng() * (CHUNK - 1 - w)),
      zz = 1 + Math.floor(rng() * (CHUNK - 1 - l));
    for (let cz = zz; cz < zz + l; cz++)
      for (let cx = zx; cx < zx + w; cx++)
        if (tunable(cx, cz)) ceilings[cz * CHUNK + cx] = Math.round(height * 20) / 20;
  }
  // Now and then a stretch of office has been handed over to a bouncy castle.
  let playroom: Playroom | undefined;
  if (!origin && rng() < 0.22) {
    const limit = 3 + Math.floor(rng() * 4);
    let cells: number[] = [];
    for (let attempt = 0; attempt < 6 && cells.length < 3; attempt++) {
      const start = 1 + Math.floor(rng() * (CHUNK - 2)) + (1 + Math.floor(rng() * (CHUNK - 2))) * CHUNK;
      if (!tunable(start % CHUNK, Math.floor(start / CHUNK))) continue;
      cells = [start];
      for (let i = 0; i < cells.length && cells.length < limit; i++)
        for (const { bit, dx, dz } of directions) {
          const nx = (cells[i] % CHUNK) + dx, nz = Math.floor(cells[i] / CHUNK) + dz;
          const next = nz * CHUNK + nx;
          if (cells.length < limit && data.cells[cells[i]] & bit && tunable(nx, nz) && !cells.includes(next))
            cells.push(next);
        }
    }
    if (cells.length >= 3) {
      // Headroom for bouncing, under the same office ceiling tiles.
      const height = Math.round((4.8 + rng() * 0.6) * 20) / 20;
      for (const cell of cells) ceilings[cell] = height;
      playroom = { cells, palette: Math.floor(rng() * 5) };
    }
  }
  const play = new Set(playroom?.cells);
  // Some sections are barely touched; others turn every corner.
  const angularity = rng() < 0.25 ? 0.08 : 0.25 + rng() * 0.4;
  const cuts: CornerCut[] = [];
  // Landmarks dress their own perimeters; the opening route stays familiar.
  const shaped = (cx: number, cz: number) =>
    inLandmark(data.landmark, cx, cz) || (origin && cx >= 1 && cx <= 3 && cz <= 5);
  for (let cz = 0; cz < CHUNK; cz++)
    for (let cx = 0; cx < CHUNK; cx++) {
      if (shaped(cx, cz) || play.has(cz * CHUNK + cx)) continue;
      const cell = cz * CHUNK + cx, bits = data.cells[cell];
      const used = { [N]: 0, [S]: 0, [W]: 0, [E]: 0 } as Record<number, number>;
      for (const corner of [0, 1, 2, 3] as const) {
        const walls = corners[corner];
        if (bits & walls.x || bits & walls.z || rng() > angularity) continue;
        // Mostly chamfers; sometimes a long skew makes an odd trapezoid.
        const skew = rng() < 0.35;
        let a = 0.9 + rng() * 2.2, b = skew ? 0.6 + rng() * 0.9 : a * (0.75 + rng() * 0.5);
        if (skew) a = CELL - 0.3 - rng() * 1.2;
        if (rng() < 0.5) [a, b] = [b, a];
        for (let attempt = 0; attempt < 4; attempt++) {
          const cut: CornerCut = { cell, corner, a: Math.round(a * 100) / 100, b: Math.round(b * 100) / 100 };
          if (used[walls.x] + cut.a < CELL - 0.4 && used[walls.z] + cut.b < CELL - 0.4 && cutClears(cut, bits)) {
            cuts.push(cut);
            used[walls.x] += cut.a + CUT_INSET;
            used[walls.z] += cut.b + CUT_INSET;
            break;
          }
          a *= 0.75;
          b *= 0.75;
        }
      }
    }
  // An occasional flight in a tall room climbs to a door that opens onto a wall.
  const stairs: StairRun[] = [];
  if (rng() < 0.55) {
    const candidates: StairRun[] = [];
    for (let cell = 0; cell < CHUNK * CHUNK; cell++) {
      const cx = cell % CHUNK, cz = Math.floor(cell / CHUNK);
      if (ceilings[cell] < 4.5 || shaped(cx, cz) || play.has(cell) || cuts.some((cut) => cut.cell === cell)) continue;
      for (const wall of [N, E, S, W])
        if (!(data.cells[cell] & wall))
          candidates.push({ cell, wall, dir: rng() < 0.5 ? 1 : -1, steps: 11, rise: 11 * 0.19 });
    }
    if (candidates.length) stairs.push(candidates[Math.floor(rng() * candidates.length)]);
  }
  data.ceilings = ceilings;
  data.cuts = cuts;
  data.stairs = stairs;
  if (playroom) data.playroom = playroom;
}

/** Stair solids in cell-local meters: [x0, z0, x1, z1, top]. */
export function stairBlocks(run: StairRun) {
  const blocks: [number, number, number, number, number][] = [];
  const along = run.wall === N || run.wall === S;
  const across0 = run.wall === N || run.wall === W ? CUT_INSET : CELL - CUT_INSET - STAIR_WIDTH;
  const step = run.rise / run.steps;
  const span = (s0: number, s1: number, top: number) => {
    const a0 = run.dir > 0 ? s0 : CELL - s1, a1 = run.dir > 0 ? s1 : CELL - s0;
    blocks.push(along
      ? [a0, across0, a1, across0 + STAIR_WIDTH, top]
      : [across0, a0, across0 + STAIR_WIDTH, a1, top]);
  };
  for (let i = 0; i < run.steps; i++)
    span(STAIR_START + i * STAIR_TREAD, STAIR_START + (i + 1) * STAIR_TREAD, (i + 1) * step);
  const end = STAIR_START + run.steps * STAIR_TREAD;
  span(end, end + STAIR_LANDING, run.rise);
  return blocks;
}
