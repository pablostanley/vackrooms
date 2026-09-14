import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { FurnitureModel } from "./furniture-models";
import type { Materials } from "./materials";

export const computerKinds = [
  "computerDesk",
  "computerCart",
  "computerHutch",
] as const;
export type ComputerKind = (typeof computerKinds)[number];
export function isComputerKind(kind: string): kind is ComputerKind {
  return computerKinds.includes(kind as ComputerKind);
}

/** All three CRTs have the same 4:3 opening, facing local +Z. */
export function computerScreen(kind: ComputerKind) {
  return {
    position: new THREE.Vector3(
      0,
      kind === "computerDesk" ? 1.43 : 1.25,
      0.195,
    ),
    width: 0.68,
    height: 0.51,
  };
}

/** A few recognizable shapes, baked with the other section furniture. */
export function createComputerModel(
  kind: ComputerKind,
  mats: Materials,
): FurnitureModel {
  const parts: FurnitureModel["parts"] = [];
  const bounds = new THREE.Box3();
  type Point = [number, number, number];
  const box = (size: Point, at: Point, mat: THREE.Material, round = 0) => {
    const geometry = round
      ? new RoundedBoxGeometry(...size, 2, round)
      : new THREE.BoxGeometry(...size);
    // RoundedBoxGeometry is non-indexed; section batches require indexed parts.
    if (!geometry.index)
      geometry.setIndex(
        Array.from(
          { length: geometry.getAttribute("position").count },
          (_, i) => i,
        ),
      );
    geometry.translate(...at);
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    parts.push({ geometry, material: mat });
  };
  const desk = kind === "computerDesk";
  const hutch = kind === "computerHutch";
  const wood = desk ? mats.cream : mats.wood;
  const width = hutch ? 2 : desk ? 1.85 : 1.48;
  box([width, 0.075, 0.98], [0, 0.77, 0], wood, 0.012);
  if (desk) {
    // Institutional laminate desk with one modest pedestal of drawers.
    box([0.43, 0.72, 0.85], [-0.66, 0.36, -0.025], mats.cream);
    for (let i = 0; i < 3; i++) {
      box([0.39, 0.205, 0.025], [-0.66, 0.13 + i * 0.23, 0.407], mats.paper);
      box([0.14, 0.022, 0.035], [-0.66, 0.19 + i * 0.23, 0.433], mats.metal);
    }
    for (const z of [-0.39, 0.39])
      box([0.055, 0.735, 0.055], [0.82, 0.3675, z], mats.metal);
    box([1.45, 0.3, 0.035], [0.1, 0.52, -0.42], mats.cream);
  } else {
    for (const x of [-width / 2 + 0.065, width / 2 - 0.065]) {
      box([0.09, 0.735, 0.91], [x, 0.3675, 0], wood);
      if (hutch) box([0.075, 1.1, 0.42], [x, 1.35, -0.24], wood);
    }
    box([width - 0.1, 0.12, 0.045], [0, 0.21, -0.42], wood);
    box([1.15, 0.035, 0.41], [0, 0.68, 0.37], wood, 0.006);
    if (hutch) {
      box([width, 0.075, 0.44], [0, 1.9, -0.24], wood);
      for (let i = 0; i < 4; i++)
        box(
          [0.065, 0.23 + (i % 2) * 0.04, 0.22],
          [-0.82 + i * 0.073, 1.97 + 0.115 + (i % 2) * 0.02, -0.24],
          i % 2 ? mats.fabric : mats.paper,
        );
      box([0.38, 0.05, 0.29], [0.71, 0.84, -0.1], mats.paper);
    }
  }
  // Horizontal system unit versus a tower underneath the desk.
  const towerX = hutch ? 0.7 : -0.48;
  if (desk) {
    box([0.91, 0.18, 0.67], [0, 0.9, -0.1], mats.cream, 0.008);
    box([0.31, 0.052, 0.016], [0.23, 0.933, 0.242], mats.paper);
    box([0.24, 0.01, 0.02], [0.23, 0.936, 0.251], mats.metal);
    for (let i = 0; i < 7; i++)
      box([0.017, 0.085, 0.013], [-0.36 + i * 0.034, 0.89, 0.24], mats.metal);
  } else {
    box([0.3, 0.58, 0.52], [towerX, 0.3, -0.03], mats.cream, 0.013);
    for (const y of [0.46, 0.52])
      box([0.25, 0.045, 0.02], [towerX, y, 0.238], mats.paper);
    box([0.2, 0.012, 0.023], [towerX, 0.465, 0.248], mats.metal);
    box([0.028, 0.028, 0.021], [towerX + 0.08, 0.37, 0.242], mats.metal);
    for (let i = 0; i < 6; i++)
      box([0.22, 0.012, 0.016], [towerX, 0.1 + i * 0.029, 0.238], mats.metal);
  }
  const { position: screen } = computerScreen(kind);
  const y = screen.y;
  box([0.48, 0.055, 0.4], [0, y - 0.406, -0.09], mats.cream, 0.018);
  box([0.19, 0.12, 0.18], [0, y - 0.36, -0.12], mats.cream, 0.018);
  // Deep tapered back, chunky rim, inset glass, lower controls, ventilation.
  box([0.67, 0.54, 0.4], [0, y, -0.25], mats.cream, 0.045);
  box([0.84, 0.65, 0.23], [0, y, -0.015], mats.cream, 0.025);
  box([0.714, 0.544, 0.018], [0, y, 0.177], mats.metal, 0.008);
  box([0.68, 0.51, 0.012], [0, y, 0.185], mats.darkness);
  for (const x of [-0.395, 0.395])
    box([0.105, 0.64, 0.13], [x, y, 0.126], mats.cream, 0.015);
  box([0.85, 0.075, 0.13], [0, y + 0.299, 0.126], mats.cream, 0.013);
  box([0.85, 0.115, 0.13], [0, y - 0.319, 0.126], mats.cream, 0.013);
  box([0.035, 0.021, 0.012], [0.32, y - 0.318, 0.197], mats.metal, 0.003);
  box([0.015, 0.009, 0.012], [0.274, y - 0.318, 0.198], mats.luminous);
  for (let i = 0; i < 9; i++)
    box(
      [0.022, 0.17, 0.012],
      [-0.28 + i * 0.068, y + 0.04, -0.455],
      mats.metal,
    );
  // Chunky keycaps and a wired mouse; no textures or logos needed.
  const ky = desk ? 0.83 : 0.724;
  const kz = desk ? 0.34 : 0.43;
  box([0.71, 0.04, 0.235], [-0.05, ky, kz], mats.cream, 0.008);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 13; col++) {
      box(
        [0.039, 0.018, 0.035],
        [-0.355 + col * 0.048, ky + 0.028, kz - 0.076 + row * 0.045],
        col === 0 || row === 0 ? mats.paper : mats.cream,
      );
    }
  box(
    [0.24, 0.018, 0.025],
    [-0.075, ky + 0.028, kz + 0.098],
    mats.cream,
    0.003,
  );
  box([0.14, 0.014, 0.2], [0.48, ky - 0.01, kz], mats.fabric, 0.008);
  box([0.081, 0.042, 0.122], [0.48, ky + 0.016, kz], mats.cream, 0.016);
  box([0.004, 0.007, 0.045], [0.48, ky + 0.038, kz - 0.029], mats.paper);
  if (!desk)
    for (const x of [-0.56, 0.56]) {
      box([0.14, 0.25, 0.15], [x, 0.93, -0.015], mats.cream, 0.009);
      box([0.104, 0.17, 0.012], [x, 0.95, 0.066], mats.fabric, 0.006);
    }
  return { parts, bounds, anchor: new THREE.Vector3(0, 0.77, 0) };
}
