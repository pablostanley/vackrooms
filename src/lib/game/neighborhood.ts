import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CELL,
  CHUNK,
  HEIGHT,
  SPAN,
  N,
  E,
  S,
  W,
  hash,
  inLandmark,
  type ChunkData,
  type Landmark,
} from "./maze";
import type { Materials } from "./materials";
import type { LandmarkBuilder } from "./landmarks";
import { projectSurfaceUVs } from "./surface-textures";

// Cross-section from either long wall toward the centerline, in meters.
export const HOUSE_DEPTH = 3.5;
const YARD = 7.6;
const WALK = 9.4;
const EAVE = 2.75;
// Within the character controller's 0.28m autostep.
const STOOP = 0.26;

export interface HouseLot {
  side: -1 | 1;
  /** First street row and the number of 4.8m rows the lot spans. */
  row: number;
  rows: 1 | 2;
  style: number;
}

/**
 * Houses only stand against closed wall. Every maze opening on a long side stays
 * a gap between lots, so each entrance arrives onto the street through an alley.
 */
export function houseLots(data: ChunkData): HouseLot[] {
  const room = data.landmark;
  const lots: HouseLot[] = [];
  for (const side of [-1, 1] as const) {
    const column = side < 0 ? room.x : room.x + room.width - 1;
    // A doorway in an end wall may land in a house column; that corner stays
    // open lawn, since a house would leave only a choked strip beside it.
    const closed = (row: number) => {
      if (row >= room.length) return false;
      const bits = data.cells[(room.z + row) * CHUNK + column];
      return !(
        bits & (side < 0 ? W : E) ||
        (row === 0 && bits & N) ||
        (row === room.length - 1 && bits & S)
      );
    };
    for (let row = 0; row < room.length; ) {
      if (!closed(row)) {
        row++;
        continue;
      }
      const style = hash(row * 2 + (side + 1), 17, data.seed + 1297);
      const rows = closed(row + 1) && style % 4 ? 2 : 1;
      lots.push({ side, row, rows, style });
      row += rows;
    }
  }
  return lots;
}

