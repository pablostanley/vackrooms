import * as THREE from "three";
import { CHUNK, CELL, poolBounds, type ChunkData } from "./maze";
import type { Materials } from "./materials";
import type { LandmarkBuilder } from "./landmarks";
import {
  BRIDGE_TOP,
  BRIDGE_WIDTH,
  POOL_COPING,
  TRAMPOLINE_RADIUS,
  TRAMPOLINE_TOP,
  offsetOutline,
  pointInPolygon,
  type PoolDesign,
} from "./pool-shape";

type Solid = (
  w: number,
  h: number,
  d: number,
  px: number,
  py: number,
  pz: number,
  mat: THREE.Material,
) => void;

const FLOOR_Y = -1.4;
const WATER_Y = -0.18;

/** Plan outline to a flat, upward-facing mesh after rotateX(-PI / 2). */
function planShape(points: readonly [number, number][]) {
  return new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
}

/**
 * A generation-2 basin: seeded outline, poured deck, continuous coping, and an
 * optional footbridge, pier, or trampoline. Geometry is in chunk-local meters.
 */
export function buildShapedPool(
  data: ChunkData,
  design: PoolDesign,
  mats: Materials,
  b: LandmarkBuilder,
  solid: Solid,
) {
  const bounds = poolBounds(data.landmark)!;
  const ox = data.x * CHUNK * CELL, oz = data.z * CHUNK * CELL;
  const { outline } = design;
  const local = (points: [number, number][]) =>
    points.map(([x, z]): [number, number] => [bounds.x + x, bounds.z + z]);

  // Dry deck inside the basin's bounding box, around the water.
  const deck = planShape(local([
    [0, 0], [design.width, 0], [design.width, design.length], [0, design.length],
  ]));
  deck.holes.push(new THREE.Path(planShape(local(outline)).getPoints()));
  const deckGeometry = new THREE.ShapeGeometry(deck);
  deckGeometry.rotateX(-Math.PI / 2);
  b.geometry?.(deckGeometry, mats.cream, 0, 0.012, 0);

  const floor = new THREE.ShapeGeometry(planShape(local(outline)));
  floor.rotateX(-Math.PI / 2);
  b.geometry?.(floor, mats.tileFloor, 0, FLOOR_Y, 0);

  // One continuous coping ring doubles as the basin wall, 0.44m above deck.
  const outer = offsetOutline(outline, POOL_COPING);
  const inner = offsetOutline(outline, -POOL_COPING);
  const ring = planShape(local(outer));
  ring.holes.push(new THREE.Path(planShape(local(inner)).getPoints()));
  const coping = new THREE.ExtrudeGeometry(ring, {
    depth: BRIDGE_TOP - FLOOR_Y,
    bevelEnabled: false,
  });
  coping.rotateX(-Math.PI / 2);
  // Section batches merge only when every geometry shares indexing.
  coping.setIndex([...Array(coping.getAttribute("position").count).keys()]);
  b.geometry?.(coping, mats.cream, 0, FLOOR_Y, 0);
  // Rapier gets one convex slab per coping segment; each bound also guides
  // navigation around the rim like any other obstacle.
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    const corners = [outer[i], outer[j], inner[j], inner[i]];
    const vertices = new Float32Array(24);
    const box = new THREE.Box3();
    corners.forEach(([x, z], k) => {
      for (const [level, y] of [[0, FLOOR_Y], [1, BRIDGE_TOP]] as const) {
        const at = (k * 2 + level) * 3;
        vertices[at] = ox + bounds.x + x;
        vertices[at + 1] = y;
        vertices[at + 2] = oz + bounds.z + z;
        box.expandByPoint(new THREE.Vector3(vertices[at], y, vertices[at + 2]));
      }
    });
    b.colliders.push(box);
    b.shapedColliders.push({ bounds: box, parts: [vertices] });
  }

  const water = waterMesh(design, bounds, ox, oz, data.landmark.height, mats.tileFloor);
  b.group.add(water);
  b.water.push(water);
  if (design.shape === "rectangle" && design.width >= 12 && design.length >= 18)
    laneMarks(design, bounds, b, mats);
  if (design.bridge) buildBridge(design, bounds, mats, b, solid);
  if (design.trampoline) buildTrampoline(design, bounds, mats, b, ox, oz);
}

/** A subdivided grid clipped to the outline, so the waves still displace it. */
function waterMesh(
  design: PoolDesign,
  bounds: { x: number; z: number },
  ox: number,
  oz: number,
  ceiling: number,
  material: THREE.Material,
) {
  // Clip just inside the coping so no water pokes through the rim.
  const edge = offsetOutline(design.outline, -0.08);
  const columns = Math.max(8, Math.round(design.width / 0.33));
  const rows = Math.max(8, Math.round(design.length / 0.33));
  const cx = design.width / 2, cz = design.length / 2;
  // Start from the same rotated PlaneGeometry as the classic basin, then pull
  // dry vertices onto the outline and drop the fully dry triangles.
  const geometry = new THREE.PlaneGeometry(design.width, design.length, columns, rows);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const inside: boolean[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + cx, z = position.getZ(i) + cz;
    const wet = pointInPolygon(edge, x, z);
    inside.push(wet);
    if (wet) continue;
    const [px, pz] = nearestOnOutline(edge, x, z);
    position.setX(i, px - cx);
    position.setZ(i, pz - cz);
  }
  const source = geometry.index!.array, kept: number[] = [];
  for (let i = 0; i < source.length; i += 3)
    if (inside[source[i]] || inside[source[i + 1]] || inside[source[i + 2]])
      kept.push(source[i], source[i + 1], source[i + 2]);
  geometry.setIndex(kept);
  const water = new THREE.Mesh(geometry, material);
  water.name = "pool-water";
  water.position.set(ox + bounds.x + cx, WATER_Y, oz + bounds.z + cz);
  water.userData.ceiling = ceiling;
  water.receiveShadow = true;
  return water;
}

