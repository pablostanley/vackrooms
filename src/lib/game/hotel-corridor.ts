import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CELL, CHUNK, N, S, SPAN, hash, type ChunkData } from "./maze";
import type { Materials } from "./materials";
import type { LandmarkBuilder } from "./landmarks";

/** Closed wall bays only: every existing branch remains an unmistakable opening. */
export function hotelBays(data: ChunkData) {
  const bays: { x: number; side: -1 | 1 }[] = [];
  for (let x = 0; x < CHUNK; x++)
    for (const side of [-1, 1] as const)
      if (!(data.cells[data.landmark.z * CHUNK + x] & (side < 0 ? N : S))) bays.push({ x, side });
  return bays;
}

/** Original hotel joinery fits against the existing corridor walls. */
export function buildHotelCorridor(data: ChunkData, mats: Materials, b: LandmarkBuilder) {
  const labels: THREE.BufferGeometry[] = [];
  const bays = hotelBays(data);
  const ox = data.x * SPAN, oz = data.z * SPAN;
  // Only the middle section gets a key cupboard. No new RNG affects the maze.
  const cupboard = ((data.x % 3) + 3) % 3 === 1 ? bays[Math.floor(bays.length / 2)] : undefined;
  for (const bay of bays) {
    const x = (bay.x + 0.5) * CELL;
    const z = (data.landmark.z + (bay.side > 0 ? 1 : 0)) * CELL;
    const inward = -bay.side;
    const part = (w: number, h: number, d: number, dx: number, y: number, depth: number, mat: THREE.Material) =>
      b.box(w, h, d, x + dx, y, z + inward * depth, mat);
    const solid = (w: number, h: number, d: number, dx: number, y: number, depth: number) => {
      const center = new THREE.Vector3(ox + x + dx, y, oz + z + inward * depth);
      b.colliders.push(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(w, h, d)));
    };
    part(CELL, 2.2, 0.025, 0, 2.05, 0.104, mats.courtyardWall);
    part(CELL, 0.95, 0.03, 0, 0.475, 0.107, mats.courtyardWood);
    for (const y of [0.075, 0.97]) part(CELL, 0.075, 0.075, 0, y, 0.13, mats.wood);
    part(1.06, 2.15, 0.05, 0, 1.075, 0.15, mats.courtyardWood);
    part(0.79, 1.4, 0.025, 0, 0.93, 0.19, mats.wood);
    for (const dx of [-0.6, 0.6]) part(0.11, 2.79, 0.09, dx, 1.395, 0.16, mats.wood);
    for (const y of [2.2, 2.74]) part(1.3, 0.1, 0.09, 0, y, 0.16, mats.wood);
    part(1.07, 0.43, 0.03, 0, 2.47, 0.15, mats.courtyardWarm);
    part(0.09, 0.23, 0.035, 0.39, 1.03, 0.198, mats.enamel);
    part(0.14, 0.035, 0.055, 0.35, 1.04, 0.226, mats.enamel);
    part(0.07, 0.12, 0.055, 0.86, 1.33, 0.16, mats.enamel);
    // A continuous shallow wall bound prevents jumping into the trim; it ends
    // exactly at the closed bay, and never caps a neighboring side passage.
    solid(CELL, data.landmark.height, 0.14, 0, data.landmark.height / 2, 0.16);

    const label = new THREE.PlaneGeometry(0.28, 0.14);
    const index = hash(data.x * CHUNK + bay.x, data.z * 2 + bay.side, 8119) % 16;
    const uv = label.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (index % 4 + uv.getX(i)) / 4, (3 - Math.floor(index / 4) + uv.getY(i)) / 4);
    label.rotateY(bay.side < 0 ? 0 : Math.PI);
    label.translate(ox + x, 1.92, oz + z + inward * 0.18);
    labels.push(label);

    if (bay === cupboard) {
      const dx = 1.65;
      part(0.72, 0.98, 0.24, dx, 1.45, 0.24, mats.wood);
      part(0.6, 0.84, 0.018, dx, 1.45, 0.365, mats.courtyardWood);
      for (const y of [1.2, 1.47, 1.74]) {
        part(0.6, 0.025, 0.05, dx, y - 0.07, 0.38, mats.wood);
        for (const offset of [-0.18, 0, 0.18]) part(0.025, 0.075, 0.025, dx + offset, y, 0.4, mats.enamel);
      }
      // Tight union of the cabinet back (0.12) and hook tips (0.4125).
      solid(0.72, 0.98, 0.2925, dx, 1.45, 0.26625);
    }
  }
  if (labels.length) {
    const mesh = new THREE.Mesh(mergeGeometries(labels)!, mats.hotelNumbers);
    mesh.name = "hotel-room-numbers";
    mesh.receiveShadow = true;
    b.group.add(mesh);
    labels.forEach((geometry) => geometry.dispose());
  }
}