/** Ridge along z at x=0. Each eave may overhang below the wall plate. */
function slopes(back: number, front: number, slope: number, length: number) {
  const l = length / 2,
    rise = slope * back,
    y = rise - slope * front;
  // Two unshared quads, so each slope keeps a flat normal.
  const p = [
    [-back, 0, -l], [-back, 0, l], [0, rise, l],
    [-back, 0, -l], [0, rise, l], [0, rise, -l],
    [front, y, l], [front, y, -l], [0, rise, -l],
    [front, y, l], [0, rise, -l], [0, rise, l],
  ].flat();
  return finish(p);
}
function gables(base: number, rise: number, length: number) {
  const b = base / 2,
    l = length / 2;
  const p = [
    [-b, 0, l], [b, 0, l], [0, rise, l],
    [b, 0, -l], [-b, 0, -l], [0, rise, -l],
  ].flat();
  return finish(p);
}
function finish(positions: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** A warehouse-high hall painted sky blue, with a street of sealed house fronts. */
export function buildNeighborhood(
  data: ChunkData,
  mats: Materials,
  b: LandmarkBuilder,
) {
  const room = data.landmark;
  const x0 = room.x * CELL,
    z0 = room.z * CELL;
  const width = room.width * CELL,
    length = room.length * CELL;
  const x = x0 + width / 2,
    z = z0 + length / 2;
  const ox = data.x * SPAN,
    oz = data.z * SPAN;
  const solid = (
    w: number,
    h: number,
    d: number,
    px: number,
    py: number,
    pz: number,
  ) =>
    b.colliders.push(
      new THREE.Box3(
        new THREE.Vector3(ox + px - w / 2, py - h / 2, oz + pz - d / 2),
        new THREE.Vector3(ox + px + w / 2, py + h / 2, oz + pz + d / 2),
      ),
    );
  const ground = (
    w: number,
    d: number,
    px: number,
    pz: number,
    y: number,
    mat: THREE.Material,
  ) => b.plane(w, d, px, y, pz, mat, -Math.PI / 2);

  skinWalls(data, room, mats, b);

  // Asphalt wall to wall, then raised walks; lawns are laid per lot below.
  ground(width, length, x, z, 0.008, mats.streetAsphalt);
  for (const side of [-1, 1]) {
    const edge = side < 0 ? x0 : x0 + width;
    const walk = WALK - YARD;
    // A shallow visual curb: anything taller would fence entities off the road.
    b.box(walk, 0.07, length, edge - side * (YARD + walk / 2), 0.035, z, mats.courtyardPaving);
    ground(YARD, length, edge - side * (YARD / 2), z, 0.014, mats.courtyardPaving);
  }
  // A worn center line, broken where a real crew would have stopped painting.
  for (let pz = z0 + 2.4; pz < z0 + length - 2; pz += 4.8)
    if (hash(Math.round(pz), 3, data.seed + 1301) % 5)
      ground(0.14, 2.6, x, pz, 0.012, mats.streetTrim);

  const roofs: THREE.BufferGeometry[] = [];
  const ends = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const lot of houseLots(data)) {
    const { side, style } = lot;
    const edge = side < 0 ? x0 : x0 + width;
    const inward = -side;
    const lotLength = lot.rows * CELL;
    const center = z0 + lot.row * CELL + lotLength / 2;
    const siding = mats.streetSiding[style % mats.streetSiding.length];
    // Depth is measured from the blue wall; along runs down the street.
    const part = (
      along: number,
      h: number,
      depth: number,
      at: number,
      y: number,
      from: number,
      mat: THREE.Material,
    ) => b.box(depth, h, along, edge + inward * (from + depth / 2), y, center + at, mat);
    const houseLength = lotLength - 1.5;
    const front = HOUSE_DEPTH;

    ground(YARD - 0.1, lotLength, edge + inward * (YARD / 2 + 0.05), center, 0.02, mats.streetGrass);
    part(houseLength, EAVE, front - 0.1, 0, EAVE / 2, 0.1, siding);
    solid(front, EAVE, houseLength, edge + inward * (front / 2), EAVE / 2, center);
    part(houseLength + 0.06, STOOP, front - 0.07, 0, STOOP / 2, 0.1, mats.courtyardPaving);
    for (const end of [-1, 1])
      part(0.12, EAVE, 0.12, end * (houseLength / 2 - 0.05), EAVE / 2, front - 0.1, mats.streetTrim);

    // Wide lots keep a garage at one end and turn their ridge along the street
    // about half the time; narrow cottages always show a gable to the road.
    const wide = lot.rows === 2;
    const gableFront = !wide || (style >>> 3) % 2 === 0;
    const flip = (style >>> 4) % 2 ? 1 : -1;
    const over = 0.38;
    const span = gableFront ? houseLength : front;
    const rise = gableFront ? Math.min(2.3, houseLength * 0.3) : 1.3;
    const slope = rise / (span / 2);
    // Eaves continue the pitch past the wall plate, so they hang below it. A
    // street-parallel roof has no back overhang: it dies into the blue wall.
    const roof = gableFront
      ? slopes(span / 2 + over, span / 2 + over, slope, front + over)
      : slopes(span / 2, span / 2 + over, slope, houseLength + over * 2);
    const gable = gables(span - 0.02, rise, gableFront ? front - 0.12 : houseLength);
    const siblings = ends.get(siding) ?? ends.set(siding, []).get(siding)!;
    for (const [geometry, from, y, list] of [
      [roof, gableFront ? (front + over) / 2 : front / 2, EAVE + (gableFront ? -slope * over : 0), roofs],
      [gable, gableFront ? front / 2 + 0.05 : front / 2, EAVE, siblings],
    ] as const) {
      geometry.rotateY(gableFront ? Math.PI / 2 : inward > 0 ? 0 : Math.PI);
      geometry.translate(ox + edge + inward * from, y, oz + center);
      list.push(geometry);
    }
    // The slope vertices enclose a triangular prism. Reuse the transformed
    // roof itself so both ridge orientations and their eaves block jumping.
    // Keep the ground-level house box for navigation and wall collision.
    roof.computeBoundingBox();
    b.shapedColliders.push({
      bounds: roof.boundingBox!.clone(),
      parts: [new Float32Array(roof.getAttribute("position").array)],
    });
    const eaveY = EAVE - slope * over - 0.03;
    if (gableFront)
      for (const end of [-1, 1])
        part(0.14, 0.16, front + over, end * (span / 2 + over - 0.07), eaveY, 0, mats.streetTrim);
    else
      part(houseLength + over * 2, 0.16, 0.14, 0, eaveY, front + over - 0.14, mats.streetTrim);

    const opening = (
      w: number,
      h: number,
      at: number,
      sill: number,
      fill: THREE.Material,
      frame = 0.09,
    ) => {
      part(w + frame * 2, h + frame * 2, 0.05, at, sill + h / 2, front, mats.streetTrim);
      part(w, h, 0.03, at, sill + h / 2, front + 0.04, fill);
    };
    const window = (at: number, w: number, slot: number) => {
      const lit = hash(lot.row, slot + (side + 1) * 7, data.seed + 1303) % 6 === 0;
      opening(w, 1.15, at, 0.95, lit ? mats.courtyardWarm : mats.courtyardCurtain);
      part(0.05, 1.15, 0.03, at, 0.95 + 0.575, front + 0.06, mats.streetTrim);
      part(w, 0.05, 0.03, at, 0.95 + 0.575, front + 0.06, mats.streetTrim);
      part(w + 0.3, 0.06, 0.14, at, 0.92, front, mats.streetTrim);
    };

    const doorAt = wide ? flip * -1.1 : flip * -0.75;
    const doorMat = [mats.fadedRed, mats.wood, mats.streetTrim][(style >>> 6) % 3];
    opening(0.92, 2.05, doorAt, STOOP, doorMat, 0.08);
    part(0.06, 0.06, 0.06, doorAt + 0.34, 1.3, front + 0.07, mats.fixtures);
    part(1.5, STOOP, 0.9, doorAt, STOOP / 2, front, mats.courtyardPaving);
    solid(0.9, STOOP, 1.5, edge + inward * (front + 0.45), STOOP / 2, center + doorAt);
    // Porch lamps are the street's only low fixtures: one per wide house.
    part(0.2, 0.16, 0.12, doorAt, 2.56, front, mats.fixtures);
    part(0.14, 0.1, 0.02, doorAt, 2.55, front + 0.12, mats.luminous);
    if (wide)
      b.lights.push(
        new THREE.Vector3(edge + inward * (front + 0.6) + ox, 2.55, center + doorAt + oz),
      );

    const walkTo = YARD - front - 0.9;
    ground(walkTo, 1.1, edge + inward * (front + 0.9 + walkTo / 2), center + doorAt, 0.026, mats.courtyardPaving);

    let driveway: [number, number] | null = null;
    if (wide) {
      const garageAt = flip * (houseLength / 2 - 1.85);
      opening(2.7, 2.1, garageAt, 0.02, mats.streetTrim, 0.1);
      for (let panel = 1; panel < 4; panel++)
        part(2.7, 0.025, 0.02, garageAt, 0.02 + panel * 0.525, front + 0.07, mats.courtyardPaving);
      const run = YARD - front;
      ground(run, 3.1, edge + inward * (front + run / 2), center + garageAt, 0.026, mats.courtyardPaving);
      driveway = [garageAt - 1.55, garageAt + 1.55];
      window(flip * -2.95, 1.5, 0);
      if (gableFront) opening(0.7, 0.7, 0, EAVE + rise * 0.3, mats.courtyardCurtain, 0.07);
    } else window(flip * 0.85, 1.05, 0);

    // About half the lots are fenced. The rest stay open lawn with a hedge.
    if ((style >>> 8) % 2) {
      const gaps: [number, number][] = [[doorAt - 0.7, doorAt + 0.7]];
      if (driveway) gaps.push(driveway);
      const fenceAt = YARD - 0.18;
      let from = -lotLength / 2 + 0.12;
      const limit = lotLength / 2 - 0.12;
      for (const [start, stop] of [...gaps.sort((p, q) => p[0] - q[0]), [limit, limit]]) {
        const span = Math.min(start, limit) - from;
        if (span > 0.4) {
          const mid = from + span / 2;
          for (const rail of [0.32, 0.72])
            part(span, 0.07, 0.03, mid, rail, fenceAt + 0.02, mats.streetTrim);
          const pickets = Math.floor(span / 0.17);
          for (let i = 0; i < pickets; i++)
            part(0.095, 0.92, 0.025, from + (i + 0.5) * (span / pickets), 0.5, fenceAt + 0.05, mats.streetTrim);
          for (const post of [from + 0.05, from + span - 0.05])
            part(0.11, 1.04, 0.11, post, 0.52, fenceAt, mats.streetTrim);
          solid(0.12, 1, span, edge + inward * (fenceAt + 0.04), 0.5, center + mid);
        }
        from = Math.max(from, stop);
      }
    } else {
      const hedgeAt = wide ? flip * -2.95 : flip * 0.85;
      part(wide ? 2.2 : 1.3, 0.75, 0.7, hedgeAt, 0.375, front + 0.12, mats.streetHedge);
      solid(0.7, 0.75, wide ? 2.2 : 1.3, edge + inward * (front + 0.47), 0.375, center + hedgeAt);
    }
  }

  const meshes: [THREE.BufferGeometry[], THREE.Material, number][] = [
    [roofs, mats.streetRoof, 0],
    ...[...ends].map(
      ([mat, list]) =>
        [list, mat, mat.userData.surfaceMeters ?? 0] as [
          THREE.BufferGeometry[],
          THREE.Material,
          number,
        ],
    ),
  ];
  for (const [list, mat, meters] of meshes) {
    if (!list.length) continue;
    const merged = mergeGeometries(list)!;
    if (meters) projectSurfaceUVs(merged, meters);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat === mats.streetRoof ? "street-roofs" : "street-gables";
    mesh.castShadow = mesh.receiveShadow = true;
    b.group.add(mesh);
    list.forEach((g) => g.dispose());
  }
}

/** Paint the hall's side of each perimeter wall; the reverse stays office. */
function skinWalls(
  data: ChunkData,
  room: Landmark,
  mats: Materials,
  b: LandmarkBuilder,
) {
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
        const px = (cx + 0.5 + dx * 0.5) * CELL,
          pz = (cz + 0.5 + dz * 0.5) * CELL;
        // Open edges keep their doorway; only the header above it is painted.
        const base = bits & bit ? HEIGHT : 0;
        b.plane(
          CELL,
          room.height - base,
          px - dx * 0.101,
          (room.height + base) / 2,
          pz - dz * 0.101,
          mats.streetWall,
          0,
          angle,
        );
        if (!base)
          b.plane(CELL, 0.2, px - dx * 0.126, 0.1, pz - dz * 0.126, mats.streetTrim, 0, angle);
      }
    }
}