function nearestOnOutline(points: readonly [number, number][], x: number, z: number): [number, number] {
  let best: [number, number] = points[0], distance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < distance) {
      distance = d;
      best = [px, pz];
    }
  }
  return best;
}

function laneMarks(
  design: PoolDesign,
  bounds: { x: number; z: number },
  b: LandmarkBuilder,
  mats: Materials,
) {
  const lanes = Math.max(2, Math.floor(design.width / 2.5) - 1);
  const x = bounds.x + design.width / 2, z = bounds.z + design.length / 2;
  const run = design.length - 4;
  for (let lane = 0; lane < lanes; lane++) {
    const px = x + (lane - (lanes - 1) / 2) * 2.5;
    b.plane(0.13, run, px, FLOOR_Y + 0.015, z, mats.trim, -Math.PI / 2);
    for (const side of [-1, 1])
      b.plane(1.1, 0.13, px, FLOOR_Y + 0.02, z + (side * run) / 2, mats.trim, -Math.PI / 2);
  }
}

/** A plain poured walkway at coping height, with a half step at each landing. */
function buildBridge(
  design: PoolDesign,
  bounds: { x: number; z: number },
  mats: Materials,
  b: LandmarkBuilder,
  solid: Solid,
) {
  const bridge = design.bridge!;
  const z = bounds.z + bridge.z;
  const x0 = bounds.x + bridge.x0, x1 = bounds.x + bridge.x1;
  const thickness = 0.24;
  solid(x1 - x0, thickness, BRIDGE_WIDTH, (x0 + x1) / 2, BRIDGE_TOP - thickness / 2, z, mats.cream);
  b.box(x1 - x0 + 0.04, 0.05, BRIDGE_WIDTH + 0.04, (x0 + x1) / 2, BRIDGE_TOP - 0.02, z, mats.trim);
  // Autostep climbs 0.22m risers; the walkway top matches the coping.
  const step = BRIDGE_TOP / 2;
  const landings: number[] = [];
  if (!pointInPolygon(design.outline, bridge.x0 + 0.1, bridge.z)) landings.push(x0 - 0.3);
  if (!pointInPolygon(design.outline, bridge.x1 - 0.1, bridge.z)) landings.push(x1 + 0.3);
  for (const px of landings)
    solid(0.6, step, BRIDGE_WIDTH, px, step / 2, z, mats.cream);
  // Square piers down to the basin floor, only where they stand in water.
  const span = x1 - x0, count = Math.max(1, Math.round(span / 4.5));
  for (let i = 0; i <= count; i++) {
    const px = x0 + 0.5 + ((span - 1) * i) / count;
    for (const side of [-1, 1]) {
      const pz = z + side * (BRIDGE_WIDTH / 2 - 0.25);
      if (!pointInPolygon(offsetOutline(design.outline, -0.5), px - bounds.x, pz - bounds.z)) continue;
      const height = BRIDGE_TOP - thickness - FLOOR_Y;
      solid(0.32, height, 0.32, px, FLOOR_Y + height / 2, pz, mats.cream);
    }
  }
}

/** A low backyard trampoline on the deck: stepping on it launches the camera. */
function buildTrampoline(
  design: PoolDesign,
  bounds: { x: number; z: number },
  mats: Materials,
  b: LandmarkBuilder,
  ox: number,
  oz: number,
) {
  const { x: tx, z: tz } = design.trampoline!;
  const x = bounds.x + tx, z = bounds.z + tz;
  const frame = new THREE.TorusGeometry(TRAMPOLINE_RADIUS - 0.04, 0.05, 8, 40);
  frame.rotateX(Math.PI / 2);
  b.geometry?.(frame, mats.fixtures, x, TRAMPOLINE_TOP - 0.02, z);
  const pad = new THREE.TorusGeometry(TRAMPOLINE_RADIUS - 0.16, 0.09, 6, 40);
  pad.scale(1, 1, 0.35);
  pad.rotateX(Math.PI / 2);
  b.geometry?.(pad, mats.fadedRed, x, TRAMPOLINE_TOP, z);
  const bed = new THREE.CircleGeometry(TRAMPOLINE_RADIUS - 0.2, 40);
  bed.rotateX(-Math.PI / 2);
  b.geometry?.(bed, mats.metal, x, TRAMPOLINE_TOP - 0.01, z);
  for (let leg = 0; leg < 6; leg++) {
    const angle = (leg / 6) * Math.PI * 2;
    b.box(
      0.05, TRAMPOLINE_TOP, 0.05,
      x + Math.cos(angle) * (TRAMPOLINE_RADIUS - 0.04),
      TRAMPOLINE_TOP / 2,
      z + Math.sin(angle) * (TRAMPOLINE_RADIUS - 0.04),
      mats.fixtures,
    );
  }
  // Walkable: the motor's 0.28m autostep takes the bed, then it bounces.
  const side = TRAMPOLINE_RADIUS * 1.6;
  b.colliders.push(new THREE.Box3(
    new THREE.Vector3(ox + x - side / 2, 0, oz + z - side / 2),
    new THREE.Vector3(ox + x + side / 2, TRAMPOLINE_TOP, oz + z + side / 2),
  ));
}
