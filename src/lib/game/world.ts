import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OBB } from "three/addons/math/OBB.js";
import {
  CELL,
  CHUNK,
  SPAN,
  HEIGHT,
  N,
  W,
  E,
  S,
  random,
  hash,
  inLandmark,
  ceilingAt,
  canStand,
  cellAt,
  poolBounds,
  courtyardBounds,
  type ChunkData,
} from "./maze";
import { createDiscoveryParts, planDiscovery } from "./discoveries";
import { furnitureCollisionParts } from "./furniture-collision";
import { buildLandmark } from "./landmarks";
import type { BallPit } from "./ball-pit";
import { wallContactShadowGeometry } from "./wall-contact-shadow";
import { planRoomLighting } from "./room-lighting";
import {
  STAIR_LANDING,
  STAIR_START,
  STAIR_TREAD,
  STAIR_WIDTH,
  cutSegment,
  stairBlocks,
} from "./room-shapes";
import { markTubePanel, pickFixtureChannel } from "./fixture-lighting";
import type { Materials } from "./materials";
import { configureSurfaceSampling, projectSurfaceUVs } from "./surface-textures";
import type { ShapedObstacle } from "./physics";
import {
  computerKinds,
  computerScreen,
  type ComputerKind,
} from "./computer-models";
import { COMPUTER_HOMES, type ComputerStation } from "./computers";
import {
  chairKinds,
  furnitureVariants,
  isChairKind,
  type ChairKind,
  type FurnitureKind,
  type FurnitureModel,
} from "./furniture-models";
import {
  anchorPose,
  chairStack,
  chairStackStyles,
  leavesPassagesClear,
  partSolids,
  solidsOverlap,
} from "./furniture-layout";

