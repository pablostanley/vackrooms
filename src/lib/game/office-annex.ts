import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CELL, CHUNK, SPAN, directions, inLandmark, type ChunkData } from "./maze";
import type { LandmarkBuilder } from "./landmarks";
import type { Materials } from "./materials";

/** A stripped, low-ceiling office. All furniture backs onto a closed wall. */
export function buildOfficeAnnex(data: ChunkData, mats: Materials, b: LandmarkBuilder) {
  const room = data.landmark;
  const ox = data.x * SPAN, oz = data.z * SPAN;
  const width = room.width * CELL, length = room.length * CELL;
  // Override service/archive floors: this office always has restrained carpet.
  b.plane(width, length, (room.x + room.width / 2) * CELL, 0.014,
    (room.z + room.length / 2) * CELL, mats.floor, -Math.PI / 2);
  let windows = 0, fixtures = 0;
  const blindParts: THREE.BufferGeometry[] = [];
  for (let cz = room.z; cz < room.z + room.length; cz++)
    for (let cx = room.x; cx < room.x + room.width; cx++)
      for (const { bit, dx, dz } of directions) {
        if (inLandmark(room, cx + dx, cz + dz)) continue;
        if (data.cells[cz * CHUNK + cx] & bit) continue;
        const px = (cx + 0.5 + dx * 0.5) * CELL;
        const pz = (cz + 0.5 + dz * 0.5) * CELL;
        // Local coordinates: u runs across the wall, v points into the room.
        const box = (w: number, h: number, d: number, u: number, y: number,
          v: number, material: THREE.Material, solid = false) => {
          const x = px + dz * u - dx * v, z = pz - dx * u - dz * v;
          const bw = dx ? d : w, bd = dx ? w : d;
          b.box(bw, h, bd, x, y, z, material);
          if (solid) b.colliders.push(new THREE.Box3(
            new THREE.Vector3(ox + x - bw / 2, y - h / 2, oz + z - bd / 2),
            new THREE.Vector3(ox + x + bw / 2, y + h / 2, oz + z + bd / 2),
          ));
        };
        box(CELL, room.height, 0.035, 0, room.height / 2, 0.115, mats.cream);
        box(CELL, 0.12, 0.06, 0, 0.06, 0.14, mats.trim);
        box(CELL, 0.055, 0.05, 0, 2.95, 0.14, mats.trim);
        // Glazed-looking internal windows are sealed by opaque venetian blinds.
        // Nothing suggests a daylight sky, and no passage or doorway is covered.
        if (windows < 8 && (cx + cz) % 2 === 0) {
          box(3.1, 1.52, 0.055, 0, 1.84, 0.15, mats.cream);
          for (const u of [-1.57, 0, 1.57])
            box(0.05, 1.62, 0.09, u, 1.84, 0.205, mats.enamel);
          for (const y of [1.03, 2.65])
            box(3.2, 0.055, 0.12, 0, y, 0.205, mats.enamel);
          // Fine slats are smaller than a spotlight shadow texel. Keep their
          // shading local to one batched mesh rather than producing shimmering
          // self-shadow patterns across an otherwise calm closed blind.
          for (let slat = 0; slat < 12; slat++) {
            const geometry = new THREE.BoxGeometry(dx ? 0.035 : 3.05, 0.115,
              dx ? 3.05 : 0.035);
            geometry.translate(ox + px - dx * 0.22, 1.16 + slat * 0.122,
              oz + pz - dz * 0.22);
            blindParts.push(geometry);
          }
          for (const u of [-0.94, 0.94])
            box(0.018, 1.46, 0.012, u, 1.84, 0.255, mats.fixtures);
          box(0.016, 0.55, 0.02, 1.42, 0.8, 0.25, mats.fixtures);
          box(0.06, 0.09, 0.04, 1.42, 0.51, 0.25, mats.wood);
          windows++;
        } else if (fixtures < 2) {
          if (fixtures === 0) {
            // Bottleless drinking-water station: recessed spout, drip tray,
            // cup stack and plumbing, with no brand or invented interaction.
            box(0.76, 1.2, 0.58, 0, 0.6, 0.46, mats.enamel, true);
            box(0.65, 0.1, 0.51, 0, 1.2, 0.48, mats.metal);
            box(0.62, 0.42, 0.07, 0, 1.46, 0.23, mats.fixtures);
            box(0.1, 0.12, 0.19, 0, 1.54, 0.35, mats.metal);
            box(0.42, 0.025, 0.25, 0, 1.26, 0.46, mats.trim);
            for (let cup = 0; cup < 4; cup++)
              box(0.095 + cup * 0.008, 0.045, 0.095 + cup * 0.008,
                0.22, 1.29 + cup * 0.035, 0.48, mats.paper);
            box(0.05, 0.8, 0.05, 0.27, 0.4, 0.17, mats.metal);
          } else {
            // One unattended vending cabinet with a few pale unlabelled bottles.
            box(1.28, 2.04, 0.74, 0, 1.02, 0.54, mats.enamel, true);
            box(0.85, 1.39, 0.04, -0.12, 1.23, 0.925, mats.wood);
            for (let shelf = 0; shelf < 3; shelf++) {
              const y = 0.67 + shelf * 0.41;
              box(0.85, 0.025, 0.1, -0.12, y, 0.96, mats.metal);
              for (let bottle = 0; bottle < 3 - (shelf % 2); bottle++) {
                const u = -0.38 + bottle * 0.25;
                box(0.12, 0.24, 0.055, u, y + 0.15, 0.965, mats.cream);
                box(0.065, 0.045, 0.055, u, y + 0.292, 0.965, mats.trim);
              }
            }
            box(0.16, 0.09, 0.035, 0.48, 1.54, 0.925, mats.trim);
            for (let button = 0; button < 4; button++)
              box(0.09, 0.035, 0.05, 0.48, 1.35 - button * 0.11, 0.94, mats.metal);
            box(0.65, 0.18, 0.04, -0.09, 0.27, 0.925, mats.trim);
          }
          fixtures++;
        }
      }
  if (blindParts.length) {
    const geometry = mergeGeometries(blindParts)!;
    for (const part of blindParts) part.dispose();
    const blinds = new THREE.Mesh(geometry, mats.cream);
    blinds.name = "office-annex-blinds";
    blinds.castShadow = false;
    blinds.receiveShadow = false;
    b.group.add(blinds);
  }
  // Ceiling service rails emphasize the low plane while staying above the capsule.
  for (let row = 1; row < room.length; row += 2)
    b.box(width, 0.095, 0.08, (room.x + room.width / 2) * CELL,
      room.height - 0.055, (room.z + row) * CELL, mats.enamel);
  b.group.userData.officeAnnex = { windows, fixtures };
}
