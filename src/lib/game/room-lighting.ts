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

/** Small connected outages leave the landmark halls and opening route bright. */
export function planRoomLighting(data: ChunkData): RoomLighting {
  const rng = random(data.seed + 57163);
  const plan: RoomLighting = {
    cells: new Set(),
    mode: "dark",
    fixtures: new Set(),
    lampCell: null,
  };
  if (rng() > 0.72) return plan;
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

/** Ambient bounce fades only through open edges; direct light still casts shadows. */
export function roomAmbient(
  data: ChunkData,
  plan: RoomLighting,
  x: number,
  z: number,
) {
  const cx = Math.min(CHUNK - 1, Math.max(0, Math.floor(x / CELL)));
  const cz = Math.min(CHUNK - 1, Math.max(0, Math.floor(z / CELL)));
  const at = cz * CHUNK + cx;
  if (!plan.cells.has(at)) return 1;
  let ambient = 0.004;
  for (const { bit, dx, dz } of directions) {
    const next = at + dx + dz * CHUNK;
    if (!(data.cells[at] & bit) || plan.cells.has(next)) continue;
    const distance =
      dx < 0
        ? x - cx * CELL
        : dx > 0
          ? (cx + 1) * CELL - x
          : dz < 0
            ? z - cz * CELL
            : (cz + 1) * CELL - z;
    ambient = Math.max(ambient, Math.exp(-distance * 1.8));
  }
  return ambient;
}

/** A section-owned ambient mask, shared by its material batches on both renderers. */
export function createRoomAmbientMap(data: ChunkData, plan: RoomLighting) {
  // Texels narrower than the wall thickness keep filtering from bleeding the
  // bright side of a partition onto its dark face.
  const size = CHUNK * 48;
  const pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const value = Math.round(
        roomAmbient(
          data,
          plan,
          ((x + 0.5) / size) * SPAN,
          ((z + 0.5) / size) * SPAN,
        ) * 255,
      );
      const at = (z * size + x) * 4;
      pixels[at] = pixels[at + 1] = pixels[at + 2] = value;
      pixels[at + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.channel = 1;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
