import * as THREE from "three";
import type { Materials } from "./materials";
import {
  createComputerModel,
  isComputerKind,
  type ComputerKind,
} from "./computer-models";
import { random } from "./maze";

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
  | "waterCooler"
  | "photocopier"
  | "archiveCartons"
  | "sofa"
  | "table"
  | "lamp"
  | "slide"
  | "springHorse"
  | "blocks"
  | ComputerKind;

/**
 * Every non-computer kind has this many authored designs. Each design also
 * carries small seeded proportion changes, so repeated rooms rarely match.
 */
export const furnitureVariants = 3;
export function furnitureVariant(kind: FurnitureKind, variant: number) {
  if (isComputerKind(kind)) return 0;
  const whole = Math.floor(Number.isFinite(variant) ? variant : 0);
  return ((whole % furnitureVariants) + furnitureVariants) % furnitureVariants;
}

/** Measured solids of a wooden chair, used to solve piles without clipping. */
export interface ChairFrame {
  /** Highest seat surface. */
  seatTop: number;
  /** Half width and depth of the square wooden seat block. */
  seatHalf: number;
  /** Distance of each leg center from the vertical axis along x and z. */
  legInset: number;
  legHalf: number;
  /** Nearest local z of any backrest solid; the back faces local +Z. */
  backFront: number;
  backTop: number;
}

export interface FurnitureModel {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  bounds: THREE.Box3;
  /** Optional compact player solids; the full bound still reserves navigation. */
  playerBounds?: THREE.Box3[];
  /** A point inside solid geometry, used when embedding the object in a wall. */
  anchor: THREE.Vector3;
  /** Only the wooden chair, whose piles depend on its exact proportions. */
  chair?: ChairFrame;
}

type Point = [number, number, number];

