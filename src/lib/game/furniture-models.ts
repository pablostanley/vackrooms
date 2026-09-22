import * as THREE from "three";
import type { Materials } from "./materials";
import {
  createComputerModel,
  isComputerKind,
  type ComputerKind,
} from "./computer-models";

export const chairKinds = [
  "chair",
  "officeChair",
  "foldingChair",
  "plasticChair",
] as const;
export type ChairKind = (typeof chairKinds)[number];
export function isChairKind(kind: FurnitureKind): kind is ChairKind {
  return (chairKinds as readonly string[]).includes(kind);
}

export type FurnitureKind =
  | ChairKind
  | "filingCabinet"
  | "bookcase"
  | "bench"
  | "sideTable"
  | "utilityCart"
  | "sofa"
  | "table"
  | "lamp"
  | "slide"
  | "springHorse"
  | "blocks"
  | ComputerKind;

export interface FurnitureModel {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  bounds: THREE.Box3;
  /** Optional compact player solids; the full bound still reserves navigation. */
  playerBounds?: THREE.Box3[];
  /** A point inside solid geometry, used when embedding the object in a wall. */
  anchor: THREE.Vector3;
}

type Point = [number, number, number];

/** Small, indexed meshes that can be baked into a section's material batches. */
export function createFurniture(
  kind: FurnitureKind,
  mats: Materials,
  lampOn = false,
): FurnitureModel {
  if (isComputerKind(kind)) return createComputerModel(kind, mats);
  const parts: FurnitureModel["parts"] = [];
  const bounds = new THREE.Box3();
  const anchor = new THREE.Vector3();

  function add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: Point,
    rotation: Point = [0, 0, 0],
  ) {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    parts.push({ geometry, material });
  }

  function box(
    size: Point,
    position: Point,
    material: THREE.Material,
    rotation?: Point,
  ) {
    add(new THREE.BoxGeometry(...size), material, position, rotation);
  }

  function cushion(
    size: Point,
    position: Point,
    material: THREE.Material,
    radius = 0.075,
    rotation?: Point,
  ) {
    const geometry = new THREE.BoxGeometry(...size, 4, 4, 4);
    const vertices = geometry.getAttribute("position");
    const r = Math.min(radius, ...size.map((dimension) => dimension * 0.4));
    const inner = new THREE.Vector3(...size).multiplyScalar(0.5).subScalar(r);
    const vertex = new THREE.Vector3();
    const nearest = new THREE.Vector3();
    for (let i = 0; i < vertices.count; i++) {
      vertex.fromBufferAttribute(vertices, i);
      nearest.copy(vertex).clamp(inner.clone().negate(), inner);
      vertex.sub(nearest).normalize().multiplyScalar(r).add(nearest);
      vertices.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();
    add(geometry, material, position, rotation);
  }

  function cylinder(
    top: number,
    bottom: number,
    height: number,
    position: Point,
    material: THREE.Material,
    rotation?: Point,
  ) {
    add(
      new THREE.CylinderGeometry(top, bottom, height, 12),
      material,
      position,
      rotation,
    );
  }

  function ellipsoid(size: Point, position: Point, material: THREE.Material) {
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    geometry.scale(...(size.map((dimension) => dimension / 2) as Point));
    add(geometry, material, position);
  }

  function strut(
    from: Point,
    to: Point,
    radius: number,
    material: THREE.Material,
  ) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      a.distanceTo(b),
      8,
    );
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        b.clone().sub(a).normalize(),
      ),
    );
    add(geometry, material, a.add(b).multiplyScalar(0.5).toArray() as Point);
  }

  switch (kind) {
    case "chair": {
      // The seat and four legs are also the attachment contract for chair piles.
      box([0.48, 0.065, 0.48], [0, 0.45, 0], mats.wood);
      cushion([0.43, 0.055, 0.43], [0, 0.51, 0], mats.fabric, 0.018);
      for (const x of [-0.19, 0.19]) {
        for (const z of [-0.19, 0.19]) {
          box([0.045, 0.46, 0.045], [x, 0.23, z], mats.wood);
        }
      }
      for (const x of [-0.21, 0.21]) {
        box([0.035, 0.58, 0.035], [x, 0.76, 0.21], mats.wood);
      }
      for (const y of [0.67, 0.81, 0.96]) {
        box([0.45, 0.065, 0.028], [0, y, 0.21], mats.wood);
      }
      anchor.set(0, 0.46, 0);
      break;
    }
    case "officeChair": {
      // A low upholstered swivel chair on a five-spoke caster base.
      cylinder(0.045, 0.065, 0.39, [0, 0.265, 0], mats.metal);
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5;
        const x = Math.cos(angle) * 0.31,
          z = Math.sin(angle) * 0.31;
        strut([0, 0.15, 0], [x, 0.075, z], 0.028, mats.metal);
        cylinder(0.045, 0.045, 0.055, [x, 0.045, z], mats.metal, [
          Math.PI / 2,
          0,
          angle,
        ]);
      }
      cushion([0.55, 0.12, 0.53], [0, 0.49, 0], mats.upholstery, 0.04);
      box([0.06, 0.4, 0.05], [0, 0.67, 0.24], mats.metal);
      cushion(
        [0.51, 0.38, 0.11],
        [0, 0.85, 0.25],
        mats.upholstery,
        0.045,
        [0.08, 0, 0],
      );
      for (const x of [-0.32, 0.32]) {
        strut([x, 0.48, 0.12], [x, 0.7, 0.12], 0.023, mats.metal);
        cushion([0.07, 0.055, 0.34], [x, 0.72, 0], mats.fabric, 0.02);
      }
      anchor.set(0, 0.49, 0);
      break;
    }
    case "foldingChair": {
      for (const x of [-0.23, 0.23]) {
        strut([x, 0.025, -0.28], [x, 0.88, 0.2], 0.025, mats.metal);
        strut([x, 0.025, 0.29], [x, 0.48, -0.18], 0.025, mats.metal);
        box([0.065, 0.05, 0.085], [x, 0.025, -0.28], mats.metal);
        box([0.065, 0.05, 0.085], [x, 0.025, 0.29], mats.metal);
      }
      strut([-0.23, 0.17, 0.22], [0.23, 0.17, 0.22], 0.019, mats.metal);
      cushion([0.5, 0.065, 0.47], [0, 0.46, -0.015], mats.fadedRed, 0.025);
      cushion(
        [0.47, 0.25, 0.055],
        [0, 0.76, 0.16],
        mats.fadedRed,
        0.025,
        [0.12, 0, 0],
      );
      anchor.set(0, 0.46, 0);
      break;
    }
    case "plasticChair": {
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          strut(
            [x * 0.255, 0.04, z * 0.255],
            [x * 0.18, 0.44, z * 0.18],
            0.04,
            mats.enamel,
          );
      cushion([0.55, 0.09, 0.53], [0, 0.46, 0], mats.enamel, 0.035);
      for (const x of [-0.22, 0.22])
        cushion(
          [0.09, 0.45, 0.07],
          [x, 0.72, 0.24],
          mats.enamel,
          0.025,
          [0.09, 0, 0],
        );
      cushion(
        [0.51, 0.25, 0.07],
        [0, 0.85, 0.25],
        mats.enamel,
        0.03,
        [0.09, 0, 0],
      );
      anchor.set(0, 0.46, 0);
      break;
    }
    case "sofa": {
      for (const x of [-0.83, 0.83]) {
        for (const z of [-0.33, 0.33]) {
          box([0.11, 0.18, 0.11], [x, 0.09, z], mats.wood);
        }
      }
      cushion([2.08, 0.3, 0.94], [0, 0.29, 0], mats.upholstery);
      cushion([2.02, 0.67, 0.24], [0, 0.71, 0.35], mats.upholstery);
      for (const x of [-0.91, 0.91]) {
        cushion([0.29, 0.61, 0.99], [x, 0.57, 0], mats.upholstery, 0.11);
      }
      for (const x of [-0.39, 0.39]) {
        cushion([0.77, 0.22, 0.73], [x, 0.49, -0.075], mats.upholstery);
        cushion(
          [0.78, 0.48, 0.19],
          [x, 0.77, 0.245],
          mats.upholstery,
          0.07,
          [-0.08, 0, 0],
        );
        // A continuous, shallow seam catches light without adding a noisy texture.
        box([0.65, 0.014, 0.018], [x, 0.468, -0.436], mats.fabric);
      }
      anchor.set(-0.39, 0.49, -0.075);
      break;
    }
    case "table": {
      for (const x of [-0.68, 0.68]) {
        for (const z of [-0.36, 0.36]) {
          box([0.095, 0.77, 0.095], [x, 0.385, z], mats.wood);
        }
      }
      box([1.48, 0.16, 0.83], [0, 0.69, 0], mats.wood);
      cushion([1.8, 0.12, 1.08], [0, 0.8, 0], mats.wood, 0.025);
      cushion([1.76, 0.025, 1.04], [0, 0.858, 0], mats.cream, 0.008);
      anchor.set(0, 0.8, 0);
      break;
    }
    case "filingCabinet": {
      box([0.62, 1.36, 0.62], [0, 0.68, 0], mats.enamel);
      box([0.55, 0.08, 0.55], [0, 0.04, 0], mats.metal);
      for (let i = 0; i < 4; i++) {
        const y = 0.23 + i * 0.32;
        box([0.55, 0.285, 0.035], [0, y, -0.325], mats.cream);
        box([0.19, 0.035, 0.045], [0, y + 0.035, -0.36], mats.metal);
        box([0.12, 0.045, 0.012], [0, y - 0.065, -0.35], mats.wood);
      }
      anchor.set(0, 0.68, 0);
      break;
    }
    case "bookcase": {
      box([1.22, 1.85, 0.06], [0, 0.925, 0.23], mats.wood);
      for (const x of [-0.58, 0.58])
        box([0.08, 1.85, 0.52], [x, 0.925, 0], mats.wood);
      for (const y of [0.055, 0.49, 0.93, 1.37, 1.81])
        box([1.16, 0.08, 0.52], [0, y, 0], mats.wood);
      // A few forgotten binders leave most shelves conspicuously empty.
      for (let i = 0; i < 5; i++) {
        const x = -0.42 + i * 0.085;
        box([0.07, 0.3 + (i % 2) * 0.045, 0.27], [x, 0.68, 0.04],
          i % 2 ? mats.fabric : mats.cream);
      }
      anchor.set(0, 0.93, 0);
      break;
    }
    case "bench": {
      for (const x of [-0.7, 0.7]) {
        box([0.065, 0.44, 0.48], [x, 0.22, 0], mats.metal);
        box([0.28, 0.05, 0.56], [x, 0.025, 0], mats.metal);
      }
      cushion([1.85, 0.14, 0.61], [0, 0.48, 0], mats.upholstery, 0.045);
      for (const x of [-0.6, 0, 0.6])
        box([0.012, 0.008, 0.53], [x, 0.552, 0], mats.fabric);
      anchor.set(0, 0.48, 0);
      break;
    }
    case "sideTable": {
      for (const x of [-0.26, 0.26])
        for (const z of [-0.26, 0.26])
          box([0.055, 0.57, 0.055], [x, 0.285, z], mats.wood);
      box([0.58, 0.045, 0.58], [0, 0.17, 0], mats.wood);
      cushion([0.72, 0.085, 0.72], [0, 0.585, 0], mats.wood, 0.018);
      box([0.68, 0.018, 0.68], [0, 0.635, 0], mats.cream);
      anchor.set(0, 0.585, 0);
      break;
    }
    case "utilityCart": {
      for (const x of [-0.39, 0.39])
        for (const z of [-0.23, 0.23]) {
          cylinder(0.065, 0.065, 0.055, [x, 0.065, z], mats.metal, [0, 0, Math.PI / 2]);
          strut([x, 0.1, z], [x, 0.94, z], 0.025, mats.metal);
        }
      for (const y of [0.22, 0.68]) {
        box([0.86, 0.045, 0.54], [0, y, 0], mats.enamel);
        for (const z of [-0.26, 0.26])
          box([0.86, 0.09, 0.025], [0, y + 0.045, z], mats.enamel);
      }
      strut([0.39, 0.94, -0.23], [0.39, 0.94, 0.23], 0.027, mats.metal);
      anchor.set(0, 0.68, 0);
      break;
    }
    case "lamp": {
      cylinder(0.29, 0.32, 0.07, [0, 0.035, 0], mats.metal);
      cylinder(0.035, 0.035, 1.46, [0, 0.78, 0], mats.wood);
      cylinder(0.065, 0.045, 0.12, [0, 1.49, 0], mats.metal);
      cylinder(
        0.2,
        0.43,
        0.48,
        [0, 1.68, 0],
        lampOn ? mats.lampGlow : mats.cream,
      );
      cylinder(0.21, 0.21, 0.025, [0, 1.922, 0], mats.upholstery);
      cylinder(0.435, 0.435, 0.025, [0, 1.443, 0], mats.upholstery);
      ellipsoid([0.09, 0.11, 0.09], [0, 1.975, 0], mats.wood);
      strut([0.12, 1.5, 0], [0.12, 1.21, 0], 0.008, mats.metal);
      anchor.set(0, 0.035, 0);
      break;
    }
    case "slide": {
      box([0.95, 0.12, 0.7], [0, 1.48, -0.85], mats.enamel);
      for (const x of [-0.43, 0.43]) {
        strut([x, 0.04, -0.67], [x, 1.5, -0.67], 0.06, mats.fadedRed);
        strut([x, 0.045, -1.48], [x, 1.91, -1.12], 0.055, mats.fadedRed);
        strut([x, 1.89, -1.12], [x, 1.89, -0.48], 0.055, mats.fadedRed);
        strut([x, 1.89, -0.48], [x, 1.52, -0.48], 0.055, mats.fadedRed);
      }
      for (let i = 1; i <= 6; i++) {
        const y = i * 0.232;
        const z = -1.48 + (y / 1.866) * 0.36;
        strut([-0.43, y, z], [0.43, y, z], 0.045, mats.wood);
      }
      const top = new THREE.Vector3(0, 1.49, -0.51);
      const bottom = new THREE.Vector3(0, 0.16, 1.34);
      const chute = new THREE.BoxGeometry(0.87, 0.085, top.distanceTo(bottom));
      chute.rotateX(Math.atan2(top.y - bottom.y, bottom.z - top.z));
      add(
        chute,
        mats.cream,
        top.add(bottom).multiplyScalar(0.5).toArray() as Point,
      );
      for (const x of [-0.45, 0.45]) {
        strut([x, 1.6, -0.54], [x, 0.27, 1.38], 0.065, mats.enamel);
      }
      cushion([0.88, 0.13, 0.36], [0, 0.105, 1.41], mats.cream, 0.035);
      // A broad foot joins the two rails and makes the slide touch the carpet.
      box([1.02, 0.11, 0.28], [0, 0.055, 1.31], mats.fadedRed);
      anchor.set(0, 1.48, -0.85);
      break;
    }
    case "springHorse": {
      cylinder(0.33, 0.36, 0.07, [0, 0.035, 0], mats.metal);
      const coil: THREE.Vector3[] = [];
      for (let i = 0; i <= 80; i++) {
        const t = i / 80;
        const angle = t * Math.PI * 10;
        coil.push(
          new THREE.Vector3(
            Math.cos(angle) * 0.16,
            0.08 + t * 0.77,
            Math.sin(angle) * 0.16,
          ),
        );
      }
      add(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(coil),
          80,
          0.035,
          6,
          false,
        ),
        mats.metal,
        [0, 0, 0],
      );
      box([0.5, 0.13, 0.36], [0, 0.9, 0], mats.fadedRed);
      ellipsoid([1.18, 0.63, 0.4], [0, 1.2, 0], mats.enamel);
      ellipsoid([0.39, 0.72, 0.32], [0.39, 1.49, 0], mats.enamel);
      ellipsoid([0.57, 0.39, 0.35], [0.55, 1.78, 0], mats.enamel);
      cushion([0.39, 0.21, 0.32], [0.73, 1.71, 0], mats.enamel, 0.07);
      for (const z of [-0.105, 0.105]) {
        ellipsoid([0.12, 0.29, 0.095], [0.42, 1.99, z], mats.fadedRed);
        ellipsoid(
          [0.07, 0.07, 0.018],
          [0.65, 1.835, z < 0 ? -0.158 : 0.158],
          mats.wood,
        );
      }
      cushion([0.51, 0.11, 0.45], [-0.13, 1.493, 0], mats.fadedRed, 0.035);
      strut([0.37, 1.6, -0.34], [0.37, 1.6, 0.34], 0.035, mats.wood);
      strut([-0.05, 0.97, -0.42], [-0.05, 0.97, 0.42], 0.055, mats.wood);
      for (const x of [-0.34, 0.31]) {
        strut([x, 1.06, -0.09], [x - 0.11, 0.79, -0.09], 0.085, mats.enamel);
      }
      strut([-0.51, 1.29, 0], [-0.73, 1.01, 0], 0.075, mats.fadedRed);
      anchor.set(0, 1.2, 0);
      break;
    }
    case "blocks": {
      const blockSize = 0.72;
      const locations: Point[] = [
        [-0.34, 0.36, 0.11],
        [0.35, 0.36, 0.05],
        [-0.11, 1.058, 0.04],
      ];
      const colors = [mats.enamel, mats.fadedRed, mats.fabric];
      // Both upper corners overlap the lower blocks, even before scene clipping.
      for (let i = 0; i < locations.length; i++) {
        const [x, y, z] = locations[i];
        cushion([blockSize, blockSize, blockSize], [x, y, z], colors[i], 0.045);
        box([0.57, 0.57, 0.019], [x, y, z - 0.357], mats.cream);
        const ink = colors[i];
        const front = z - 0.373;
        if (i === 0) {
          box([0.055, 0.38, 0.017], [x - 0.1, y, front], ink, [0, 0, -0.28]);
          box([0.055, 0.38, 0.017], [x + 0.1, y, front], ink, [0, 0, 0.28]);
          box([0.19, 0.05, 0.017], [x, y - 0.015, front], ink);
        } else if (i === 1) {
          box([0.055, 0.38, 0.017], [x - 0.115, y, front], ink);
          for (const offset of [-0.16, 0, 0.16]) {
            box([0.22, 0.05, 0.017], [x - 0.01, y + offset, front], ink);
          }
          for (const offset of [-0.08, 0.08]) {
            box([0.055, 0.14, 0.017], [x + 0.1, y + offset, front], ink);
          }
        } else {
          box([0.055, 0.37, 0.017], [x - 0.115, y, front], ink);
          for (const offset of [-0.16, 0.16]) {
            box([0.27, 0.05, 0.017], [x + 0.005, y + offset, front], ink);
          }
        }
      }
      anchor.set(...locations[0]);
      break;
    }
  }

  return { parts, bounds, anchor };
}
