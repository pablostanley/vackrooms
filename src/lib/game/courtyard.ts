import * as THREE from "three";
import {
  CELL,
  HEIGHT,
  SPAN,
  COURTYARD_STOREY,
  courtyardBounds,
  hash,
  type ChunkData,
} from "./maze";
import type { Materials } from "./materials";
import type { LandmarkBuilder } from "./landmarks";

/** A roofed, five-storey lightwell, with a real ground entrance or sealed gallery. */
export function buildCourtyard(
  data: ChunkData,
  mats: Materials,
  b: LandmarkBuilder,
) {
  const room = data.landmark,
    court = courtyardBounds(room)!;
  const { x: x0, z: z0, width, length, floorY } = court;
  const x = x0 + width / 2,
    z = z0 + length / 2;
  const ox = data.x * SPAN,
    oz = data.z * SPAN;
  const overlook = room.courtyard === "overlook";
  const collider = (
    w: number,
    h: number,
    d: number,
    px: number,
    py: number,
    pz: number,
  ) => {
    b.colliders.push(
      new THREE.Box3(
        new THREE.Vector3(ox + px - w / 2, py - h / 2, oz + pz - d / 2),
        new THREE.Vector3(ox + px + w / 2, py + h / 2, oz + pz + d / 2),
      ),
    );
  };
  const floor = (
    w: number,
    d: number,
    px: number,
    pz: number,
    y: number,
    mat: THREE.Material,
  ) => b.plane(w, d, px, y, pz, mat, -Math.PI / 2);

  floor(width, length, x, z, floorY + 0.009, mats.courtyardPaving);
  // Four quiet lawn rectangles, a cross of pale paths, and a circular wood inset.
  const bedW = (width - 8.4) / 2,
    bedD = (length - 10.4) / 2;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      floor(
        bedW,
        bedD,
        x + sx * (bedW / 2 + 0.8),
        z + sz * (bedD / 2 + 0.8),
        floorY + 0.018,
        mats.courtyardGrass,
      );
  floor(width - 0.4, 3.2, x, z0 + length - 1.7, floorY + 0.013, mats.courtyardWood);
  const circle = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 0.025, 48),
    mats.courtyardWood,
  );
  circle.position.set(ox + x, floorY + 0.03, oz + z);
  circle.receiveShadow = true;
  b.group.add(circle);

  // Low corridors wrap the lightwell. They preserve every maze approach at y=0.
  for (const [px, pz, w, d] of [
    [x, z0 - CELL / 2, width + CELL * 2, CELL],
    [x, z0 + length + CELL / 2, width + CELL * 2, CELL],
    [x0 - CELL / 2, z, CELL, length],
    [x0 + width + CELL / 2, z, CELL, length],
  ]) {
    floor(w, d, px, pz, 0.014, mats.courtyardPaving);
    b.box(w, 0.18, d, px, HEIGHT + 0.09, pz, mats.courtyardWall);
    collider(w, 0.18, d, px, HEIGHT + 0.09, pz);
  }

  for (let side = 0; side < 4; side++) {
    const vertical = side >= 2;
    const run = vertical ? length : width;
    const bays = Math.round(run / CELL);
    const doorBay = Math.floor(bays / 2);
    const faceX = side === 2 ? x0 : side === 3 ? x0 + width : x;
    const faceZ = side === 0 ? z0 : side === 1 ? z0 + length : z;
    const inward = side === 0 || side === 2 ? 1 : -1;
    const box = (
      w: number,
      h: number,
      d: number,
      along: number,
      y: number,
      offset: number,
      mat: THREE.Material,
    ) =>
      b.box(
        vertical ? d : w,
        h,
        vertical ? w : d,
        vertical ? faceX + offset * inward : x0 + along,
        y,
        vertical ? z0 + along : faceZ + offset * inward,
        mat,
      );
    const solid = (w: number, h: number, along: number, y: number) =>
      collider(
        vertical ? 0.3 : w,
        h,
        vertical ? w : 0.3,
        vertical ? faceX : x0 + along,
        y,
        vertical ? z0 + along : faceZ,
      );

    // The overlook's entire facade is solid, including the transparent windows.
    // Ground-level doors line up with the central paths; all other windows seal.
    if (overlook)
      solid(run, room.height - floorY, run / 2, (room.height + floorY) / 2);
    else {
      const opening = 2.8,
        center = (doorBay + 0.5) * CELL;
      const left = center - opening / 2,
        right = run - center - opening / 2;
      solid(left, room.height, left / 2, room.height / 2);
      solid(right, room.height, run - right / 2, room.height / 2);
      solid(opening, room.height - 2.7, center, (room.height + 2.7) / 2);
    }

    for (let level = 0; level < 5; level++) {
      const base = floorY + level * COURTYARD_STOREY;
      for (let bay = 0; bay < bays; bay++) {
        const along = (bay + 0.5) * CELL;
        const liveWindow = overlook && level === 3;
        const door = !overlook && level === 0 && bay === doorBay;
        const openingW = door ? 2.8 : 2.35;
        const sill = door ? 0 : 1;
        const openingH = door ? 2.7 : 1.8;
        const head = sill + openingH;
        const pier = (CELL - openingW) / 2;
        for (const sign of [-1, 1])
          box(
            pier,
            COURTYARD_STOREY,
            0.3,
            along + (sign * (openingW + pier)) / 2,
            base + COURTYARD_STOREY / 2,
            0,
            mats.courtyardWall,
          );
        if (sill)
          box(
            openingW,
            sill,
            0.3,
            along,
            base + sill / 2,
            0,
            mats.courtyardWall,
          );
        box(
          openingW,
          COURTYARD_STOREY - head,
          0.3,
          along,
          base + (head + COURTYARD_STOREY) / 2,
          0,
          mats.courtyardWall,
        );
        if (door) continue;
        // Dark inset frames, curtains with sparse folds, and a few occupied rooms.
        for (const sign of [-1, 1]) {
          box(
            0.075,
            openingH,
            0.14,
            along + sign * (openingW / 2 - 0.035),
            base + sill + openingH / 2,
            0.07,
            mats.metal,
          );
          box(
            openingW,
            0.075,
            0.14,
            along,
            base + sill + (sign > 0 ? openingH - 0.035 : 0.035),
            0.07,
            mats.metal,
          );
        }
        box(
          openingW + 0.12,
          0.055,
          0.38,
          along,
          base + sill - 0.025,
          0.08,
          mats.courtyardPaving,
        );
        if (liveWindow) {
          box(
            openingW - 0.12,
            openingH - 0.12,
            0.025,
            along,
            base + sill + openingH / 2,
            0,
            mats.courtyardGlass,
          );
          box(
            0.035,
            openingH,
            0.09,
            along,
            base + sill + openingH / 2,
            0.08,
            mats.metal,
          );
        } else {
          const warm = hash(side * 31 + bay, level, data.seed + 953) % 13 === 0;
          const curtain = warm ? mats.courtyardWarm : mats.courtyardCurtain;
          box(
            openingW - 0.1,
            openingH - 0.1,
            0.035,
            along,
            base + sill + openingH / 2,
            -0.09,
            curtain,
          );
          for (let fold = -2; fold <= 2; fold++)
            box(
              0.024,
              openingH - 0.14,
              0.018,
              along + fold * 0.36,
              base + sill + openingH / 2,
              -0.064,
              mats.fabric,
            );
          box(
            0.045,
            openingH,
            0.1,
            along + 0.24,
            base + sill + openingH / 2,
            0.015,
            mats.metal,
          );
          if (warm && (bay + level) % 2 === 0)
            box(
              1.15,
              0.06,
              0.025,
              along,
              base + sill + openingH - 0.26,
              -0.045,
              mats.luminous,
            );
        }
      }
      // A restrained horizontal joint gives the stacked floors human scale.
      box(
        run,
        0.025,
        0.015,
        run / 2,
        base + COURTYARD_STOREY - 0.16,
        0.158,
        mats.courtyardPaving,
      );
    }
    box(
      run,
      0.16,
      0.4,
      run / 2,
      room.height - 0.25,
      0.15,
      mats.courtyardPaving,
    );
    box(run, 0.16, 0.38, run / 2, floorY + 0.08, 0.06, mats.courtyardPaving);
  }

  // A few long roof panels, not an office grid. No sky or daylight opening.
  for (const sx of [-1, 1]) {
    const px = x + sx * width * 0.28;
    b.box(0.9, 0.08, length * 0.65, px, room.height - 0.07, z, mats.fixtures);
    b.plane(
      0.74,
      length * 0.65 - 0.2,
      px,
      room.height - 0.115,
      z,
      mats.luminous,
      Math.PI / 2,
    );
  }
  // Shared, bounded fixture slots light the perimeter; no light per window.
  for (const px of [x0 + 0.45, x0 + width - 0.45])
    for (const pz of [z0 + 1.4, z, z0 + length - 1.4]) {
      const y = overlook ? room.height - 0.5 : 3.6;
      b.box(1.1, 0.08, 0.34, px, y, pz, mats.fixtures);
      b.plane(1, 0.28, px, y - 0.05, pz, mats.luminous, Math.PI / 2);
      b.lights.push(new THREE.Vector3(ox + px, y - 0.1, oz + pz));
    }
}
