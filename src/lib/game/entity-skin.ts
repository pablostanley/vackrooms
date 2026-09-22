import * as THREE from "three";
import { indexEntityGeometry } from "./entity-index";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

export type Tissue = {
  bone: THREE.Bone;
  center: THREE.Vector3;
  radii: THREE.Vector3;
  length?: number;
  radius?: number;
  curve?: number;
  blend?: number;
};

/** Smooth-union tissue is polygonized once in the bind pose, never per frame.
 * The same distance field blends bone weights across elbows, knees and sockets.
 */
export function sculptEntitySkin(tissue: Tissue[], bones: THREE.Bone[], material: THREE.Material) {
  const resolution = 128;
  const size = new THREE.Vector3(1.3, 3.25, 1.3);
  const origin = new THREE.Vector3(-0.65, -0.15, -0.65);
  const blend = 0.026;
  const shapes = tissue.map(({ bone, center, radii, length, radius, curve, blend: smoothing }) => ({
    length, radius, curve, smoothing: smoothing ?? blend,
    center: center.clone().applyMatrix4(bone.matrixWorld),
    radii,
    inverse: bone.matrixWorld.clone().invert(),
    local: center,
    bone: bones.indexOf(bone),
    minRadius: Math.min(radii.x, radii.y, radii.z),
  }));
  const surface = new MarchingCubes(resolution, material, false, false, 60000);
  surface.isolation = 0;
  surface.field.fill(-1);
  const point = new THREE.Vector3();
  const local = new THREE.Vector3();
  const distance = (shape: typeof shapes[number], p: THREE.Vector3) => {
    local.copy(p).applyMatrix4(shape.inverse).sub(shape.local);
    if (shape.length !== undefined && shape.radius !== undefined) {
      const t = THREE.MathUtils.clamp(0.5 - local.y / shape.length, 0, 1);
      const fullness = 0.7 + Math.sin(t * Math.PI) * 0.22 + (1 - t) * 0.14;
      local.x -= Math.sin(t * Math.PI) * (shape.curve ?? 0);
      local.y += (t - 0.5) * shape.length;
      local.z /= 0.86;
      return shape.radius * fullness - local.length();
    }
    local.divide(shape.radii);
    const radius = local.length();
    // Ellipsoid distance estimate retains longitudinal separation: a long thigh
    // must not influence nearby fingers merely because its cross-section is thin.
    const gradient = Math.hypot(local.x / shape.radii.x, local.y / shape.radii.y, local.z / shape.radii.z);
    return gradient > 1e-8 ? (1 - radius) * radius / gradient : shape.minRadius;
  };
  for (const shape of shapes) {
    const bounds = new THREE.Box3(
      shape.local.clone().sub(shape.radii), shape.local.clone().add(shape.radii),
    ).applyMatrix4(bones[shape.bone].matrixWorld).expandByScalar(blend);
    const lo = bounds.min.sub(origin).divide(size).multiplyScalar(resolution).floor();
    const hi = bounds.max.sub(origin).divide(size).multiplyScalar(resolution).ceil();
    for (let z = Math.max(1, lo.z); z <= Math.min(resolution - 2, hi.z); z++) {
      for (let y = Math.max(1, lo.y); y <= Math.min(resolution - 2, hi.y); y++) {
        for (let x = Math.max(1, lo.x); x <= Math.min(resolution - 2, hi.x); x++) {
          point.set(x, y, z).multiply(size).divideScalar(resolution).add(origin);
          const index = x + y * resolution + z * resolution * resolution;
          const a = surface.field[index], b = distance(shape, point);
          const h = Math.max(shape.smoothing - Math.abs(a - b), 0) / shape.smoothing;
          surface.field[index] = Math.max(a, b) + h * h * shape.smoothing * 0.25;
        }
      }
    }
  }
  surface.update();
  if (surface.count >= 180000) throw new Error("Creature surface exceeded its geometry budget");
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(surface.count * 3);
  const normals = new Float32Array(surface.count * 3);
  const indices = new Uint16Array(surface.count * 4);
  const weights = new Float32Array(surface.count * 4);
  const influence = new Float64Array(bones.length);
  const ranked = bones.map((_, i) => i);
  const source = surface.geometry.getAttribute("position");
  const sourceNormal = surface.geometry.getAttribute("normal");
  for (let vertex = 0; vertex < surface.count; vertex++) {
    point.fromBufferAttribute(source, vertex).addScalar(1).multiplyScalar(0.5).multiply(size).add(origin);
    point.toArray(positions, vertex * 3);
    local.fromBufferAttribute(sourceNormal, vertex).divide(size).normalize().toArray(normals, vertex * 3);
    influence.fill(0);
    for (const shape of shapes) {
      // Maximum per bone avoids biasing weights toward densely sampled anatomy.
      influence[shape.bone] = Math.max(influence[shape.bone], Math.exp(Math.min(0, distance(shape, point)) / 0.022));
    }
    ranked.sort((a, b) => influence[b] - influence[a]);
    // Nearby but unrelated limbs must never pull each other's skin. Blend only
    // along the skeletal chain containing the closest anatomical attachment.
    const primary = bones[ranked[0]];
    for (let bone = 0; bone < bones.length; bone++) {
      if (bones[bone] !== primary && bones[bone] !== primary.parent && bones[bone].parent !== primary) influence[bone] = 0;
    }
    ranked.sort((a, b) => influence[b] - influence[a]);
    const total = ranked.slice(0, 4).reduce((sum, bone) => sum + influence[bone], 0);
    for (let slot = 0; slot < 4; slot++) {
      indices[vertex * 4 + slot] = ranked[slot];
      weights[vertex * 4 + slot] = influence[ranked[slot]] / total;
    }
  }
  surface.geometry.dispose();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  indexEntityGeometry(geometry);
  const skin = new THREE.SkinnedMesh(geometry, material);
  skin.name = "continuous-void-skin";
  skin.castShadow = skin.receiveShadow = true;
  // Explicitly conservative animated bounds, shared with the shadow cache.
  skin.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 2.2);
  skin.bind(new THREE.Skeleton(bones));
  return skin;
}