export interface Portal {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  mesh: THREE.Mesh;
}
export interface Section {
  group: THREE.Group;
  lights: THREE.Vector3[];
  /** Tube behavior per ceiling fixture; unlisted lights are steady. */
  fixtureChannels: Map<THREE.Vector3, number>;
  /** Merged dim and failing panels, if any; vertex colors hold tube levels. */
  tubes: THREE.BufferGeometry | null;
  lampLights: THREE.Vector3[];
  portals: Portal[];
  colliders: THREE.Box3[];
  shapedColliders: ShapedObstacle[];
  water: THREE.Mesh[];
  /** Instanced ball pits that part around the player. */
  ballPits: BallPit[];
  computers: ComputerStation[];
  occluders: THREE.Mesh[];
  dispose: () => void;
}
export function buildSection(
  data: ChunkData,
  mats: Materials,
  depth: number,
): Section {
  const group = new THREE.Group();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const rng = random(data.seed + 11),
    ox = data.x * SPAN,
    oz = data.z * SPAN;
  const lights: THREE.Vector3[] = [],
    portals: Portal[] = [],
    colliders: THREE.Box3[] = [],
    water: THREE.Mesh[] = [];
  const ballPits: BallPit[] = [];
  const shapedColliders: ShapedObstacle[] = [];
  const computers: ComputerStation[] = [];
  const looseFurniture: ShapedObstacle[] = [];
  const lampLights: THREE.Vector3[] = [];
  const lighting = planRoomLighting(data);
  group.userData.lighting = lighting;
  const theme = mats.forTheme(data.theme);
  const furnitureRng = random(data.seed + 3403);
  const chairRng = random(data.seed + 39217);
  const furnished = new Set<number>();
  // Angled corners and stairs own their cells: ordinary dressing stays out.
  const shapedCells = new Set<number>([
    ...(data.cuts ?? []).map((cut) => cut.cell),
    ...(data.stairs ?? []).map((run) => run.cell),
    ...(data.playroom?.cells ?? []),
  ]);
  const play = new Set(data.playroom?.cells);
  const propRecords: {
    kind: FurnitureKind;
    variant: number;
    pose: THREE.Matrix4;
    attachment: string;
    bounds: THREE.Box3;
  }[] = [];
  // Every placed solid in section space. Later pieces are tested against it,
  // so furniture, pillars and shelving never pass through one another.
  const occupied: { bounds: THREE.Box3; solids: OBB[] }[] = [];
  function occupy(bounds: THREE.Box3, solids = [new OBB().fromBox3(bounds)]) {
    occupied.push({ bounds, solids });
  }
  function fits(source: FurnitureModel, pose: THREE.Matrix4, clearance = 0.03) {
    const bounds = source.bounds.clone().applyMatrix4(pose).expandByScalar(clearance);
    const nearby = occupied.filter((other) => other.bounds.intersectsBox(bounds));
    if (!nearby.length) return true;
    const solids = partSolids(source, pose);
    for (const solid of solids) solid.halfSize.addScalar(clearance);
    return !nearby.some((other) => solidsOverlap(solids, other.solids, 0));
  }
  function vacant(bounds: THREE.Box3) {
    const solid = [new OBB().fromBox3(bounds)];
    return !occupied.some((other) =>
      other.bounds.intersectsBox(bounds) && solidsOverlap(solid, other.solids, 0));
  }
  /** Keep a free-standing piece inside its own room, clear of the walls. */
  function insideCell(bounds: THREE.Box3, cx: number, cz: number, margin = 0.12) {
    return (
      bounds.min.x >= cx * CELL + margin &&
      bounds.max.x <= (cx + 1) * CELL - margin &&
      bounds.min.z >= cz * CELL + margin &&
      bounds.max.z <= (cz + 1) * CELL - margin
    );
  }
  group.userData.furniture = propRecords;
  const matrix = new THREE.Matrix4(),
    quaternion = new THREE.Quaternion();
  function add(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
    matrix.compose(
      new THREE.Vector3(x + ox, y, z + oz),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    if (mat.userData.surfaceMeters)
      projectSurfaceUVs(geometry, mat.userData.surfaceMeters);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(geometry);
  }
  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    angle = 0,
  ) {
    const g = new THREE.BoxGeometry(w, h, d);
    add(g, mat, x, y, z, 0, angle);
  }
  function plane(
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    rx: number,
    ry = 0,
    repeat = 0,
  ) {
    const g = new THREE.PlaneGeometry(w, h);
    if (repeat) {
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, (uv.getX(i) * w) / repeat, (uv.getY(i) * h) / repeat);
    }
    add(g, mat, x, y, z, rx, ry);
  }
  function wall(
    x: number,
    z: number,
    vertical: boolean,
    height = HEIGHT,
    material: THREE.Material = theme.wall,
  ) {
    // Collinear segments meet at cell edges. Extending them by their thickness
    // puts two faces at the same depth, exposing both themes at section seams.
    box(
      vertical ? 0.18 : CELL,
      height,
      vertical ? CELL : 0.18,
      x,
      height / 2,
      z,
      material,
    );
    box(
      vertical ? 0.22 : CELL,
      0.115,
      vertical ? CELL : 0.22,
      x,
      0.058,
      z,
      mats.trim,
    );
    box(
      vertical ? 0.21 : CELL,
      0.055,
      vertical ? CELL : 0.21,
      x,
      height - 0.027,
      z,
      mats.trim,
    );
    for (const side of [-1, 1]) {
      // Soft baked contact shading grounds both sides of each wall on the floor.
      add(
        wallContactShadowGeometry(vertical, side),
        mats.shadow,
        x + (vertical ? side * 0.39 : 0),
        0.006,
        z + (vertical ? 0 : side * 0.39),
        0,
      );
    }
  }
  function model(kind: FurnitureKind, lampOn = false, variant = 0) {
    return mats.furniture.get(kind, lampOn, variant);
  }
  function furniture(
    kind: FurnitureKind,
    pose: THREE.Matrix4,
    attachment = "floor",
    lampOn = false,
    variant = 0,
  ) {
    const source = model(kind, lampOn, variant);
    occupy(source.bounds.clone().applyMatrix4(pose), partSolids(source, pose));
    if (lampOn)
      lampLights.push(
        new THREE.Vector3(0, 1.4, 0)
          .applyMatrix4(pose)
          .add(new THREE.Vector3(ox, 0, oz)),
      );
    const mass = attachment === "floor" ? (
      isChairKind(kind) ? (kind === "officeChair" ? 12 : 7)
        : kind === "sideTable" ? 16
        : kind === "utilityCart" ? 24
        : kind === "archiveCartons" ? 18
        : kind === "bench" ? 38
        : kind === "table" ? 48 : 0
    ) : 0;
    const movable = mass ? new THREE.Group() : null;
    const worldPose = pose.clone().premultiply(new THREE.Matrix4().makeTranslation(ox, 0, oz));
    const worldBounds = source.bounds.clone().applyMatrix4(worldPose);
    const center = worldBounds.getCenter(new THREE.Vector3());
    if (movable) {
      movable.position.copy(center);
      group.add(movable);
    }
    const shaped = kind === "slide" || kind === "utilityCart" || kind === "computerDesk";
    const movingBatches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const part of source.parts) {
      const geometry = part.geometry.clone();
      // Furniture grain follows the object when it rotates or hangs from a wall.
      if (part.material.userData.surfaceMeters)
        projectSurfaceUVs(geometry, part.material.userData.surfaceMeters);
      geometry.applyMatrix4(pose).translate(ox, 0, oz);
      if (movable) {
        geometry.translate(-center.x, -center.y, -center.z);
        if (!movingBatches.has(part.material)) movingBatches.set(part.material, []);
        movingBatches.get(part.material)!.push(geometry);
      } else {
        if (!batches.has(part.material)) batches.set(part.material, []);
        batches.get(part.material)!.push(geometry);
      }
    }
    if (movable) for (const [material, geometries] of movingBatches) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries)!, material);
      mesh.castShadow = mesh.receiveShadow = true;
      movable.add(mesh);
      geometries.forEach((geometry) => geometry.dispose());
    }
    const bounds = source.bounds.clone().applyMatrix4(pose);
    propRecords.push({ kind, variant, pose: pose.clone(), attachment, bounds: bounds.clone() });
    if (movable) {
      const obstacle: ShapedObstacle = {
        bounds: worldBounds,
        parts: furnitureCollisionParts(source, worldPose),
        movable: { object: movable, mass, material:
          kind === "utilityCart" || kind === "officeChair" || kind === "foldingChair" ? "metal"
            : kind === "plasticChair" ? "plastic"
            : kind === "archiveCartons" ? "cardboard" : "wood" },
      };
      colliders.push(worldBounds);
      shapedColliders.push(obstacle);
      looseFurniture.push(obstacle);
      return;
    }
    if (bounds.min.y < HEIGHT && bounds.max.y > 0.02) {
      if (shaped) {
        // Keep the coarse navigation bound while Rapier follows actual solids.
        // Desks/carts must support their surfaces, not air at CRT/handle height.
        bounds.translate(new THREE.Vector3(ox, 0, oz));
        colliders.push(bounds);
        const worldPose = pose.clone().premultiply(new THREE.Matrix4().makeTranslation(ox, 0, oz));
        shapedColliders.push({ bounds, parts: furnitureCollisionParts(source, worldPose) });
        return;
      }
      // Seats need their real solid parts: a whole-chair/sofa box fills the air
      // above the cushion and makes players stand on an invisible platform.
      const solids =
        isChairKind(kind) || kind === "sofa"
          ? source.parts.map(({ geometry }) =>
              geometry.boundingBox!.clone().applyMatrix4(pose),
            )
          : [bounds];
      for (const solid of solids)
        colliders.push(solid.translate(new THREE.Vector3(ox, 0, oz)));
    }
  }
  /** A free-standing chair, placed only where it touches nothing else. */
  function chair(
    x: number,
    z: number,
    angle: number,
    kind: ChairKind = "chair",
    variant = 0,
    cx = Math.floor(x / CELL),
    cz = Math.floor(z / CELL),
  ) {
    const source = model(kind, false, variant);
    const pose = anchorPose(
      new THREE.Vector3(),
      new THREE.Vector3(x, -source.bounds.min.y, z),
      new THREE.Euler(0, angle, 0),
    );
    const bounds = source.bounds.clone().applyMatrix4(pose);
    if (
      !insideCell(bounds, cx, cz) ||
      !leavesPassagesClear(bounds, cx, cz, data.cells[cz * CHUNK + cx]) ||
      !fits(source, pose)
    )
      return false;
    furniture(kind, pose, "floor", false, variant);
    return true;
  }
  /** Pull a few matching chairs up to a free-standing table. */
  function seatTable(
    table: FurnitureModel,
    pose: THREE.Matrix4,
    cx: number,
    cz: number,
  ) {
    const kind = (["chair", "chair", "foldingChair", "plasticChair"] as const)[
      Math.floor(furnitureRng() * 4)
    ];
    const variant = Math.floor(furnitureRng() * furnitureVariants);
    const size = table.bounds.getSize(new THREE.Vector3());
    const round = Math.abs(size.x - size.z) < 0.05;
    const center = table.bounds.getCenter(new THREE.Vector3()).applyMatrix4(pose);
    const tableYaw = new THREE.Euler().setFromRotationMatrix(pose).y;
    // Seats around the table: angle, distance to its edge, and offset along it.
    const sides: [number, number, number][] = round
      ? [0, 1, 2].map((i) => [furnitureRng() * 0.4 + (i * Math.PI * 2) / 3, size.x / 2, 0])
      : [
          [0, size.z / 2, -size.x / 4], [0, size.z / 2, size.x / 4],
          [Math.PI, size.z / 2, -size.x / 4], [Math.PI, size.z / 2, size.x / 4],
          [Math.PI / 2, size.x / 2, 0], [-Math.PI / 2, size.x / 2, 0],
        ];
    let seated = 0;
    const wanted = 2 + Math.floor(furnitureRng() * 3);
    for (const [angle, reach, along] of sides) {
      if (seated >= wanted || furnitureRng() < 0.2) continue;
      const yaw = tableYaw + angle;
      // Some chairs are tucked under the top, others pushed back and askew.
      for (const pull of [0.1 + furnitureRng() * 0.25, 0.42]) {
        const distance = reach + pull;
        const local = new THREE.Vector3(along, 0, -distance).applyAxisAngle(
          new THREE.Vector3(0, 1, 0), yaw,
        );
        if (chair(center.x + local.x, center.z + local.z,
          yaw + Math.PI + (furnitureRng() - 0.5) * 0.35, kind, variant, cx, cz)) {
          seated++;
          break;
        }
      }
    }
  }
  function scatterFurniture(
    kind: FurnitureKind,
    cx: number,
    cz: number,
    mode: "floor" | "wall" | "ceiling",
    lampOn = false,
    variant = Math.floor(furnitureRng() * furnitureVariants),
  ) {
    if (shapedCells.has(cz * CHUNK + cx)) return false;
    const source = model(kind, lampOn, variant),
      bits = data.cells[cz * CHUNK + cx];
    const ceiling = ceilingAt(data, cx, cz);
    const x = (cx + 0.5) * CELL,
      z = (cz + 0.5) * CELL;
    const closed = [N, E, S, W].filter((bit) => !(bits & bit));
    for (let attempt = 0; attempt < 8; attempt++) {
      const wallBit =
        closed[
          (attempt + Math.floor(furnitureRng() * closed.length)) % closed.length
        ];
      let yaw =
        wallBit === N
          ? Math.PI
          : wallBit === E
            ? Math.PI / 2
            : wallBit === W
              ? -Math.PI / 2
              : 0;
      // The slide's long axis lies along a wall, leaving a path in front of it.
      if (kind === "slide") yaw += Math.PI / 2;
      let pose: THREE.Matrix4;
      if (mode === "wall" && wallBit) {
        const target = new THREE.Vector3(x, 0.75 + furnitureRng() * 0.8, z);
        if (wallBit === N) target.z = cz * CELL;
        if (wallBit === S) target.z = (cz + 1) * CELL;
        if (wallBit === W) target.x = cx * CELL;
        if (wallBit === E) target.x = (cx + 1) * CELL;
        pose = anchorPose(
          source.anchor,
          target,
          new THREE.Euler(
            (furnitureRng() - 0.5) * 1.3,
            yaw + (furnitureRng() - 0.5) * 0.7,
            (furnitureRng() - 0.5) * 1.5,
          ),
        );
      } else if (mode === "ceiling") {
        pose = anchorPose(
          source.anchor,
          new THREE.Vector3(
            x + (attempt % 2 ? -1.5 : 1.5),
            ceiling - 0.025,
            z + (attempt % 3 ? -1.5 : 1.5),
          ),
          new THREE.Euler(
            2.4 + furnitureRng() * 0.95,
            furnitureRng() * Math.PI * 2,
            (furnitureRng() - 0.5) * 1.1,
          ),
        );
      } else {
        // A slight, seeded misalignment keeps rooms from looking stamped out.
        if (kind !== "slide") yaw += (furnitureRng() - 0.5) * 0.1;
        pose = anchorPose(
          new THREE.Vector3(),
          new THREE.Vector3(),
          new THREE.Euler(0, yaw, 0),
        );
        // Floor slides live in low offices: leave standing headroom on the
        // platform while preserving the chute width and reserved walking lanes.
        if (kind === "slide") pose.scale(new THREE.Vector3(1, 0.84, 1));
        const box = source.bounds.clone().applyMatrix4(pose);
        const center = box.getCenter(new THREE.Vector3());
        const target = new THREE.Vector3(
          x - center.x,
          -box.min.y,
          z - center.z,
        );
        if (wallBit === N) target.z = cz * CELL + 0.2 - box.min.z;
        else if (wallBit === S) target.z = (cz + 1) * CELL - 0.2 - box.max.z;
        else if (wallBit === W) target.x = cx * CELL + 0.2 - box.min.x;
        else if (wallBit === E) target.x = (cx + 1) * CELL - 0.2 - box.max.x;
        else {
          target.x += (attempt % 2 ? -1 : 1) * (1.45 + furnitureRng() * 0.45);
          target.z += (attempt % 3 ? -1 : 1) * (1.45 + furnitureRng() * 0.45);
        }
        // Slide along the wall, anywhere the piece still fits in the room.
        const along = wallBit === N || wallBit === S ? "x" : "z";
        if (wallBit) {
          const span = box.max[along] - box.min[along];
          const slack = Math.max(0, CELL - 0.7 - span) / 2;
          target[along] += (furnitureRng() * 2 - 1) * slack;
        }
        pose.setPosition(target);
      }
      const bounds = source.bounds.clone().applyMatrix4(pose);
      // Low ceilings refuse tall pieces rather than burying them in the tiles.
      if (mode !== "ceiling" && bounds.max.y > ceiling - 0.08) continue;
      if (
        leavesPassagesClear(bounds, cx, cz, bits) &&
        fits(source, pose, mode === "floor" ? 0.03 : 0)
      ) {
        furniture(
          kind,
          pose,
          mode === "wall" && !wallBit ? "floor" : mode,
          lampOn,
          variant,
        );
        furnished.add(cz * CHUNK + cx);
        if (kind === "table" && mode === "floor") seatTable(source, pose, cx, cz);
        return true;
      }
    }
    return false;
  }
  function buildPlayroom(palette: number) {
    const vinyl = (i: number) => mats.vinyl[(palette + i) % mats.vinyl.length];
    const playRng = random(data.seed + 61441);
    const solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      colliders.push(new THREE.Box3(
        new THREE.Vector3(ox + x0, y0, oz + z0),
        new THREE.Vector3(ox + x1, y1, oz + z1),
      ));
    const sides = [
      { bit: N, dx: 0, dz: -1 },
      { bit: E, dx: 1, dz: 0 },
      { bit: S, dx: 0, dz: 1 },
      { bit: W, dx: -1, dz: 0 },
    ];
    for (const cell of play) {
      const cx = cell % CHUNK,
        cz = Math.floor(cell / CHUNK);
      const bits = data.cells[cell];
      const x0 = cx * CELL,
        z0 = cz * CELL;
      // One glossy floor across the whole play area, lifted clear of the carpet.
      plane(CELL, CELL, x0 + CELL / 2, 0.014, z0 + CELL / 2, vinyl(0), -Math.PI / 2);
      for (const { bit, dx, dz } of sides) {
        // Local frame: u runs along the wall, v points into the room.
        const cx0 = x0 + CELL / 2 + (dx * CELL) / 2,
          cz0 = z0 + CELL / 2 + (dz * CELL) / 2;
        const at = (u: number, v: number) =>
          [cx0 + (dz ? u : -dx * v), cz0 + (dx ? u : -dz * v)] as const;
        if (!(bits & bit)) {
          // Puffed tubes line the wall like the side of a bouncy castle.
          for (let i = 0; i < 7; i++) {
            const [px, pz] = at(-CELL / 2 + 0.34 + i * 0.687, 0.39);
            add(new THREE.CapsuleGeometry(0.3, 1.7, 6, 12), vinyl(1 + (i % 2)), px, 1.15, pz);
          }
          const [rx, rz] = at(0, 0.39);
          add(new THREE.CylinderGeometry(0.22, 0.22, CELL - 0.5, 14), vinyl(3), rx, 2.35, rz,
            dz ? 0 : Math.PI / 2, 0, dz ? Math.PI / 2 : 0);
          const [ax, az] = at(-CELL / 2, 0.09),
            [bx, bz] = at(CELL / 2, 0.72);
          solid(Math.min(ax, bx), 0, Math.min(az, bz), Math.max(ax, bx), 2.57, Math.max(az, bz));
          continue;
        }
        const neighbor = (cz + dz) * CHUNK + cx + dx;
        if (play.has(neighbor)) continue;
        // An inflatable arch welcomes you in from the office.
        const header = Math.min(ceilingAt(data, cx, cz), ceilingAt(data, cx + dx, cz + dz));
        if (header < 2.9) continue;
        for (const side of [-1, 1]) {
          const [px, pz] = at(side * 1.5, 0);
          add(new THREE.CylinderGeometry(0.34, 0.38, 0.7, 14), vinyl(2), px, 0.35, pz);
          solid(px - 0.34, 0, pz - 0.34, px + 0.34, 1.4, pz + 0.34);
        }
        const [mx, mz] = at(0, 0);
        add(new THREE.TorusGeometry(1.5, 0.3, 12, 28, Math.PI), vinyl(4), mx, 0.7, mz, 0, dz ? 0 : Math.PI / 2);
      }
      // Turrets fill each closed corner, cone roofs and all.
      for (const [bitA, bitB, ux, uz] of [
        [N, W, 0, 0], [N, E, 1, 0], [S, E, 1, 1], [S, W, 0, 1],
      ] as const) {
        if (bits & bitA || bits & bitB) continue;
        const px = x0 + (ux ? CELL - 0.62 : 0.62),
          pz = z0 + (uz ? CELL - 0.62 : 0.62);
        add(new THREE.CylinderGeometry(0.55, 0.6, 2.9, 18), vinyl(4), px, 1.45, pz);
        add(new THREE.ConeGeometry(0.66, 0.8, 18), vinyl(0), px, 3.3, pz);
        solid(px - 0.6, 0, pz - 0.6, px + 0.6, 3.7, pz + 0.6);
      }
    }
    // A few giant balls to kick around; they roll on the same Rapier world.
    const cells = [...play];
    const balls = 1 + Math.floor(playRng() * 3);
    for (let i = 0; i < balls; i++) {
      const cell = cells[Math.floor(playRng() * cells.length)];
      const radius = 0.45 + playRng() * 0.25;
      // Spread by thirds so no two balls start interpenetrating.
      const angle = (i * Math.PI * 2) / 3 + playRng() * 0.8;
      const center = new THREE.Vector3(
        ox + ((cell % CHUNK) + 0.5) * CELL + Math.cos(angle) * 0.85,
        radius + 0.015,
        oz + (Math.floor(cell / CHUNK) + 0.5) * CELL + Math.sin(angle) * 0.85,
      );
      const ball = new THREE.Group();
      ball.position.copy(center);
      for (let wedge = 0; wedge < 6; wedge++) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 16, 12, (wedge * Math.PI) / 3, Math.PI / 3),
          vinyl(wedge % 2 ? i + 1 : i + 3),
        );
        mesh.castShadow = mesh.receiveShadow = true;
        ball.add(mesh);
      }
      group.add(ball);
      const hull = new THREE.IcosahedronGeometry(radius, 1).getAttribute("position");
      const vertices = new Float32Array(hull.count * 3);
      for (let v = 0; v < hull.count; v++) {
        vertices[v * 3] = hull.getX(v) + center.x;
        vertices[v * 3 + 1] = hull.getY(v) + center.y;
        vertices[v * 3 + 2] = hull.getZ(v) + center.z;
      }
      const bounds = new THREE.Box3(
        center.clone().subScalar(radius),
        center.clone().addScalar(radius),
      );
      colliders.push(bounds);
      shapedColliders.push({
        bounds,
        parts: [vertices],
        movable: { object: ball, mass: 2.5, material: "plastic" },
      });
    }
  }
  const basin = poolBounds(data.landmark);
  const courtyard = courtyardBounds(data.landmark);
  const floorOpening =
    basin ??
    (courtyard && courtyard.floorY < 0 ? courtyard : null) ??
    (data.landmark.kind === "levelFun"
      ? {
          x: data.landmark.x * CELL,
          z: data.landmark.z * CELL,
          width: data.landmark.width * CELL,
          length: data.landmark.length * CELL,
        }
      : null);
  const floor = (x: number, z: number, w: number, d: number) =>
    plane(w, d, x + w / 2, 0, z + d / 2, theme.floor, -Math.PI / 2, 0, 4.8);
  if (floorOpening) {
    // Leave one surface for pools, sunken courtyards, and replacement carpet.
    const { x, z, width, length } = floorOpening;
    floor(0, 0, SPAN, z);
    floor(0, z + length, SPAN, SPAN - z - length);
    floor(0, z, x, length);
    floor(x + width, z, SPAN - x - width, length);
  } else floor(0, 0, SPAN, SPAN);
  buildLandmark(data, mats, {
    box, plane, lights, colliders, shapedColliders, water, ballPits, group,
    geometry: (g, mat, x, y, z) => add(g, mat, x, y, z),
  });
  const wallMeters = theme.wall.userData.surfaceMeters as number | undefined;
  for (const cut of data.cuts ?? []) {
    // An angled wall seals a dead corner. Its face sits on the room faces of
    // the two walls it joins, so nothing pokes into a neighboring cell.
    const cx = cut.cell % CHUNK,
      cz = Math.floor(cut.cell / CHUNK);
    const bx = cx * CELL,
      bz = cz * CELL;
    const height = ceilingAt(data, cx, cz);
    const { corner, from, to, normal, length } = cutSegment(cut);
    const mx = bx + (from[0] + to[0]) / 2,
      mz = bz + (from[1] + to[1]) / 2;
    const yaw = Math.atan2(normal[0], normal[1]);
    const face = new THREE.PlaneGeometry(length, height);
    add(face, theme.wall, mx, height / 2, mz, 0, yaw);
    if (wallMeters) {
      // World projection would stretch the paper on a diagonal: run it along the face.
      const position = face.getAttribute("position"),
        uv = face.getAttribute("uv");
      const dx = (to[0] - from[0]) / length,
        dz = (to[1] - from[1]) / length;
      for (let i = 0; i < position.count; i++) {
        const along =
          (position.getX(i) - ox - bx - from[0]) * dx +
          (position.getZ(i) - oz - bz - from[1]) * dz;
        uv.setXY(i, along / wallMeters, position.getY(i) / wallMeters);
      }
    }
    const inset = (d: number) => [mx + normal[0] * d, mz + normal[1] * d];
    const [kx, kz] = inset(0.025);
    box(length, 0.115, 0.05, kx, 0.058, kz, mats.trim, yaw);
    const [tx, tz] = inset(0.02);
    box(length, 0.055, 0.04, tx, height - 0.027, tz, mats.trim, yaw);
    const shadow = wallContactShadowGeometry(false, 1);
    shadow.scale(length / CELL, 1, 1);
    const [sx, sz] = inset(0.39);
    add(shadow, mats.shadow, sx, 0.006, sz, 0, yaw);
    // The collider fills the whole sealed triangle, not just a thin slab.
    const vertices: number[] = [];
    for (const [px, pz] of [corner, from, to])
      for (const y of [0, height]) vertices.push(ox + bx + px, y, oz + bz + pz);
    shapedColliders.push({
      bounds: new THREE.Box3().setFromArray(vertices),
      parts: [new Float32Array(vertices)],
    });
  }
  for (const run of data.stairs ?? []) {
    // Stairs to nowhere: carpeted steps climb a wall to a door that opens on plaster.
    const bx = (run.cell % CHUNK) * CELL,
      bz = Math.floor(run.cell / CHUNK) * CELL;
    const alongX = run.wall === N || run.wall === S;
    const blocks = stairBlocks(run);
    blocks.forEach(([x0, z0, x1, z1, top], index) => {
      box(x1 - x0, top, z1 - z0, bx + (x0 + x1) / 2, top / 2, bz + (z0 + z1) / 2, theme.floor);
      colliders.push(
        new THREE.Box3(
          new THREE.Vector3(ox + bx + x0, 0, oz + bz + z0),
          new THREE.Vector3(ox + bx + x1, top, oz + bz + z1),
        ),
      );
      if (index === blocks.length - 1) return;
      // Nosing on each tread's leading edge.
      const lead = alongX ? (run.dir > 0 ? x0 : x1) : run.dir > 0 ? z0 : z1;
      if (alongX)
        box(0.05, 0.035, STAIR_WIDTH, bx + lead + run.dir * 0.025, top - 0.012, bz + (z0 + z1) / 2, mats.trim);
      else
        box(STAIR_WIDTH, 0.035, 0.05, bx + (x0 + x1) / 2, top - 0.012, bz + lead + run.dir * 0.025, mats.trim);
    });
    const landing = STAIR_START + run.steps * STAIR_TREAD + STAIR_LANDING / 2;
    const along = run.dir > 0 ? landing : CELL - landing;
    const inward = run.wall === N || run.wall === W ? 1 : -1;
    const face = inward > 0 ? 0.09 : CELL - 0.09;
    const doorPart = (w: number, h: number, depth: number, u: number, y: number, mat: THREE.Material) => {
      const v = face + (inward * depth) / 2;
      if (alongX) box(w, h, depth, bx + along + u, y, bz + v, mat);
      else box(depth, h, w, bx + v, y, bz + along + u, mat);
    };
    const sill = run.rise;
    doorPart(0.86, 2.02, 0.05, 0, sill + 1.01, mats.wood);
    doorPart(0.07, 2.1, 0.08, -0.465, sill + 1.05, mats.trim);
    doorPart(0.07, 2.1, 0.08, 0.465, sill + 1.05, mats.trim);
    doorPart(1.0, 0.07, 0.08, 0, sill + 2.1, mats.trim);
    doorPart(0.05, 0.05, 0.11, 0.33 * run.dir, sill + 1.0, mats.metal);
  }
  if (data.playroom) buildPlayroom(data.playroom.palette);
  for (let cell = 0; cell < CHUNK * CHUNK; cell++) {
    const cx = cell % CHUNK,
      cz = Math.floor(cell / CHUNK);
    const height = ceilingAt(data, cx, cz);
    if (height < 9 || inLandmark(data.landmark, cx, cz)) continue;
    // Shafts keep the storeys they never built: bands and tubes climb every wall.
    const bits = data.cells[cell];
    const sides = [
      { bit: N, nx: cx, nz: cz - 1, x: (cx + 0.5) * CELL, z: cz * CELL + 0.09, alongX: true, inward: 1 },
      { bit: S, nx: cx, nz: cz + 1, x: (cx + 0.5) * CELL, z: (cz + 1) * CELL - 0.09, alongX: true, inward: -1 },
      { bit: W, nx: cx - 1, nz: cz, x: cx * CELL + 0.09, z: (cz + 0.5) * CELL, alongX: false, inward: 1 },
      { bit: E, nx: cx + 1, nz: cz, x: (cx + 1) * CELL - 0.09, z: (cz + 0.5) * CELL, alongX: false, inward: -1 },
    ];
    sides.forEach((side, index) => {
      // Over an open edge the wall only begins at the lower ceiling's header.
      const bottom = bits & side.bit ? Math.min(height, ceilingAt(data, side.nx, side.nz)) : 0;
      const offset = (d: number) => side.alongX
        ? [side.x, side.z + side.inward * d]
        : [side.x + side.inward * d, side.z];
      for (let storey = 1, y = HEIGHT; y < height - 0.6; storey++, y += HEIGHT) {
        if (y < bottom + 0.1) continue;
        const [px, pz] = offset(0.025);
        box(side.alongX ? CELL - 0.2 : 0.05, 0.09, side.alongX ? 0.05 : CELL - 0.2, px, y, pz, mats.trim);
        if ((storey + index) % 2) continue;
        const [lx, lz] = offset(0.05);
        box(side.alongX ? 1.3 : 0.1, 0.16, side.alongX ? 0.1 : 1.3, lx, y + 0.45, lz, mats.fixtures);
        const [gx, gz] = offset(0.101);
        plane(1.18, 0.1, gx, y + 0.45, gz, mats.luminous, 0,
          side.alongX ? (side.inward > 0 ? 0 : Math.PI) : (side.inward * Math.PI) / 2);
        if (storey <= 2) lights.push(new THREE.Vector3(ox + lx, y + 0.3, oz + lz));
      }
    });
  }
  if (lighting.lampCell !== null) {
    const at = lighting.lampCell;
    // Place the only lamp before clutter so its pool of light stays readable.
    if (
      !scatterFurniture(
        "lamp",
        at % CHUNK,
        Math.floor(at / CHUNK),
        "floor",
        true,
      )
    ) {
      lighting.mode = "fluorescent";
      lighting.fixtures.add(at);
      lighting.lampCell = null;
    }
  }
  let madePortal = false;
  // Own stream, so tube faults never shift the layout drawn from `rng`.
  const tubeRng = random(data.seed + 60521);
  const fixtureChannels = new Map<THREE.Vector3, number>();
  for (let cz = 0; cz < CHUNK; cz++)
    for (let cx = 0; cx < CHUNK; cx++) {
      const x = (cx + 0.5) * CELL,
        z = (cz + 0.5) * CELL,
        bits = data.cells[cz * CHUNK + cx];
      const landmark = inLandmark(data.landmark, cx, cz);
      const height = ceilingAt(data, cx, cz);
      plane(
        CELL, CELL, x, height, z,
        courtyard && landmark ? mats.courtyardWall : mats.top,
        Math.PI / 2, 0, 2.4,
      );
      const northHeight = Math.max(height, ceilingAt(data, cx, cz - 1));
      const westHeight = Math.max(height, ceilingAt(data, cx - 1, cz));
      // Play areas paint the plaster above their puffed walls.
      const funAt = (nx: number, nz: number) =>
        play.has(cz * CHUNK + cx) || (nx >= 0 && nz >= 0 && nx < CHUNK && nz < CHUNK && play.has(nz * CHUNK + nx))
          ? mats.funWall
          : theme.wall;
      if (!(bits & N)) wall(x, cz * CELL, false, northHeight, funAt(cx, cz - 1));
      else if (height !== ceilingAt(data, cx, cz - 1)) {
        const header = Math.min(height, ceilingAt(data, cx, cz - 1));
        box(
          CELL,
          northHeight - header,
          0.18,
          x,
          (northHeight + header) / 2,
          cz * CELL,
          theme.wall,
        );
      }
      if (!(bits & W)) wall(cx * CELL, z, true, westHeight, funAt(cx - 1, cz));
      else if (height !== ceilingAt(data, cx - 1, cz)) {
        const header = Math.min(height, ceilingAt(data, cx - 1, cz));
        box(
          0.18,
          westHeight - header,
          CELL,
          cx * CELL,
          (westHeight + header) / 2,
          z,
          theme.wall,
        );
      }
      if (
        courtyard && x > courtyard.x && x < courtyard.x + courtyard.width &&
        z > courtyard.z && z < courtyard.z + courtyard.length
      ) continue;
      const fixtureHeight = courtyard && landmark ? HEIGHT : height;
      const normallyLit =
        rng() > 0.14 ||
        (data.x === 0 && data.z === 0 && cx === 2) ||
        (landmark && data.landmark.kind === "levelFun");
      const at = cz * CHUNK + cx;
      const lit = lighting.cells.has(at)
        ? lighting.fixtures.has(at)
        : normallyLit;
      const tubeRoll = tubeRng(),
        tubePick = tubeRng();
      // The opening run, Level Fun, and open-sky courtyards keep steady tubes.
      const channel =
        !lit ||
        (data.x === 0 && data.z === 0 && cx === 2) ||
        (landmark && (courtyard || data.landmark.kind === "levelFun"))
          ? 0
          : pickFixtureChannel(tubeRoll, tubePick, lighting.cells.has(at));
      // Recessed lay-in troffer: a thin painted rim flush with the tile grid
      // and the lens just below it, rather than a surface-mounted box.
      box(
        landmark ? 2.4 : 1.3,
        0.024,
        0.68,
        x,
        fixtureHeight - 0.012,
        z,
        mats.troffer,
      );
      plane(
        landmark ? 2.3 : 1.2,
        0.6,
        x,
        fixtureHeight - 0.026,
        z,
        !lit ? mats.deadLight : channel ? mats.tubePanel : mats.luminous,
        Math.PI / 2,
      );
      if (channel) markTubePanel(batches.get(mats.tubePanel)!.at(-1)!, channel);
      if (lit) {
        const light = new THREE.Vector3(x + ox, fixtureHeight - 0.19, z + oz);
        lights.push(light);
        if (channel) fixtureChannels.set(light, channel);
      }
      // Landmarks have authored empty space and perimeter details of their own.
      if (landmark || shapedCells.has(at)) continue;
      const isSpawn = data.x === 0 && data.z === 0 && cx === 2 && cz >= 1;
      // Pillars break up open rooms without sealing a passage.
      const pillar = new THREE.Box3(
        new THREE.Vector3(x + 1.29, 0, z + 1.29),
        new THREE.Vector3(x + 1.91, height, z + 1.91),
      );
      if (
        bits === 15 && rng() < 0.38 && !isSpawn && !furnished.has(at) &&
        vacant(pillar)
      ) {
        box(0.57, height, 0.57, x + 1.6, height / 2, z + 1.6, theme.wall);
        box(0.62, 0.12, 0.62, x + 1.6, 0.06, z + 1.6, mats.trim);
        occupy(pillar);
        colliders.push(
          new THREE.Box3(
            new THREE.Vector3(ox + x + 1.315, 0, oz + z + 1.315),
            new THREE.Vector3(ox + x + 1.885, height, oz + z + 1.885),
          ),
        );
      }
      if (
        !isSpawn &&
        !furnished.has(at) &&
        chairRng() < (data.theme === "archive" ? 0.3 : 0.1)
      ) {
        const yaw = chairRng() * Math.PI * 2;
        const arrangement = chairRng();
        const kind = chairKinds[Math.floor(chairRng() * chairKinds.length)];
        const variant = Math.floor(chairRng() * furnitureVariants);
        // Chairs gather in one of the room's four quarters, never on a grid.
        const quarter = Math.floor(chairRng() * 4);
        const spot = (turn: number): [number, number] => {
          const q = (quarter + turn) % 4;
          return [
            x + (q % 2 ? -1 : 1) * (1.2 + chairRng() * 0.45),
            z + (q < 2 ? 1 : -1) * (1.2 + chairRng() * 0.45),
          ];
        };
        if (arrangement < 0.14) {
          if (
            !scatterFurniture(
              kind,
              cx,
              cz,
              chairRng() < 0.8 ? "wall" : "ceiling",
              false,
              variant,
            )
          )
            scatterFurniture(kind, cx, cz, "floor", false, variant);
        } else if (arrangement < 0.29) {
          // Only the wooden model has the seat/leg contract used by the piles.
          const source = model("chair", false, variant);
          const style =
            chairStackStyles[Math.floor(chairRng() * chairStackStyles.length)];
          // Sometimes two short piles replace the single tall tower.
          const paired = chairRng() < 0.3;
          const count = paired
            ? 2 + Math.floor(chairRng() * 2)
            : 3 + Math.floor(chairRng() * 3);
          const poses = chairStack(source.chair!, ...spot(0), yaw, count, chairRng, style);
          const bases = [0];
          if (paired) {
            bases.push(poses.length);
            poses.push(...chairStack(
              source.chair!, ...spot(2), yaw + Math.PI / 2, count, chairRng, style,
            ));
          }
          // Check each pile's solids, preserving the walking lane between them.
          if (poses.every((pose) => {
            const bounds = source.bounds.clone().applyMatrix4(pose);
            return bounds.max.y < height - 0.08 &&
              insideCell(bounds, cx, cz) &&
              leavesPassagesClear(bounds, cx, cz, bits) &&
              fits(source, pose);
          }))
            poses.forEach((pose, index) => furniture(
              "chair", pose,
              bases.includes(index) ? "floor" : "chair",
              false, variant,
            ));
          else
            for (let turn = 0; turn < 4; turn++)
              if (chair(...spot(turn), yaw, kind, variant, cx, cz)) break;
        } else {
          let placed: [number, number] | null = null;
          for (let turn = 0; turn < 4 && !placed; turn++) {
            const candidate = spot(turn);
            if (chair(...candidate, yaw, kind, variant, cx, cz)) placed = candidate;
          }
          if (placed && arrangement < 0.57) {
            // A second chair either sits beside the first or faces it.
            const facing = chairRng() < 0.4;
            const offset = facing
              ? new THREE.Vector3(0, 0, -1.15)
              : new THREE.Vector3(chairRng() < 0.5 ? 0.62 : -0.62, 0, 0.04);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            chair(
              placed[0] + offset.x, placed[1] + offset.z,
              yaw + (facing ? Math.PI : 0) + (chairRng() - 0.5) * 0.5,
              kind, variant, cx, cz,
            );
          }
        }
        furnished.add(at);
      }
      const shelving = new THREE.Box3(
        new THREE.Vector3(x - 0.57, 0, cz * CELL + 0.1),
        new THREE.Vector3(x + 0.57, 1.3, cz * CELL + 0.68),
      );
      if (
        !isSpawn && !furnished.has(at) && rng() < 0.075 && !(bits & N) &&
        vacant(shelving)
      ) {
        box(1.1, 1.3, 0.48, x, 0.65, cz * CELL + 0.36, mats.metal);
        for (let i = 0; i < 4; i++) {
          box(
            0.99,
            0.018,
            0.04,
            x,
            0.22 + i * 0.31,
            cz * CELL + 0.615,
            mats.trim,
          );
          box(
            0.22,
            0.025,
            0.05,
            x,
            0.32 + i * 0.31,
            cz * CELL + 0.65,
            mats.fixtures,
          );
        }
        colliders.push(
          new THREE.Box3(
            new THREE.Vector3(ox + x - 0.57, 0, oz + cz * CELL + 0.1),
            new THREE.Vector3(ox + x + 0.57, 1.3, oz + cz * CELL + 0.65),
          ),
        );
        occupy(shelving);
      }
      if (rng() < 0.08) {
        plane(
          0.19,
          0.27,
          x + 0.8,
          0.012,
          z - 0.7,
          mats.paper,
          -Math.PI / 2,
          rng() * 6,
        );
      }
      const exits = directionsCount(bits);
      if (
        !madePortal &&
        !isSpawn &&
        (exits === 1 || (cz === CHUNK - 1 && cx === CHUNK - 1))
      ) {
        let px = x,
          pz = z,
          angle = 0;
        const normal = new THREE.Vector3(0, 0, 1);
        if (!(bits & N)) {
          pz = cz * CELL + 0.105;
        } else if (!(bits & W)) {
          px = cx * CELL + 0.105;
          angle = Math.PI / 2;
          normal.set(1, 0, 0);
        } else if (!(bits & S)) {
          pz = (cz + 1) * CELL - 0.105;
          angle = Math.PI;
          normal.set(0, 0, -1);
        } else if (!(bits & E)) {
          px = (cx + 1) * CELL - 0.105;
          angle = -Math.PI / 2;
          normal.set(-1, 0, 0);
        } else continue;
        const material = new THREE.MeshBasicMaterial({
          color: "#4b513a",
          transparent: true,
          opacity: 0.36,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1.05, 2.2),
          material,
        );
        mesh.position.set(ox + px, 1.35, oz + pz);
        mesh.rotation.y = angle;
        group.add(mesh);
        portals.push({ position: mesh.position.clone(), normal, mesh });
        madePortal = true;
      }
    }
  const propKinds: FurnitureKind[] = [
    "sofa",
    "table",
    "lamp",
    "blocks",
    "slide",
    "springHorse",
    "filingCabinet",
    "bookcase",
    "bench",
    "sideTable",
    "utilityCart",
    "waterCooler",
    "photocopier",
    "archiveCartons",
  ];
  if (data.x === 0 && data.z === 0) {
    // Each tape begins with its own small selection of familiar objects.
    // Keep this shuffle independent of placement retries and chair generation.
    const selectionRng = random(data.seed + 76129);
    for (let i = propKinds.length - 1; i > 0; i--) {
      const j = Math.floor(selectionRng() * (i + 1));
      [propKinds[i], propKinds[j]] = [propKinds[j], propKinds[i]];
    }
    propKinds.splice(2 + Math.floor(selectionRng() * 2));
  }
  const available: { cx: number; cz: number }[] = [];
  for (let cz = 0; cz < CHUNK; cz++)
    for (let cx = 0; cx < CHUNK; cx++) {
      if (inLandmark(data.landmark, cx, cz)) continue;
      if (shapedCells.has(cz * CHUNK + cx)) continue;
      if (data.x === 0 && data.z === 0 && cx === 2 && cz >= 1) continue;
      if (
        portals.some(
          (portal) =>
            Math.floor((portal.position.x - ox) / CELL) === cx &&
            Math.floor((portal.position.z - oz) / CELL) === cz,
        )
      )
        continue;
      available.push({ cx, cz });
    }
  // A separate random stream keeps desks reproducible without changing the maze.
  const computerRng = random(data.seed + 93011);
  // Rotate home sites independently of furniture placement, without repeats
  // among a section's computers. Regenerated sections keep their sites.
  const homeOffset = hash(data.x, data.z, data.seed + 93013) % COMPUTER_HOMES.length;
  const placeComputer = (cx: number, cz: number, kind: ComputerKind) => {
    if (
      furnished.has(cz * CHUNK + cx) ||
      lighting.cells.has(cz * CHUNK + cx) ||
      shapedCells.has(cz * CHUNK + cx)
    )
      return false;
    const bits = data.cells[cz * CHUNK + cx];
    const source = model(kind);
    const sides = [W, N, E, S].filter((bit) => !(bits & bit));
    for (const side of sides) {
      // The front always faces into the room; computers never clip through walls.
      const yaw =
        side === N
          ? 0
          : side === W
            ? Math.PI / 2
            : side === S
              ? Math.PI
              : -Math.PI / 2;
      const pose = new THREE.Matrix4().makeRotationY(yaw);
      const local = source.bounds.clone().applyMatrix4(pose);
      const target = new THREE.Vector3(
        (cx + 0.5) * CELL,
        -local.min.y,
        (cz + 0.5) * CELL,
      );
      if (side === N) target.z = cz * CELL + 0.24 - local.min.z;
      if (side === S) target.z = (cz + 1) * CELL - 0.24 - local.max.z;
      if (side === W) target.x = cx * CELL + 0.24 - local.min.x;
      if (side === E) target.x = (cx + 1) * CELL - 0.24 - local.max.x;
      pose.setPosition(target);
      const bounds = source.bounds.clone().applyMatrix4(pose);
      if (!leavesPassagesClear(bounds, cx, cz, bits) || !fits(source, pose, 0.08))
        continue;
      const worldBounds = bounds
        .clone()
        .translate(new THREE.Vector3(ox, 0, oz))
        .expandByScalar(0.08);
      if (colliders.some((other) => other.intersectsBox(worldBounds))) continue;
      furniture(kind, pose);
      furnished.add(cz * CHUNK + cx);
      const screen = computerScreen(kind);
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        yaw,
      );
      computers.push({
        id: `${data.x},${data.z}:${data.seed}:${cx},${cz}`,
        kind,
        homeUrl:
          COMPUTER_HOMES[(homeOffset + computers.length) % COMPUTER_HOMES.length],
        position: screen.position
          .applyMatrix4(pose)
          .add(new THREE.Vector3(ox, 0, oz)),
        quaternion: rotation,
        normal: new THREE.Vector3(0, 0, 1).applyQuaternion(rotation),
        width: screen.width,
        height: screen.height,
      });
      return true;
    }
    return false;
  };
  if (data.x === 0 && data.z === 0) {
    // Retain a discoverable first terminal on the opening route.
    for (const cz of [4, 3, 2, 1]) {
      if (placeComputer(2, cz, computerKinds[Math.floor(computerRng() * 3)]))
        break;
    }
  }
  const computerCells = available
    .map((cell) => ({ ...cell, order: computerRng() }))
    .sort((a, b) => a.order - b.order);
  const firstModel = Math.floor(computerRng() * 3);
  // Previously three in every section; one or two now averages half as many.
  const computerCount = random(data.seed + 93017)() < 0.5 ? 1 : 2;
  for (const { cx, cz } of computerCells) {
    if (computers.length >= computerCount) break;
    const kind = [
      ...computerKinds.slice(firstModel),
      ...computerKinds.slice(0, firstModel),
    ].find((kind) => !computers.some((station) => station.kind === kind))!;
    placeComputer(cx, cz, kind);
  }
  // Familiar objects become rare landmarks; most of the maze remains empty.
  for (const { cx, cz } of available) {
    if (
      furnished.has(cz * CHUNK + cx) ||
      furnitureRng() > (data.theme === "archive" ? 0.21 : 0.13)
    )
      continue;
    const kind = propKinds[Math.floor(furnitureRng() * propKinds.length)];
    const abnormal = furnitureRng();
    const mode =
      abnormal < 0.23 + Math.min(depth, 4) * 0.06
        ? "wall"
        : abnormal < 0.38
          ? "ceiling"
          : "floor";
    if (!scatterFurniture(kind, cx, cz, mode))
      scatterFurniture(kind, cx, cz, "floor");
  }
  if (data.x === 0 && data.z === 0) {
    // Introduce only this tape's selected silhouettes near the opening route.
    // Later sections draw from the full set, and every placement respects exits.
    available.sort(
      (a, b) => Math.hypot(a.cx - 3, a.cz - 3) - Math.hypot(b.cx - 3, b.cz - 3),
    );
    for (const kind of propKinds) {
      if (propRecords.some((prop) => prop.kind === kind)) continue;
      for (const { cx, cz } of available) {
        if (furnished.has(cz * CHUNK + cx)) continue;
        const mode =
          kind === "table" ? "wall" : kind === "blocks" ? "ceiling" : "floor";
        if (
          scatterFurniture(kind, cx, cz, mode) ||
          scatterFurniture(kind, cx, cz, "floor")
        )
          break;
      }
    }
  }
  // One solitary chair in the opening vista makes scale immediately familiar.
  if (data.x === 0 && data.z === 0)
    for (const [dx, dz] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]])
      if (chair(CELL * 3.5 + dx, CELL * 2.5 + dz, 0.5)) break;
  const discovery = planDiscovery(data, available, furnished, colliders);
  group.userData.discoveries = discovery ? [discovery] : [];
  if (discovery) {
    for (const { geometry, material } of createDiscoveryParts(discovery, mats)) {
      geometry.translate(ox, 0, oz);
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material)!.push(geometry);
    }
  }
  // Reject intersecting arrangements only after all props/landmarks are present.
  // In particular the bottom chair of a deliberately interlocked pile stays fixed.
  const chunks = new Map([[`${data.x},${data.z}`, data]]);
  for (const obstacle of looseFurniture) {
    const b = obstacle.bounds;
    const interior = b.clone().expandByScalar(-0.025);
    const home = cellAt(chunks, (b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
    const ceiling = home ? ceilingAt(data, home.cx, home.cz) : HEIGHT;
    let clear = Math.abs(b.min.y) < 0.03 && b.max.y < ceiling - 0.03;
    const nx = Math.max(1, Math.ceil((b.max.x - b.min.x) / (CELL / 4)));
    const nz = Math.max(1, Math.ceil((b.max.z - b.min.z) / (CELL / 4)));
    for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
      const x = b.min.x + (b.max.x - b.min.x) * ix / nx;
      const z = b.min.z + (b.max.z - b.min.z) * iz / nz;
      if (!canStand(chunks, x, z, 0.02)) clear = false;
    }
    if (!clear || colliders.some((other) => other !== b && other.intersectsBox(interior))) {
      const object = obstacle.movable!.object;
      for (const child of object.children) {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
        mesh.geometry.translate(object.position.x, object.position.y, object.position.z);
        if (!batches.has(mesh.material)) batches.set(mesh.material, []);
        batches.get(mesh.material)!.push(mesh.geometry);
        mesh.dispose();
      }
      object.removeFromParent();
      obstacle.movable = undefined;
    }
  }
  const ambientLease = lighting.cells.size
    ? mats.ambientMaps.acquire(data, lighting)
    : null;
  const ambientMap = ambientLease?.texture;
  const ownedMaterials: THREE.Material[] = [];
  let tubes: THREE.BufferGeometry | null = null;
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    if (merged) {
      let surface = material;
      if (ambientMap && material instanceof THREE.MeshStandardMaterial) {
        const local = material.clone();
        configureSurfaceSampling(local);
        local.aoMap = ambientMap;
        local.emissiveMap = ambientMap;
        const positions = merged.getAttribute("position");
        const coordinates = new Float32Array(positions.count * 2);
        for (let i = 0; i < positions.count; i++) {
          coordinates[i * 2] = (positions.getX(i) - ox) / SPAN;
          coordinates[i * 2 + 1] = (positions.getZ(i) - oz) / SPAN;
        }
        merged.setAttribute("uv1", new THREE.BufferAttribute(coordinates, 2));
        ownedMaterials.push(local);
        surface = local;
      }
      const mesh = new THREE.Mesh(merged, surface);
      mesh.receiveShadow = true;
      mesh.castShadow =
        material !== mats.luminous &&
        material !== mats.tubePanel &&
        material !== mats.lampGlow &&
        material !== mats.shadow;
      group.add(mesh);
      if (material === mats.tubePanel) tubes = merged;
    }
    geometries.forEach((g) => g.dispose());
  }
  const occluders: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    // Bake static transforms and bounds once, before the first render/raycast.
    // Portals retain their animated scale; water moves in the vertex shader.
    if (!portals.some((portal) => portal.mesh === object)) {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    }
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    // Water receives its transparent renderer material after section creation.
    // Ball pits are thousands of instances: too costly to raycast as occluders.
    if (
      !water.includes(object) &&
      !(object instanceof THREE.InstancedMesh) &&
      !(object.material as THREE.Material).transparent
    )
      occluders.push(object);
  });
  group.updateMatrixWorld(true);
  return {
    group,
    lights,
    fixtureChannels,
    tubes,
    lampLights,
    portals,
    colliders,
    shapedColliders,
    water,
    ballPits,
    computers,
    occluders,
    dispose: () => {
      ownedMaterials.forEach((material) => material.dispose());
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          // Three r186 owns per-object WebGPU bindings separately from geometry.
          // Shared materials outlive sections, so release the retired mesh too.
          obj.dispose();
          obj.geometry.dispose();
          if (portals.some((p) => p.mesh === obj))
            (obj.material as THREE.Material).dispose();
        }
      });
      group.removeFromParent();
      ambientLease?.release();
    },
  };
}
function directionsCount(bits: number) {
  let count = 0;
  for (const bit of [N, E, S, W]) if (bits & bit) count++;
  return count;
}
