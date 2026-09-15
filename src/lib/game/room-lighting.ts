import * as THREE from "three";
import {
  CELL,
  CHUNK,
  SPAN,
  directions,
  inLandmark,
  random,
  type ChunkData,
} from "./maze";

export interface RoomLighting {
  cells: Set<number>;
  mode: "fluorescent" | "lamp" | "dark";
  fixtures: Set<number>;
  lampCell: number | null;
}

/** Small connected outages leave the large rooms and opening route bright. */
export function planRoomLighting(data: ChunkData): RoomLighting {
  const rng = random(data.seed + 57163);
  const plan: RoomLighting = {
    cells: new Set(),
    mode: "dark",
    fixtures: new Set(),
    lampCell: null,
  };
  if (rng() > 0.86) return plan;
  const eligible = (at: number) => {
    const x = at % CHUNK,
      z = Math.floor(at / CHUNK);
    return (
      x > 0 &&
      z > 0 &&
      x < CHUNK - 1 &&
      z < CHUNK - 1 &&
      !inLandmark(data.landmark, x, z) &&
      !(data.x === 0 && data.z === 0 && x <= 3 && z <= 4)
    );
  };
  const candidates = Array.from({ length: CHUNK * CHUNK }, (_, at) => at)
    .filter(eligible)
    .map((at) => ({ at, order: rng() }))
    .sort((a, b) => a.order - b.order);
  const limit = 4 + Math.floor(rng() * 5);
  for (const { at } of candidates) {
    const queue = [at];
    const seen = new Set(queue);
    for (let i = 0; i < queue.length && i < limit; i++) {
      const cell = queue[i];
      for (const { bit, dx, dz } of directions) {
        const next = cell + dx + dz * CHUNK;
        if (data.cells[cell] & bit && eligible(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (queue.length < 4) continue;
    plan.cells = new Set(queue.slice(0, limit));
    break;
  }
  // Sometimes the outage follows the long hallway itself. Keep bright stretches
  // at both ends, including section gates, so the gradual spill frames the run.
  const hallwayRng = random(data.seed + 57329);
  if (data.landmark.kind === "corridor" && hallwayRng() < 0.35) {
    const length = 4 + Math.floor(hallwayRng() * 3);
    const first = data.x === 0 && data.z === 0 ? 4 : 1;
    const start = first + Math.floor(hallwayRng() * (CHUNK - length - first));
    plan.cells = new Set(
      Array.from({ length }, (_, i) => data.landmark.z * CHUNK + start + i),
    );
  }
  if (!plan.cells.size) return plan;
  const roll = rng();
  plan.mode = roll < 0.45 ? "fluorescent" : roll < 0.75 ? "lamp" : "dark";
  const cells = [...plan.cells];
  const source = cells[Math.floor(rng() * cells.length)];
  if (plan.mode === "lamp") plan.lampCell = source;
  if (plan.mode === "fluorescent") {
    plan.fixtures.add(source);
    if (rng() < 0.35)
      plan.fixtures.add(cells[(cells.indexOf(source) + 2) % cells.length]);
  }
  return plan;
}

/** Bake a smooth falloff along open paths, including bends and later cells. */
export function createRoomAmbientSampler(data: ChunkData, plan: RoomLighting) {
  const subdivisions = 12;
  const size = CHUNK * subdivisions;
  const step = CELL / subdivisions;
  const unit = step / 10;
  const distances = new Float32Array(size * size).fill(Infinity);
  const dark: number[] = [];
  const cellAt = (x: number, z: number) =>
    Math.floor(z / subdivisions) * CHUNK + Math.floor(x / subdivisions);
  const inside = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < size && z < size;
  const openEdge = (ax: number, az: number, bx: number, bz: number) => {
    const a = cellAt(ax, az),
      b = cellAt(bx, bz);
    if (a === b) return true;
    const direction = directions.find(
      ({ dx, dz }) => b - a === dx + dz * CHUNK,
    )!;
    return (
      !!(data.cells[a] & direction.bit) &&
      !!(data.cells[b] & direction.opposite)
    );
  };
  const connected = (ax: number, az: number, bx: number, bz: number) => {
    if (!inside(bx, bz)) return false;
    if (ax === bx || az === bz) return openEdge(ax, az, bx, bz);
    // Both routes around a corner must be open; never cut diagonally through walls.
    return (
      openEdge(ax, az, bx, az) &&
      openEdge(ax, az, ax, bz) &&
      openEdge(bx, az, bx, bz) &&
      openEdge(ax, bz, bx, bz)
    );
  };
  const offsets = [
    [-1, 0, 10],
    [1, 0, 10],
    [0, -1, 10],
    [0, 1, 10],
    [-1, -1, 14],
    [1, -1, 14],
    [-1, 1, 14],
    [1, 1, 14],
  ];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const at = z * size + x;
      if (plan.cells.has(cellAt(x, z))) dark.push(at);
      else distances[at] = 0;
    }
  // Integer distance buckets keep the bounded, eight-cell bake inexpensive.
  const buckets: number[][] = Array.from(
    { length: Math.ceil(24 / unit) },
    () => [],
  );
  const offer = (at: number, distance: number) => {
    if (distance >= distances[at] || distance >= buckets.length) return;
    distances[at] = distance;
    buckets[distance].push(at);
  };
  for (const at of dark) {
    const x = at % size,
      z = Math.floor(at / size);
    for (const [dx, dz, cost] of offsets) {
      const nx = x + dx,
        nz = z + dz;
      if (connected(x, z, nx, nz) && !plan.cells.has(cellAt(nx, nz)))
        offer(at, cost / 2);
    }
  }
  const bounce = (cell: number, distance: number) => {
    const x = (cell % CHUNK) * subdivisions + subdivisions / 2;
    const z = Math.floor(cell / CHUNK) * subdivisions + subdivisions / 2;
    offer(z * size + x, Math.round(distance / unit));
  };
  // Dim indirect fill from the remaining lights lifts walls and ceilings above
  // black. Their actual shadowed spotlights still provide the direct light.
  for (const cell of plan.fixtures) bounce(cell, 6.2);
  if (plan.lampCell !== null) bounce(plan.lampCell, 8);
  for (let distance = 0; distance < buckets.length; distance++)
    for (const at of buckets[distance]) {
      if (distances[at] !== distance) continue;
      const x = at % size,
        z = Math.floor(at / size);
      for (const [dx, dz, cost] of offsets) {
        const nx = x + dx,
          nz = z + dz;
        if (connected(x, z, nx, nz)) offer(nz * size + nx, distance + cost);
      }
    }
  const ambient = distances.map(
    (distance) => 0.025 + 0.975 * Math.exp(-0.5 * ((distance * unit) / 4) ** 2),
  );
  return (x: number, z: number) => {
    const gx = THREE.MathUtils.clamp(x / step, 0, size - 0.0001);
    const gz = THREE.MathUtils.clamp(z / step, 0, size - 0.0001);
    const cx = Math.floor(gx),
      cz = Math.floor(gz);
    const x0 = Math.floor(gx - 0.5),
      z0 = Math.floor(gz - 0.5);
    const tx = gx - 0.5 - x0,
      tz = gz - 0.5 - z0;
    const read = (px: number, pz: number) =>
      connected(cx, cz, px, pz)
        ? ambient[pz * size + px]
        : ambient[cz * size + cx];
    // Interpolate across open edges, with no texture sampling through a partition.
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(read(x0, z0), read(x0 + 1, z0), tx),
      THREE.MathUtils.lerp(read(x0, z0 + 1), read(x0 + 1, z0 + 1), tx),
      tz,
    );
  };
}

/** A section-owned ambient mask, shared by its material batches on both renderers. */
export function createRoomAmbientMap(data: ChunkData, plan: RoomLighting) {
  // Texels narrower than the wall thickness keep filtering from bleeding the
  // bright side of a partition onto its dark face.
  const texelsPerCell = 48;
  const size = CHUNK * texelsPerCell;
  const sample = createRoomAmbientSampler(data, plan);
  const pixels = new Uint8Array(size * size * 4).fill(255);
  // Most of the section is unchanged. Sample only the few affected cells.
  for (const cell of plan.cells) {
    const x0 = (cell % CHUNK) * texelsPerCell;
    const z0 = Math.floor(cell / CHUNK) * texelsPerCell;
    for (let z = z0; z < z0 + texelsPerCell; z++)
      for (let x = x0; x < x0 + texelsPerCell; x++) {
        const value = Math.round(
          sample(((x + 0.5) / size) * SPAN, ((z + 0.5) / size) * SPAN) * 255,
        );
        const at = (z * size + x) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = value;
      }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.channel = 1;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