function variantSeed(kind: string, variant: number) {
  let h = 2166136261;
  for (const char of `${kind}:${variant}`)
    h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Small, indexed meshes that can be baked into a section's material batches. */
export function createFurniture(
  kind: FurnitureKind,
  mats: Materials,
  lampOn = false,
  variant = 0,
): FurnitureModel {
  if (isComputerKind(kind)) return createComputerModel(kind, mats);
  const design = furnitureVariant(kind, variant);
  const rng = random(variantSeed(kind, design));
  /** A seeded proportion change of at most +/- spread. */
  const vary = (value: number, spread: number) =>
    value + (rng() * 2 - 1) * spread;
  const parts: FurnitureModel["parts"] = [];
  const bounds = new THREE.Box3();
  const anchor = new THREE.Vector3();
  let chairFrame: ChairFrame | undefined;

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
    segments = 12,
  ) {
    add(
      new THREE.CylinderGeometry(top, bottom, height, segments),
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

  /** Four upright legs joined by low rails, the base of most small tables. */
  function legFrame(
    halfX: number,
    halfZ: number,
    height: number,
    leg: number,
    material: THREE.Material,
    rail = 0,
  ) {
    for (const x of [-halfX, halfX])
      for (const z of [-halfZ, halfZ])
        box([leg, height, leg], [x, height / 2, z], material);
    if (!rail) return;
    const t = leg * 0.55;
    for (const x of [-halfX, halfX])
      box([t, t, halfZ * 2], [x, rail, 0], material);
    for (const z of [-halfZ, halfZ])
      box([halfX * 2, t, t], [0, rail, z], material);
  }

  switch (kind) {
    case "chair": {
      // Ladder-back, spindle-back and padded-back dining chairs. All three keep
      // their back posts behind the rear legs, the contract used by piles.
      const seatHalf = design === 1 ? 0.23 : 0.24;
      const legInset = seatHalf - 0.06;
      const legHalf = 0.0225;
      const seatBottom = vary(0.42, 0.012);
      const block = design === 1 ? 0.07 : 0.06;
      const woodTop = seatBottom + block;
      const padded = design !== 1;
      const seatTop = padded ? woodTop + 0.05 : woodTop;
      // A flipped chair's back must still clear the floor from the seat below.
      const backTop = Math.min(2 * seatTop - 0.015, design === 1 ? 0.95 : 1.02);
      const postHalf = 0.018;
      const postZ = seatHalf - postHalf;
      const postX = seatHalf - 0.025;
      box([seatHalf * 2, block, seatHalf * 2], [0, seatBottom + block / 2, 0], mats.wood);
      if (padded)
        cushion(
          [seatHalf * 2 - 0.05, 0.05, seatHalf * 2 - 0.06],
          [0, woodTop + 0.025, -0.01],
          design === 2 ? mats.upholstery : mats.fabric,
          0.018,
        );
      for (const x of [-legInset, legInset])
        for (const z of [-legInset, legInset])
          box([legHalf * 2, seatBottom, legHalf * 2], [x, seatBottom / 2, z], mats.wood);
      // Side and front stretchers stiffen the legs and read as real joinery.
      for (const x of [-legInset, legInset])
        box([0.022, 0.024, legInset * 2], [x, 0.15, 0], mats.wood);
      box([legInset * 2, 0.024, 0.022], [0, design === 1 ? 0.15 : 0.22, -legInset], mats.wood);
      if (design === 1) box([legInset * 2, 0.024, 0.022], [0, 0.22, legInset], mats.wood);
      const postHeight = backTop - seatBottom;
      for (const x of [-postX, postX])
        box([postHalf * 2, postHeight, postHalf * 2], [x, seatBottom + postHeight / 2, postZ], mats.wood);
      const span = postX * 2 - postHalf * 2;
      if (design === 0) {
        const slats = 3;
        for (let i = 0; i < slats; i++) {
          const y = backTop - 0.07 - i * ((backTop - seatTop - 0.2) / (slats - 1));
          box([span, 0.058, 0.02], [0, y, postZ], mats.wood);
        }
      } else if (design === 1) {
        const rail = backTop - 0.04;
        const lower = seatTop + 0.13;
        box([span + postHalf * 2, 0.08, 0.03], [0, rail, postZ], mats.wood);
        box([span, 0.03, 0.022], [0, lower, postZ], mats.wood);
        const spindles = 4;
        for (let i = 0; i < spindles; i++) {
          const x = (i - (spindles - 1) / 2) * (span / spindles);
          box([0.02, rail - lower - 0.07, 0.02], [x, (rail + lower) / 2 - 0.02, postZ], mats.wood);
        }
      } else {
        const bottom = seatTop + 0.14;
        const top = backTop - 0.03;
        box([span, 0.045, 0.024], [0, bottom, postZ], mats.wood);
        cushion([span - 0.01, top - bottom - 0.05, 0.036], [0, (top + bottom) / 2 + 0.02, postZ], mats.upholstery, 0.016);
      }
      chairFrame = {
        seatTop,
        seatHalf,
        legInset,
        legHalf,
        backFront: postZ - postHalf,
        backTop,
      };
      anchor.set(0, seatBottom + block / 2, 0);
      break;
    }
    case "officeChair": {
      // Swivel chairs on a five-spoke caster base: armed mid-back, armless
      // task chair, and a tall vinyl manager's chair.
      const seat = design === 2 ? mats.fadedRed : design === 1 ? mats.fabric : mats.upholstery;
      const seatY = vary(0.49, 0.015);
      const reach = design === 2 ? 0.33 : 0.31;
      const spokes = 5;
      const turn = rng() * Math.PI;
      cylinder(0.075, 0.075, 0.07, [0, 0.14, 0], mats.metal);
      cylinder(0.035, 0.05, seatY - 0.2, [0, (seatY + 0.14) / 2 - 0.04, 0], mats.metal);
      cylinder(0.055, 0.055, 0.05, [0, seatY - 0.085, 0], mats.metal);
      for (let i = 0; i < spokes; i++) {
        const angle = turn + (i * Math.PI * 2) / spokes;
        const x = Math.cos(angle) * reach,
          z = Math.sin(angle) * reach;
        strut([0, 0.14, 0], [x, 0.09, z], 0.024, mats.metal);
        box([0.04, 0.03, 0.04], [x, 0.085, z], mats.metal);
        cylinder(0.035, 0.035, 0.05, [x, 0.035, z], mats.metal, [Math.PI / 2, 0, -angle], 10);
      }
      const width = design === 1 ? 0.5 : 0.54;
      const depth = design === 1 ? 0.48 : 0.52;
      box([0.3, 0.035, 0.3], [0, seatY - 0.075, 0.01], mats.metal);
      cushion([width, 0.11, depth], [0, seatY, 0], seat, 0.04);
      // An L-shaped spine carries the back from under the seat.
      const backZ = depth / 2 + 0.03;
      box([0.06, 0.03, backZ], [0, seatY - 0.075, backZ / 2], mats.metal);
      const backBottom = seatY + 0.14;
      const backHeight = design === 2 ? 0.66 : design === 1 ? 0.34 : 0.42;
      box([0.055, backBottom - seatY + 0.14, 0.035], [0, seatY + (backBottom - seatY) / 2, backZ], mats.metal);
      cushion(
        [width - (design === 1 ? 0.06 : 0.03), backHeight, 0.1],
        [0, backBottom + backHeight / 2, backZ + 0.015],
        seat,
        0.045,
        [0.07, 0, 0],
      );
      if (design !== 1) {
        // Brackets tie each arm post into the seat pan instead of floating.
        const armX = width / 2 + 0.045;
        for (const x of [-armX, armX]) {
          box([armX - 0.1, 0.028, 0.06], [Math.sign(x) * (armX + 0.1) / 2, seatY - 0.075, 0.03], mats.metal);
          box([0.036, 0.26, 0.05], [x, seatY + 0.045, 0.03], mats.metal);
          cushion([0.07, 0.045, 0.3], [x, seatY + 0.19, 0.0], design === 2 ? seat : mats.fabric, 0.02);
        }
      }
      anchor.set(0, seatY, 0);
      break;
    }
    case "foldingChair": {
      // Steel folding chairs with vinyl, enamel, or slatted wooden seats.
      const seatMat = design === 1 ? mats.cream : mats.fadedRed;
      const half = 0.23;
      for (const x of [-half, half]) {
        strut([x, 0.02, -0.27], [x, 0.9, 0.2], 0.019, mats.metal);
        strut([x, 0.02, 0.28], [x, 0.45, -0.17], 0.019, mats.metal);
        box([0.045, 0.035, 0.06], [x, 0.0175, -0.27], mats.metal);
        box([0.045, 0.035, 0.06], [x, 0.0175, 0.28], mats.metal);
      }
      // Cross rails keep the two side frames visibly joined.
      strut([-half, 0.16, 0.19], [half, 0.16, 0.19], 0.014, mats.metal);
      strut([-half, 0.13, -0.2], [half, 0.13, -0.2], 0.014, mats.metal);
      box([half * 2 + 0.04, 0.025, 0.42], [0, 0.425, -0.01], mats.metal);
      if (design === 2) {
        for (let i = 0; i < 4; i++)
          box([half * 2 + 0.02, 0.028, 0.095], [0, 0.451, -0.18 + i * 0.113], mats.wood);
        for (let i = 0; i < 3; i++)
          box([half * 2 - 0.04, 0.08, 0.02], [0, 0.66 + i * 0.1, 0.12 + i * 0.013], mats.wood, [0.13, 0, 0]);
      } else {
        cushion([half * 2 + 0.03, 0.055, 0.44], [0, 0.46, -0.01], seatMat, 0.022);
        cushion([half * 2, 0.24, 0.045], [0, 0.76, 0.15], seatMat, 0.02, [0.13, 0, 0]);
      }
      anchor.set(0, 0.43, 0);
      break;
    }
    case "plasticChair": {
      // Monobloc chairs: panel back, slotted back, and a low armchair.
      const color = design === 1 ? mats.cream : design === 2 ? mats.fadedRed : mats.enamel;
      const seatY = vary(0.45, 0.01);
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          strut([x * 0.25, 0.02, z * 0.25], [x * 0.2, seatY - 0.03, z * 0.2], 0.034, color);
      // A molded skirt joins the legs just under the seat.
      for (const z of [-0.23, 0.23]) box([0.44, 0.06, 0.022], [0, seatY - 0.06, z], color);
      for (const x of [-0.23, 0.23]) box([0.022, 0.06, 0.44], [x, seatY - 0.06, 0], color);
      cushion([0.53, 0.06, 0.52], [0, seatY, 0], color, 0.03);
      for (const x of [-0.22, 0.22])
        cushion([0.07, 0.47, 0.06], [x, seatY + 0.25, 0.25], color, 0.025, [0.1, 0, 0]);
      if (design === 1) {
        for (let i = 0; i < 4; i++)
          cushion([0.44, 0.055, 0.045], [0, seatY + 0.2 + i * 0.085, 0.255 + i * 0.009], color, 0.018, [0.1, 0, 0]);
      } else {
        cushion([0.5, 0.26, 0.06], [0, seatY + 0.4, 0.265], color, 0.03, [0.1, 0, 0]);
      }
      if (design === 2) {
        for (const x of [-0.265, 0.265]) {
          cushion([0.06, 0.04, 0.46], [x, seatY + 0.2, 0.02], color, 0.018);
          strut([x, seatY, -0.18], [x, seatY + 0.19, -0.18], 0.022, color);
        }
      }
      anchor.set(0, seatY, 0);
      break;
    }
    case "sofa": {
      // Two-seat couch, long three-seat couch, and a single vinyl armchair.
      const seats = design === 1 ? 3 : design === 2 ? 1 : 2;
      const cover = design === 2 ? mats.fadedRed : design === 1 ? mats.fabric : mats.upholstery;
      const seatWidth = vary(design === 2 ? 0.72 : 0.78, 0.02);
      const arm = design === 2 ? 0.24 : 0.27;
      const inner = seats * seatWidth;
      const width = inner + arm * 2;
      const depth = vary(0.92, 0.03);
      const lift = design === 1 ? 0.14 : 0.1;
      for (const x of [-width / 2 + 0.1, width / 2 - 0.1])
        for (const z of [-depth / 2 + 0.1, depth / 2 - 0.1]) {
          if (design === 1) cylinder(0.022, 0.032, lift, [x, lift / 2, z], mats.wood);
          else box([0.09, lift, 0.09], [x, lift / 2, z], mats.wood);
        }
      if (seats === 3)
        box([0.07, lift, 0.07], [0, lift / 2, 0], mats.wood);
      cushion([width - 0.04, 0.22, depth], [0, lift + 0.11, 0], cover, 0.06);
      cushion([inner + 0.02, 0.62, 0.22], [0, lift + 0.5, depth / 2 - 0.11], cover, 0.08);
      for (const x of [-(inner + arm) / 2, (inner + arm) / 2])
        cushion([arm, 0.46, depth + 0.02], [x, lift + 0.36, 0], cover, 0.09);
      for (let i = 0; i < seats; i++) {
        const x = (i - (seats - 1) / 2) * seatWidth;
        cushion([seatWidth - 0.015, 0.17, depth - 0.24], [x, lift + 0.305, -0.1], cover, 0.055);
        cushion([seatWidth - 0.03, 0.44, 0.17], [x, lift + 0.6, depth / 2 - 0.3], cover, 0.07, [-0.1, 0, 0]);
        // A shallow welt along each cushion front catches the overhead light.
        box([seatWidth - 0.13, 0.012, 0.014], [x, lift + 0.3, -depth / 2 + 0.017], mats.fabric);
      }
      anchor.set(0, lift + 0.2, -0.1);
      break;
    }
    case "table": {
      if (design === 1) {
        // A folding banquet table on splayed steel legs.
        const w = vary(1.82, 0.06), d = 0.76, top = 0.74;
        for (const x of [-w / 2 + 0.16, w / 2 - 0.16]) {
          strut([x, 0.02, -d / 2 + 0.08], [x, top - 0.05, -0.08], 0.018, mats.metal);
          strut([x, 0.02, d / 2 - 0.08], [x, top - 0.05, 0.08], 0.018, mats.metal);
          box([0.05, 0.02, d - 0.12], [x, 0.012, 0], mats.metal);
          box([0.04, 0.04, 0.5], [x, top - 0.035, 0], mats.metal);
        }
        box([w - 0.3, 0.035, 0.035], [0, top - 0.035, 0], mats.metal);
        box([w, 0.045, d], [0, top - 0.0, 0], mats.cream);
        box([w + 0.012, 0.05, 0.016], [0, top - 0.002, -d / 2], mats.metal);
        box([w + 0.012, 0.05, 0.016], [0, top - 0.002, d / 2], mats.metal);
        anchor.set(0, top, 0);
      } else if (design === 2) {
        // A heavy round meeting table on a cross pedestal.
        const radius = vary(0.6, 0.04), top = 0.76;
        box([0.9, 0.05, 0.1], [0, 0.025, 0], mats.wood);
        box([0.1, 0.05, 0.9], [0, 0.025, 0], mats.wood);
        cylinder(0.075, 0.1, top - 0.1, [0, (top - 0.1) / 2 + 0.03, 0], mats.wood);
        cylinder(radius, radius, 0.06, [0, top - 0.03, 0], mats.wood, undefined, 28);
        cylinder(radius - 0.015, radius - 0.015, 0.012, [0, top + 0.006, 0], mats.cream, undefined, 28);
        anchor.set(0, top - 0.03, 0);
      } else {
        const w = vary(1.78, 0.08), d = vary(1.02, 0.05), top = 0.8;
        const legX = w / 2 - 0.13, legZ = d / 2 - 0.13;
        legFrame(legX, legZ, top - 0.06, 0.085, mats.wood);
        // A recessed apron leaves the legs readable below the overhanging top.
        for (const z of [-legZ, legZ]) box([legX * 2, 0.12, 0.03], [0, top - 0.12, z], mats.wood);
        for (const x of [-legX, legX]) box([0.03, 0.12, legZ * 2], [x, top - 0.12, 0], mats.wood);
        cushion([w, 0.06, d], [0, top - 0.03, 0], mats.wood, 0.02);
        box([w - 0.04, 0.012, d - 0.04], [0, top + 0.006, 0], mats.cream);
        anchor.set(0, top - 0.03, 0);
      }
      break;
    }
    case "filingCabinet": {
      // Four-drawer upright, three-drawer upright, and a low lateral file.
      const drawers = design === 2 ? 2 : design === 1 ? 3 : 4;
      const width = design === 2 ? 0.92 : vary(0.5, 0.03);
      const height = design === 2 ? 0.74 : drawers * 0.32 + 0.1;
      const depth = design === 2 ? 0.5 : 0.62;
      const body = design === 1 ? mats.cream : mats.enamel;
      const front = design === 1 ? mats.enamel : mats.cream;
      box([width - 0.04, 0.06, depth - 0.04], [0, 0.03, 0], mats.metal);
      box([width, height - 0.06, depth], [0, 0.03 + (height - 0.06) / 2, 0], body);
      box([width + 0.012, 0.02, depth + 0.012], [0, height - 0.02, 0], body);
      const pitch = (height - 0.11) / drawers;
      for (let i = 0; i < drawers; i++) {
        const y = 0.07 + pitch * (i + 0.5);
        box([width - 0.06, pitch - 0.03, 0.022], [0, y, -depth / 2 - 0.011], front);
        box([0.17, 0.028, 0.035], [0, y + pitch * 0.18, -depth / 2 - 0.035], mats.metal);
        box([0.1, 0.04, 0.008], [0, y - pitch * 0.12, -depth / 2 - 0.024], mats.paper);
      }
      if (design === 2)
        box([0.3, 0.2, 0.24], [vary(0.12, 0.08), height + 0.1, 0.02], mats.wood);
      anchor.set(0, height / 2, 0);
      break;
    }
    case "bookcase": {
      // Tall open shelving, a narrow shelf crammed with binders, and a low unit.
      const width = design === 1 ? 0.82 : design === 2 ? 1.5 : 1.22;
      const height = design === 2 ? 0.92 : vary(1.85, 0.06);
      const depth = 0.34;
      const shelves = design === 2 ? 3 : 5;
      const side = 0.035;
      box([width, height, 0.02], [0, height / 2, depth / 2 - 0.01], mats.wood);
      for (const x of [-width / 2 + side / 2, width / 2 - side / 2])
        box([side, height, depth], [x, height / 2, 0], mats.wood);
      const levels: number[] = [];
      for (let i = 0; i < shelves; i++) {
        const y = i === 0 ? 0.06 : 0.06 + (i * (height - 0.08)) / (shelves - 1);
        levels.push(y);
        box([width - side * 2, i === 0 ? 0.12 : 0.03, depth - 0.02], [0, i === 0 ? 0.06 : y, -0.01], mats.wood);
      }
      // Binders stand on shelves, never in them: each run starts from a surface.
      const fill = design === 1 ? 0.8 : design === 2 ? 0.45 : 0.28;
      const covers = [mats.fabric, mats.cream, mats.fadedRed, mats.enamel];
      for (let s = 0; s < levels.length - 1; s++) {
        const floor = s === 0 ? 0.12 : levels[s] + 0.015;
        const room = levels[s + 1] - (s + 1 === levels.length - 1 ? 0.015 : 0.015) - floor;
        if (rng() > fill + 0.2) continue;
        let x = -width / 2 + side + 0.02 + rng() * 0.2;
        const end = x + (width - side * 2 - 0.1) * (0.35 + rng() * fill);
        while (x < Math.min(end, width / 2 - side - 0.08)) {
          const thick = 0.04 + rng() * 0.035;
          const tall = Math.min(room - 0.02, 0.24 + rng() * 0.08);
          if (tall < 0.12) break;
          box([thick, tall, 0.24], [x + thick / 2, floor + tall / 2, -0.02], covers[Math.floor(rng() * covers.length)]);
          x += thick + (rng() < 0.15 ? 0.03 : 0.004);
        }
      }
      anchor.set(width / 2 - side / 2, height / 2, 0);
      break;
    }
    case "bench": {
      if (design === 1) {
        // A slatted wooden bench on two cast frames.
        const length = vary(1.7, 0.1);
        for (const x of [-length / 2 + 0.2, length / 2 - 0.2]) {
          box([0.06, 0.42, 0.06], [x, 0.21, -0.17], mats.metal);
          box([0.06, 0.42, 0.06], [x, 0.21, 0.17], mats.metal);
          box([0.06, 0.05, 0.44], [x, 0.4, 0], mats.metal);
          box([0.06, 0.04, 0.44], [x, 0.08, 0], mats.metal);
        }
        for (let i = 0; i < 4; i++)
          box([length, 0.035, 0.1], [0, 0.442, -0.18 + i * 0.12], mats.wood);
        anchor.set(0, 0.4, 0);
      } else {
        // Upholstered waiting benches, with or without a low back.
        const length = vary(1.85, 0.08);
        for (const x of [-length / 2 + 0.22, length / 2 - 0.22]) {
          box([0.065, 0.38, 0.46], [x, 0.21, 0], mats.metal);
          box([0.26, 0.04, 0.54], [x, 0.02, 0], mats.metal);
        }
        box([length - 0.1, 0.04, 0.5], [0, 0.39, 0], mats.metal);
        cushion([length, 0.13, 0.6], [0, 0.475, 0], mats.upholstery, 0.045);
        const segments = design === 2 ? 3 : 4;
        for (let i = 1; i < segments; i++)
          box([0.012, 0.008, 0.52], [(i / segments - 0.5) * length, 0.541, 0], mats.fabric);
        if (design === 2) {
          for (const x of [-length / 2 + 0.22, length / 2 - 0.22])
            box([0.05, 0.42, 0.04], [x, 0.74, 0.27], mats.metal);
          cushion([length - 0.08, 0.3, 0.09], [0, 0.82, 0.29], mats.upholstery, 0.04, [-0.12, 0, 0]);
        }
        anchor.set(0, 0.475, 0);
      }
      break;
    }
    case "sideTable": {
      if (design === 1) {
        // A small round lamp table on a turned pedestal.
        const radius = vary(0.3, 0.03);
        cylinder(0.2, 0.23, 0.04, [0, 0.02, 0], mats.wood, undefined, 20);
        cylinder(0.04, 0.055, 0.5, [0, 0.29, 0], mats.wood);
        ellipsoid([0.12, 0.08, 0.12], [0, 0.34, 0], mats.wood);
        cylinder(radius, radius, 0.05, [0, 0.565, 0], mats.wood, undefined, 24);
        anchor.set(0, 0.3, 0);
      } else if (design === 2) {
        // A boxy nightstand with one drawer and an open cubby.
        const w = 0.5, h = vary(0.6, 0.03), d = 0.44;
        box([w, 0.05, d - 0.04], [0, 0.025, 0.0], mats.wood);
        for (const x of [-w / 2 + 0.015, w / 2 - 0.015]) box([0.03, h - 0.05, d], [x, 0.05 + (h - 0.05) / 2, 0], mats.wood);
        box([w - 0.06, h - 0.05, 0.02], [0, 0.05 + (h - 0.05) / 2, d / 2 - 0.01], mats.wood);
        box([w - 0.06, 0.025, d - 0.02], [0, h * 0.55, -0.01], mats.wood);
        cushion([w + 0.03, 0.035, d + 0.02], [0, h + 0.0175, 0], mats.wood, 0.01);
        box([w - 0.08, h * 0.3, 0.022], [0, h * 0.78, -d / 2 - 0.006], mats.wood);
        box([0.1, 0.022, 0.03], [0, h * 0.8, -d / 2 - 0.03], mats.metal);
        anchor.set(0, h / 2, 0);
      } else {
        const half = vary(0.25, 0.02);
        legFrame(half, half, 0.57, 0.05, mats.wood);
        box([half * 2, 0.035, half * 2], [0, 0.17, 0], mats.wood);
        cushion([half * 2 + 0.16, 0.05, half * 2 + 0.16], [0, 0.595, 0], mats.wood, 0.015);
        box([half * 2 + 0.12, 0.01, half * 2 + 0.12], [0, 0.625, 0], mats.cream);
        anchor.set(0, 0.57, 0);
      }
      break;
    }
    case "utilityCart": {
      // Two- and three-shelf service carts; the third carries paper stock.
      const shelves = design === 1 ? 3 : 2;
      const trays = design === 1 ? mats.metal : mats.enamel;
      const w = 0.86, d = 0.54, top = 0.94;
      for (const x of [-0.39, 0.39])
        for (const z of [-0.23, 0.23]) {
          box([0.05, 0.04, 0.05], [x, 0.105, z], mats.metal);
          cylinder(0.055, 0.055, 0.04, [x, 0.055, z], mats.metal, [0, 0, Math.PI / 2], 14);
          strut([x, 0.12, z], [x, top, z], 0.02, mats.metal);
        }
      for (let i = 0; i < shelves; i++) {
        const y = shelves === 3 ? 0.2 + i * 0.26 : 0.22 + i * 0.46;
        box([w, 0.035, d], [0, y, 0], trays);
        for (const z of [-d / 2 + 0.012, d / 2 - 0.012]) box([w, 0.07, 0.024], [0, y + 0.05, z], trays);
        for (const x of [-w / 2 + 0.012, w / 2 - 0.012]) box([0.024, 0.07, d - 0.048], [x, y + 0.05, 0], trays);
      }
      strut([0.39, top, -0.23], [0.39, top, 0.23], 0.022, mats.metal);
      if (design === 2) {
        box([0.3, 0.13, 0.22], [-0.2, 0.3025, -0.08], mats.paper);
        box([0.3, 0.1, 0.22], [-0.2, 0.4175, -0.07], mats.paper, [0, 0.12, 0]);
        box([0.26, 0.2, 0.3], [0.18, 0.68 + 0.0175 + 0.1, 0.05], mats.wood);
      }
      anchor.set(0, 0.22, 0);
      break;
    }
    case "waterCooler": {
      // An opaque aged bottle keeps the silhouette warm under fluorescent light.
      const bottleless = design === 1;
      const bodyHeight = bottleless ? 1.12 : 0.84;
      const shell = design === 2 ? mats.enamel : mats.cream;
      box([0.46, 0.075, 0.45], [0, 0.0375, 0], mats.metal);
      cushion([0.46, bodyHeight, 0.44], [0, 0.075 + bodyHeight / 2, 0], shell, 0.025);
      const tapY = bottleless ? 0.9 : 0.67;
      box([0.34, 0.26, 0.025], [0, tapY, -0.232], design === 2 ? mats.cream : mats.enamel);
      box([0.3, 0.03, 0.12], [0, tapY - 0.16, -0.27], mats.metal);
      box([0.26, 0.012, 0.1], [0, tapY - 0.14, -0.27], mats.metal);
      for (const x of [-0.08, 0.08]) {
        cylinder(0.022, 0.022, 0.06, [x, tapY, -0.272], mats.metal);
        box([0.04, 0.022, 0.07], [x, tapY + 0.04, -0.255], x < 0 ? mats.fadedRed : mats.metal);
      }
      if (bottleless) {
        box([0.36, 0.05, 0.36], [0, 0.075 + bodyHeight + 0.025, 0], shell);
      } else {
        const top = 0.075 + bodyHeight;
        cylinder(0.1, 0.1, 0.06, [0, top + 0.03, 0], mats.metal);
        cylinder(0.2, 0.09, 0.12, [0, top + 0.12, 0], mats.enamel, undefined, 20);
        cylinder(0.2, 0.2, 0.34, [0, top + 0.35, 0], mats.enamel, undefined, 20);
        cylinder(0.14, 0.2, 0.08, [0, top + 0.56, 0], mats.enamel, undefined, 20);
        cylinder(0.05, 0.05, 0.05, [0, top + 0.625, 0], mats.enamel);
        for (const y of [0.21, 0.35, 0.49])
          cylinder(0.208, 0.208, 0.022, [0, top + y, 0], mats.enamel, undefined, 20);
      }
      // A side-mounted sleeve of stacked paper cups, with no labels or branding.
      box([0.03, 0.08, 0.05], [0.245, 0.9, 0.02], mats.metal);
      cylinder(0.043, 0.036, 0.26, [0.29, 0.8, 0.02], mats.cream);
      anchor.set(0, 0.5, 0);
      break;
    }
    case "photocopier": {
      // A floor copier with sorter tray, a tray-less copier, and a bulky
      // older unit on a cabinet base.
      const w = design === 2 ? 0.8 : 0.85;
      const bodyTop = design === 2 ? 0.62 : 0.78;
      const shell = design === 2 ? mats.cream : mats.enamel;
      const lid = design === 2 ? mats.enamel : mats.cream;
      for (const x of [-w / 2 + 0.07, w / 2 - 0.07])
        for (const z of [-0.28, 0.28])
          box([0.08, 0.1, 0.08], [x, 0.05, z], mats.metal);
      box([w, bodyTop - 0.1, 0.73], [0, 0.1 + (bodyTop - 0.1) / 2, 0], shell);
      const trays = design === 2 ? 1 : design === 1 ? 3 : 2;
      for (let i = 0; i < trays; i++) {
        const y = 0.22 + i * 0.22;
        box([w - 0.1, 0.19, 0.025], [0, y, -0.377], mats.cream);
        box([0.22, 0.03, 0.04], [0, y + 0.04, -0.4], mats.metal);
      }
      const head = design === 2 ? 0.3 : 0.2;
      box([w + 0.08, head, 0.8], [0, bodyTop + head / 2, 0], lid);
      box([w, 0.02, 0.69], [0, bodyTop + head + 0.01, 0.025], mats.metal);
      cushion([w + 0.03, 0.07, 0.7], [0, bodyTop + head + 0.055, 0.025], shell, 0.016);
      const panelY = bodyTop + head - 0.01;
      box([0.31, 0.05, 0.15], [0.23, panelY + 0.015, -0.325], mats.metal);
      box([0.11, 0.008, 0.066], [0.15, panelY + 0.044, -0.325], mats.fabric);
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++)
          box([0.022, 0.012, 0.02], [0.24 + col * 0.035, panelY + 0.046, -0.363 + row * 0.035], mats.cream);
      cylinder(0.028, 0.028, 0.012, [0.36, panelY + 0.046, -0.29], mats.fadedRed);
      // Cooling louvers sit on the side panel, clear of the paper drawers.
      for (let i = 0; i < 5; i++)
        box([0.012, 0.12, 0.026], [w / 2 + 0.006, bodyTop * 0.55, -0.12 + i * 0.05], mats.metal);
      if (design === 0) {
        // The output tray projects from the side and is fully in bounds.
        box([0.32, 0.03, 0.51], [-w / 2 - 0.14, bodyTop - 0.08, 0.04], mats.metal);
        box([0.025, 0.07, 0.51], [-w / 2 - 0.29, bodyTop - 0.06, 0.04], shell);
        box([0.23, 0.02, 0.32], [-w / 2 - 0.15, bodyTop - 0.055, 0.04], mats.paper);
      }
      anchor.set(0, bodyTop / 2, 0);
      break;
    }
    case "archiveCartons": {
      // Two to four record boxes with separate lids, tape and blank labels,
      // stacked squarely on each other's lids.
      const layouts: [number, number, number, number][][] = [
        [[0, 0, 0, 0], [0.07, 1, 0.03, 0.18]],
        [[0, 0, 0, 0], [-0.04, 1, 0.02, -0.12], [0.05, 2, -0.01, 0.2]],
        [[-0.3, 0, 0, 0.03], [0.3, 0, 0.04, -0.04], [0.0, 1, 0.02, 0.1]],
      ];
      let solid = 0;
      for (const [x0, level, z, yaw] of layouts[design]) {
        const width = design === 2 && level === 0 ? 0.52 : vary(0.66, 0.03);
        const depth = 0.5, height = 0.36;
        const bottom = level * (height + 0.048);
        const x = x0 + (rng() - 0.5) * 0.03;
        const rotate = (point: Point): Point => [
          x + point[0] * Math.cos(yaw) + point[2] * Math.sin(yaw),
          bottom + point[1],
          z - point[0] * Math.sin(yaw) + point[2] * Math.cos(yaw),
        ];
        const face: Point = [0, yaw, 0];
        box([width - 0.01, height, depth - 0.01], rotate([0, height / 2, 0]), mats.wood, face);
        box([width + 0.02, 0.05, depth + 0.02], rotate([0, height + 0.015, 0]), mats.cream, face);
        box([0.06, 0.008, depth + 0.024], rotate([0, height + 0.044, 0]), mats.enamel, face);
        box([0.19, 0.09, 0.01], rotate([-0.12, height * 0.5, -depth / 2 - 0.002]), mats.paper, face);
        box([0.12, 0.034, 0.012], rotate([0.14, height * 0.72, -depth / 2 - 0.004]), mats.metal, face);
        if (!solid++) anchor.set(x, height / 2, z);
      }
      break;
    }
    case "lamp": {
      // Standard lamps: cone shade, drum shade, and a tripod reading lamp.
      const shadeMat = lampOn ? mats.lampGlow : mats.cream;
      if (design === 2) {
        for (let i = 0; i < 3; i++) {
          const angle = (i * Math.PI * 2) / 3;
          strut([Math.cos(angle) * 0.3, 0.01, Math.sin(angle) * 0.3], [0, 1.1, 0], 0.016, mats.wood);
        }
        cylinder(0.022, 0.022, 0.4, [0, 1.28, 0], mats.metal);
      } else {
        cylinder(0.24, 0.28, 0.06, [0, 0.03, 0], mats.metal, undefined, 20);
        cylinder(0.03, 0.03, 1.42, [0, 0.77, 0], design === 1 ? mats.metal : mats.wood);
        ellipsoid([0.08, 0.08, 0.08], [0, 0.75, 0], mats.metal);
      }
      cylinder(0.06, 0.04, 0.1, [0, 1.5, 0], mats.metal);
      if (design === 1) {
        cylinder(0.3, 0.3, 0.38, [0, 1.72, 0], shadeMat, undefined, 24);
        cylinder(0.305, 0.305, 0.02, [0, 1.905, 0], mats.upholstery, undefined, 24);
        cylinder(0.305, 0.305, 0.02, [0, 1.535, 0], mats.upholstery, undefined, 24);
      } else {
        const topRadius = design === 2 ? 0.16 : 0.2;
        cylinder(topRadius, 0.4, 0.44, [0, 1.72, 0], shadeMat, undefined, 24);
        cylinder(topRadius + 0.01, topRadius + 0.01, 0.022, [0, 1.94, 0], mats.upholstery, undefined, 24);
        cylinder(0.405, 0.405, 0.022, [0, 1.5, 0], mats.upholstery, undefined, 24);
      }
      ellipsoid([0.08, 0.1, 0.08], [0, 1.99, 0], mats.wood);
      strut([0.11, 1.52, 0], [0.11, 1.24, 0], 0.007, mats.metal);
      anchor.set(0, design === 2 ? 1.28 : 0.03, 0);
      break;
    }
    case "slide": {
      const rails = [mats.fadedRed, mats.enamel, mats.fadedRed][design];
      const deck = [mats.enamel, mats.fadedRed, mats.cream][design];
      const chuteMat = [mats.cream, mats.cream, mats.enamel][design];
      box([0.95, 0.12, 0.7], [0, 1.48, -0.85], deck);
      for (const x of [-0.43, 0.43]) {
        strut([x, 0.04, -0.67], [x, 1.5, -0.67], 0.06, rails);
        strut([x, 0.045, -1.48], [x, 1.91, -1.12], 0.055, rails);
        strut([x, 1.89, -1.12], [x, 1.89, -0.48], 0.055, rails);
        strut([x, 1.89, -0.48], [x, 1.52, -0.48], 0.055, rails);
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
        chuteMat,
        top.add(bottom).multiplyScalar(0.5).toArray() as Point,
      );
      for (const x of [-0.45, 0.45]) {
        strut([x, 1.6, -0.54], [x, 0.27, 1.38], 0.065, deck);
      }
      cushion([0.88, 0.13, 0.36], [0, 0.105, 1.41], chuteMat, 0.035);
      // A broad foot joins the two rails and makes the slide touch the carpet.
      box([1.02, 0.11, 0.28], [0, 0.055, 1.31], rails);
      anchor.set(0, 1.48, -0.85);
      break;
    }
    case "springHorse": {
      const body = [mats.enamel, mats.cream, mats.fadedRed][design];
      const trim = design === 2 ? mats.enamel : mats.fadedRed;
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
      box([0.5, 0.13, 0.36], [0, 0.9, 0], trim);
      ellipsoid([1.18, 0.63, 0.4], [0, 1.2, 0], body);
      ellipsoid([0.39, 0.72, 0.32], [0.39, 1.49, 0], body);
      ellipsoid([0.57, 0.39, 0.35], [0.55, 1.78, 0], body);
      cushion([0.39, 0.21, 0.32], [0.73, 1.71, 0], body, 0.07);
      for (const z of [-0.105, 0.105]) {
        ellipsoid([0.12, 0.29, 0.095], [0.42, 1.99, z], trim);
        ellipsoid(
          [0.07, 0.07, 0.018],
          [0.65, 1.835, z < 0 ? -0.158 : 0.158],
          mats.wood,
        );
      }
      cushion([0.51, 0.11, 0.45], [-0.13, 1.493, 0], trim, 0.035);
      strut([0.37, 1.6, -0.34], [0.37, 1.6, 0.34], 0.035, mats.wood);
      strut([-0.05, 0.97, -0.42], [-0.05, 0.97, 0.42], 0.055, mats.wood);
      for (const x of [-0.34, 0.31]) {
        strut([x, 1.06, -0.09], [x - 0.11, 0.79, -0.09], 0.085, body);
      }
      strut([-0.51, 1.29, 0], [-0.73, 1.01, 0], 0.075, trim);
      anchor.set(0, 1.2, 0);
      break;
    }
    case "blocks": {
      // Giant letter blocks rest face-to-face: two on the carpet and one
      // balanced across both, or a crooked single tower.
      const size = 0.72;
      const half = size / 2;
      const inks = [mats.enamel, mats.fadedRed, mats.fabric];
      const order = [[0, 1, 2], [1, 2, 0], [2, 0, 1]][design];
      const spots: [number, number, number, number][] = design === 2
        ? [[0, half, 0, 0], [0.05, half + size, 0.03, 0.22], [-0.03, half + size * 2, 0.01, -0.18]]
        : [[-0.4, half, 0.08, 0.05], [0.4, half, 0.02, -0.07], [vary(-0.06, 0.08), half + size, 0.05, design === 1 ? 0.45 : 0.12]];
      spots.forEach(([x, y, z, yaw], i) => {
        const color = inks[order[i]];
        const face: Point = [0, yaw, 0];
        const at = (dx: number, dy: number, dz: number): Point => [
          x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
          y + dy,
          z - dx * Math.sin(yaw) + dz * Math.cos(yaw),
        ];
        cushion([size, size, size], [x, y, z], color, 0.045, face);
        box([0.57, 0.57, 0.012], at(0, 0, -half - 0.004), mats.cream, face);
        const front = -half - 0.016;
        const glyph = ["A", "B", "C"][(i + design) % 3];
        // Seen from the front (-Z), the viewer's right is -X: mirror strokes.
        const stroke = (w: number, h: number, dx: number, dy: number, roll = 0) =>
          box([w, h, 0.012], at(-dx, dy, front), color, [0, yaw, -roll]);
        if (glyph === "A") {
          stroke(0.055, 0.38, -0.1, 0, -0.28);
          stroke(0.055, 0.38, 0.1, 0, 0.28);
          stroke(0.19, 0.05, 0, -0.015);
        } else if (glyph === "B") {
          stroke(0.055, 0.38, -0.115, 0);
          for (const dy of [-0.16, 0, 0.16]) stroke(0.22, 0.05, -0.01, dy);
          for (const dy of [-0.08, 0.08]) stroke(0.055, 0.14, 0.1, dy);
        } else {
          stroke(0.055, 0.37, -0.115, 0);
          for (const dy of [-0.16, 0.16]) stroke(0.27, 0.05, 0.005, dy);
        }
      });
      anchor.set(spots[0][0], spots[0][1], spots[0][2]);
      break;
    }
  }

  return { parts, bounds, anchor, ...(chairFrame ? { chair: chairFrame } : {}) };
}
