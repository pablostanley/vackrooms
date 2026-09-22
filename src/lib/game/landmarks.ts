import * as THREE from "three";
import {
  CELL,
  CHUNK,
  N,
  E,
  S,
  W,
  hash,
  inLandmark,
  poolBounds,
  type ChunkData,
} from "./maze";
import type { Materials } from "./materials";
import { buildCourtyard } from "./courtyard";
import { buildHotelCorridor } from "./hotel-corridor";
import { buildNeighborhood } from "./neighborhood";

export interface LandmarkBuilder {
  box: (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => void;
  plane: (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx: number,
    ry?: number,
    repeat?: number,
  ) => void;
  group: THREE.Group;
  lights: THREE.Vector3[];
  colliders: THREE.Box3[];
  water: THREE.Mesh[];
}

/** Large silhouettes and a few perimeter fixtures leave the walking floor empty. */
export function buildLandmark(data: ChunkData, mats: Materials, b: LandmarkBuilder) {
  const room = data.landmark;
  const x0 = room.x * CELL,
    z0 = room.z * CELL;
  const width = room.width * CELL,
    length = room.length * CELL;
  const x = x0 + width / 2,
    z = z0 + length / 2;
  const ox = data.x * CHUNK * CELL,
    oz = data.z * CHUNK * CELL;
  b.group.userData.landmark = room;
  if (room.kind === "courtyard") {
    buildCourtyard(data, mats, b);
    return;
  }
  if (room.kind === "neighborhood") {
    buildNeighborhood(data, mats, b);
    return;
  }
  const solid = (
    w: number,
    h: number,
    d: number,
    px: number,
    py: number,
    pz: number,
    mat: THREE.Material,
  ) => {
    b.box(w, h, d, px, py, pz, mat);
    b.colliders.push(
      new THREE.Box3(
        new THREE.Vector3(ox + px - w / 2, py - h / 2, oz + pz - d / 2),
        new THREE.Vector3(ox + px + w / 2, py + h / 2, oz + pz + d / 2),
      ),
    );
  };

  if (room.kind === "levelFun") {
    b.plane(width, length, x, 0, z, mats.funCarpet, -Math.PI / 2);
    let murals = 0;
    let table = false;
    const offset = hash(data.x, data.z, 6113) % mats.funMurals.length;
    for (let cz = room.z; cz < room.z + room.length; cz++)
      for (let cx = room.x; cx < room.x + room.width; cx++) {
        const bits = data.cells[cz * CHUNK + cx];
        for (const [bit, dx, dz, angle] of [
          [N, 0, -1, 0],
          [E, 1, 0, -Math.PI / 2],
          [S, 0, 1, Math.PI],
          [W, -1, 0, Math.PI / 2],
        ]) {
          if (inLandmark(room, cx + dx, cz + dz)) continue;
          const px = (cx + 0.5 + dx * 0.5) * CELL;
          const pz = (cz + 0.5 + dz * 0.5) * CELL;
          if (bits & bit) {
            // Frame the open maze edges as broad doorways, with real Rapier
            // solids and a 2m-wide central walking lane through every gate.
            const jamb = (CELL - 2) / 2;
            for (const side of [-1, 1]) {
              const jx = px + (dz ? (side * (CELL + 2)) / 4 : 0);
              const jz = pz + (dx ? (side * (CELL + 2)) / 4 : 0);
              solid(
                dx ? 0.18 : jamb,
                room.height,
                dx ? jamb : 0.18,
                jx,
                room.height / 2,
                jz,
                mats.funWall,
              );
              b.box(
                dx ? 0.23 : jamb,
                0.21,
                dx ? jamb : 0.23,
                jx,
                0.105,
                jz,
                mats.funTrim,
              );
            }
            solid(
              dx ? 0.18 : 2,
              room.height - 2.5,
              dx ? 2 : 0.18,
              px,
              (room.height + 2.5) / 2,
              pz,
              mats.funWall,
            );
            b.plane(
              CELL,
              0.085,
              px - dx * 0.113,
              room.height - 0.28,
              pz - dz * 0.113,
              mats.funStripe,
              0,
              angle,
            );
            continue;
          }
          // Skin only the room-facing side of an existing closed wall. Its
          // reverse remains the office finish; every maze entrance stays open.
          b.plane(
            CELL,
            room.height,
            px - dx * 0.101,
            room.height / 2,
            pz - dz * 0.101,
            mats.funWall,
            0,
            angle,
          );
          b.plane(
            CELL,
            0.21,
            px - dx * 0.126,
            0.105,
            pz - dz * 0.126,
            mats.funTrim,
            0,
            angle,
          );
          b.plane(
            CELL,
            0.085,
            px - dx * 0.113,
            room.height - 0.28,
            pz - dz * 0.113,
            mats.funStripe,
            0,
            angle,
          );
          // Leave breathing room between life-sized painted characters.
          if (murals < 6) {
            b.plane(
              2.85,
              2.85,
              px - dx * 0.117,
              1.48,
              pz - dz * 0.117,
              mats.funMurals[(murals + offset) % mats.funMurals.length],
              0,
              angle,
            );
            murals++;
          }
          if (!table) {
            const tx = px - dx * 0.55,
              tz = pz - dz * 0.55;
            const tw = dx ? 0.62 : 2.8,
              td = dx ? 2.8 : 0.62;
            solid(tw, 0.09, td, tx, 0.74, tz, mats.wood);
            for (const sx of [-1, 1])
              for (const sz of [-1, 1])
                solid(
                  0.045,
                  0.695,
                  0.045,
                  tx + sx * (tw / 2 - 0.12),
                  0.3475,
                  tz + sz * (td / 2 - 0.12),
                  mats.metal,
                );
            table = true;
          }
        }
      }
    return;
  }

  if (room.kind === "corridor") {
    if (room.corridor === "hotel") buildHotelCorridor(data, mats, b);
    // Repeated shallow ribs reveal the uninterrupted 172.8m perspective. Every
    // rib stops above head height; the two section seams contain no cross-wall.
    for (let cx = 0; cx < CHUNK; cx += 2)
      b.box(
        0.16,
        0.24,
        CELL,
        (cx + 0.5) * CELL,
        room.height - 0.12,
        z,
        mats.cream,
      );
    return;
  }

  if (room.kind === "lobby") {
    // A huge empty carpet, high soffits, and just four structural columns.
    for (const px of [x0 + 0.7, x0 + width - 0.7])
      for (const pz of [z0 + CELL + 0.7, z0 + length - CELL - 0.7]) {
        solid(0.75, room.height, 0.75, px, room.height / 2, pz, mats.cream);
        b.box(0.85, 0.14, 0.85, px, 0.07, pz, mats.trim);
      }
    b.box(width, 0.5, 0.65, x, room.height - 0.25, z0 + 0.4, mats.cream);
    b.box(
      width,
      0.5,
      0.65,
      x,
      room.height - 0.25,
      z0 + length - 0.4,
      mats.cream,
    );
    return;
  }

  const basin = poolBounds(room);
  if (basin) {
    // Smooth plaster and poured flooring, without tile grids or blue hues.
    const deck = (px: number, pz: number, w: number, d: number) =>
      b.plane(w, d, px + w / 2, 0.012, pz + d / 2, mats.cream, -Math.PI / 2);
    deck(x0, z0, width, basin.z - z0);
    deck(
      x0,
      basin.z + basin.length,
      width,
      z0 + length - basin.z - basin.length,
    );
    deck(x0, basin.z, basin.x - x0, basin.length);
    deck(
      basin.x + basin.width,
      basin.z,
      x0 + width - basin.x - basin.width,
      basin.length,
    );
    b.plane(
      basin.width,
      basin.length,
      x,
      -1.4,
      z,
      mats.tileFloor,
      -Math.PI / 2,
    );
    // Coping blocks accidental walking entry but can be jumped onto. The motor
    // gives basin takeoffs enough lift to clear the 1.84m rise with one press.
    for (const side of [-1, 1]) {
      solid(
        0.36,
        1.84,
        basin.length + 0.36,
        x + (side * basin.width) / 2,
        -0.48,
        z,
        mats.cream,
      );
      solid(
        basin.width,
        1.84,
        0.36,
        x,
        -0.48,
        z + (side * basin.length) / 2,
        mats.cream,
      );
    }
    // Pool-bottom lane marks give the water depth and human scale.
    for (let lane = -2; lane <= 2; lane++) {
      b.plane(0.13, 21, x + lane * 2.5, -1.385, z, mats.trim, -Math.PI / 2);
      for (const side of [-1, 1])
        b.plane(
          1.1,
          0.13,
          x + lane * 2.5,
          -1.38,
          z + side * 10.5,
          mats.trim,
          -Math.PI / 2,
        );
    }
    const geometry = new THREE.PlaneGeometry(
      basin.width - 0.36,
      basin.length - 0.36,
      48,
      72,
    );
    geometry.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geometry, mats.tileFloor);
    water.name = "pool-water";
    water.position.set(ox + x, -0.18, oz + z);
    water.userData.ceiling = room.height;
    water.receiveShadow = true;
    b.group.add(water);
    b.water.push(water);
    // Two narrow benches at the perimeter; the rest of the hall stays vacant.
    for (const pz of [z0 + CELL + 0.6, z0 + length - CELL - 0.6])
      solid(3, 0.42, 0.65, x0 + CELL * 0.5, 0.21, pz, mats.cream);
    return;
  }

