import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CELL, CHUNK, N, S, SPAN, type ChunkData } from "./maze";
import type { Materials } from "./materials";
import type { LandmarkBuilder } from "./landmarks";

export const UTILITY_PIPE_Y = 2.83;
export const UTILITY_PIPE_RADIUS = 0.065;
export const UTILITY_FLANGE_RADIUS = 0.075;
const PIPE_DEPTH = 0.68;

export function utilityBays(data: ChunkData) {
  return ([-1, 1] as const).flatMap((side) => {
    const closed = Array.from({ length: CHUNK }, (_, x) => x).filter((x) => !(data.cells[data.landmark.z * CHUNK + x] & (side < 0 ? N : S)));
    return closed.length ? [{ x: closed[Math.floor(closed.length / 2)], side }] : [];
  });
}

/** Original pipework: continuous mains, with service fittings on closed walls only. */
export function buildUtilityCorridor(data: ChunkData, mats: Materials, b: LandmarkBuilder) {
  const ox = data.x * SPAN, oz = data.z * SPAN;
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let triangles = 0;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, main = false) => {
    geometry.translate(ox, 0, oz);
    // Author both seam planes from the same world coordinate, avoiding two
    // different Float32 rounding paths on neighboring sections.
    if (main) {
      const positions = geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++)
        positions.setX(i, ox + (positions.getX(i) < ox + SPAN / 2 ? 0 : SPAN));
    }
    geometry.computeBoundingBox();
    b.colliders.push(geometry.boundingBox!.clone());
    triangles += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
    const parts = batches.get(material) ?? [];
    parts.push(geometry); batches.set(material, parts);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) =>
    add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), mat);
  const cylinder = (r: number, length: number, x: number, y: number, z: number, axis: "x" | "y" | "z", mat: THREE.Material) => {
    const geometry = new THREE.CylinderGeometry(r, r, length, 8);
    if (axis === "x") geometry.rotateZ(Math.PI / 2);
    if (axis === "z") geometry.rotateX(Math.PI / 2);
    add(geometry.translate(x, y, z), mat, axis === "x" && length === SPAN);
  };
  for (const side of [-1, 1] as const) {
    const wallZ = (data.landmark.z + (side > 0 ? 1 : 0)) * CELL;
    const z = wallZ - side * PIPE_DEPTH;
    const material = side < 0 ? mats.enamel : mats.fixtures;
    cylinder(UTILITY_PIPE_RADIUS, SPAN, SPAN / 2, UTILITY_PIPE_Y, z, "x", material);
    for (let x = 0; x < CHUNK; x++) {
      const px = (x + 0.5) * CELL;
      cylinder(UTILITY_FLANGE_RADIUS, 0.035, px, UTILITY_PIPE_Y, z, "x", mats.metal);
      if (x % 2 === 0) box(0.045, 0.15, 0.06, px, 2.965, z, mats.metal);
    }
  }
  for (const { x: bay, side } of utilityBays(data)) {
    const x = (bay + 0.5) * CELL;
    const wallZ = (data.landmark.z + (side > 0 ? 1 : 0)) * CELL;
    const zAt = (depth: number) => wallZ - side * depth;
    const material = side < 0 ? mats.enamel : mats.fixtures;
    const bend = 0.18, stemTop = UTILITY_PIPE_Y - bend;
    cylinder(UTILITY_PIPE_RADIUS, stemTop - 0.35, x, (stemTop + 0.35) / 2, zAt(0.28), "y", material);
    class Elbow extends THREE.Curve<THREE.Vector3> {
      constructor() { super(); }
      getPoint(t: number, point = new THREE.Vector3()) {
        const angle = Math.PI - t * Math.PI / 2;
        return point.set(x, stemTop + bend * Math.sin(angle), zAt(0.46 + bend * Math.cos(angle)));
      }
    }
    add(new THREE.TubeGeometry(new Elbow(), 4, UTILITY_PIPE_RADIUS, 6, false), material);
    cylinder(UTILITY_PIPE_RADIUS, PIPE_DEPTH - 0.46, x, UTILITY_PIPE_Y, zAt((PIPE_DEPTH + 0.46) / 2), "z", material);
    cylinder(0.028, 0.23, x, 1.42, zAt(0.395), "z", mats.metal);
    const wheel = new THREE.TorusGeometry(0.17, 0.023, 4, 12).translate(x, 1.42, zAt(0.51));
    add(wheel, mats.fadedRed);
    for (const [w, h] of [[0.3, 0.025], [0.025, 0.3]]) box(w, h, 0.025, x, 1.42, zAt(0.51), mats.fadedRed);
    // A shallow closed service box with an unlabelled latch, not an interaction.
    box(0.52, 0.68, 0.2, x + 0.85, 1.5, zAt(0.22), mats.fixtures);
    box(0.44, 0.6, 0.025, x + 0.85, 1.5, zAt(0.3325), mats.enamel);
    box(0.035, 0.13, 0.035, x + 1, 1.5, zAt(0.36), mats.metal);
  }
  for (const [material, parts] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
    mesh.name = "utility-pipework";
    mesh.castShadow = mesh.receiveShadow = true;
    b.group.add(mesh);
    parts.forEach((part) => part.dispose());
  }
  b.group.userData.utilityCorridor = { risers: utilityBays(data).length, triangles, batches: batches.size };
}
