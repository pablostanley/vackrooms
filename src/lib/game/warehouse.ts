import * as THREE from "three";
import { CELL, CHUNK, N, E, S, W, hash, inLandmark, type ChunkData } from "./maze";
import type { LandmarkBuilder } from "./landmarks";
import type { Materials } from "./materials";

/** An original loading annex inspired by Level 1's columns, pipes and supplies. */
export function buildWarehouse(data: ChunkData, mats: Materials, b: LandmarkBuilder) {
  const room = data.landmark;
  const x0 = room.x * CELL, z0 = room.z * CELL;
  const width = room.width * CELL, length = room.length * CELL;
  const ox = data.x * CHUNK * CELL, oz = data.z * CHUNK * CELL;
  const solid = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    b.box(w, h, d, x, y, z, mat);
    b.colliders.push(new THREE.Box3(
      new THREE.Vector3(ox + x - w / 2, y - h / 2, oz + z - d / 2),
      new THREE.Vector3(ox + x + w / 2, y + h / 2, oz + z + d / 2),
    ));
  };
  b.plane(width, length, x0 + width / 2, 0.012, z0 + length / 2, mats.cream, -Math.PI / 2);
  // Columns sit at cell corners, preserving the center-to-center walking lanes.
  for (const x of [x0 + CELL * 2, x0 + width - CELL * 2])
    for (const z of [z0 + CELL * 2, z0 + length - CELL * 2]) {
      solid(0.95, room.height, 0.95, x, room.height / 2, z, mats.cream);
      solid(1.04, 0.18, 1.04, x, 0.09, z, mats.trim);
      b.box(0.968, 0.28, 0.968, x, 1.12, z, mats.enamel);
      b.box(1.35, 0.25, 1.35, x, room.height - 0.125, z, mats.cream);
    }
  // Box-section service ducts and narrower pipes stay above both walking and jump clearance.
  for (const x of [x0 + 1.15, x0 + width - 1.15]) {
    solid(0.28, 0.28, length - 0.4, x, room.height - 0.36, z0 + length / 2, mats.enamel);
    b.box(0.1, 0.1, length - 0.4, x + 0.4, room.height - 0.36, z0 + length / 2, mats.metal);
    for (let row = 1; row < room.length; row += 2)
      b.box(0.9, 0.045, 0.065, x + 0.17, room.height - 0.54, z0 + row * CELL, mats.metal);
  }
  let supplies = 0;
  for (let cz = room.z; cz < room.z + room.length; cz++)
    for (let cx = room.x; cx < room.x + room.width; cx++) {
      const bits = data.cells[cz * CHUNK + cx];
      for (const [bit, dx, dz, angle] of [[N, 0, -1, 0], [E, 1, 0, -Math.PI / 2], [S, 0, 1, Math.PI], [W, -1, 0, Math.PI / 2]]) {
        if (inLandmark(room, cx + dx, cz + dz) || (bits & bit)) continue;
        const px = (cx + 0.5 + dx * 0.5) * CELL, pz = (cz + 0.5 + dz * 0.5) * CELL;
        // A warm unpatterned room-facing skim leaves adjoining office walls intact.
        b.plane(CELL, room.height, px - dx * 0.101, room.height / 2, pz - dz * 0.101, mats.cream, 0, angle);
        if (supplies >= 4 || hash(cx, cz, data.seed + 7207) % 3 !== 0) continue;
        const x = px - dx * 0.85, z = pz - dz * 0.85;
        // One conservative collider encloses the pallet and its stack, including slats.
        const w = dx ? 1.15 : 1.8, d = dx ? 1.8 : 1.15;
        b.colliders.push(new THREE.Box3(
          new THREE.Vector3(ox + x - w / 2, 0, oz + z - d / 2),
          new THREE.Vector3(ox + x + w / 2, 1.305, oz + z + d / 2),
        ));
        for (const offset of [-0.56, 0, 0.56])
          b.box(dx ? 1.15 : 0.12, 0.12, dx ? 0.12 : 1.15, x + (dx ? 0 : offset), 0.06, z + (dx ? offset : 0), mats.wood);
        for (let slat = 0; slat < 5; slat++)
          b.box(dx ? 0.19 : 1.8, 0.045, dx ? 1.8 : 0.19, x + (dx ? (slat - 2) * 0.235 : 0), 0.1425, z + (dx ? 0 : (slat - 2) * 0.235), mats.wood);
        for (const side of [-1, 1]) {
          const bx = x + (dx ? 0 : side * 0.4), bz = z + (dx ? side * 0.4 : 0);
          b.box(0.68, 0.62, 0.68, bx, 0.475, bz, mats.wood);
          b.box(0.69, 0.025, 0.69, bx, 0.7975, bz, mats.cream);
          b.box(0.065, 0.008, 0.7, bx, 0.814, bz, mats.enamel);
        }
        b.box(0.6, 0.46, 0.57, x, 1.05, z, mats.wood);
        b.box(0.61, 0.025, 0.58, x, 1.2925, z, mats.cream);
        supplies++;
      }
    }
  b.group.userData.warehouse = { columns: 4, supplies };
}