  // Food court: blank fascia, shuttered hatches, service counters, two lonely
  // tables. Only closed perimeter walls get stalls, so no entrance is covered.
  b.plane(width, length, x, 0.012, z, mats.cream, -Math.PI / 2);
  let stalls = 0;
  for (let cx = room.x; cx < room.x + room.width; cx++) {
    if (!(data.cells[room.z * CHUNK + cx] & N)) {
      const px = (cx + 0.5) * CELL;
      solid(3.3, 1.02, 1.05, px, 0.51, z0 + 0.65, mats.cream);
      b.box(3.5, 0.08, 1.2, px, 1.06, z0 + 0.65, mats.trim);
      b.box(3.4, 1.7, 0.06, px, 2, z0 + 0.13, mats.fixtures);
      for (let slat = 0; slat < 12; slat++)
        b.box(3.4, 0.023, 0.08, px, 1.23 + slat * 0.14, z0 + 0.17, mats.trim);
      b.box(
        3.7,
        0.68,
        0.35,
        px,
        3.45,
        z0 + 0.3,
        stalls++ % 2 ? mats.enamel : mats.cream,
      );
    }
  }
  const right = room.x + room.width - 1;
  for (let cz = room.z + 1; cz < room.z + room.length - 1; cz += 2) {
    if (data.cells[cz * CHUNK + right] & E) continue;
    const pz = (cz + 0.5) * CELL;
    solid(0.9, 1.05, 3.2, x0 + width - 0.6, 0.525, pz, mats.cream);
    b.box(0.1, 1.75, 3.2, x0 + width - 0.15, 2, pz, mats.fixtures);
    b.box(0.35, 0.68, 3.6, x0 + width - 0.3, 3.45, pz, mats.enamel);
  }
  for (const [px, pz] of [
    [x0 + CELL + 0.75, z0 + length - CELL - 0.75],
    [x0 + CELL * 2 + 0.75, z0 + CELL * 3 + 0.75],
  ]) {
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.075, 20),
      mats.enamel,
    );
    table.position.set(ox + px, 0.77, oz + pz);
    table.castShadow = table.receiveShadow = true;
    b.group.add(table);
    solid(0.14, 0.73, 0.14, px, 0.365, pz, mats.metal);
    // Include the tabletop in collision without filling a central walking lane.
    b.colliders.push(
      new THREE.Box3(
        new THREE.Vector3(ox + px - 0.6, 0.72, oz + pz - 0.6),
        new THREE.Vector3(ox + px + 0.6, 0.81, oz + pz + 0.6),
      ),
    );
  }
}
