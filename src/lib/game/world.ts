import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
  type ChunkData,
} from "./maze";
import type { Materials } from "./materials";
import {
  createFurniture,
  type FurnitureKind,
  type FurnitureModel,
} from "./furniture-models";
import {
  anchorPose,
  chairStack,
  leavesPassagesClear,
} from "./furniture-layout";

export interface Portal {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  mesh: THREE.Mesh;
}
export interface Section {
  group: THREE.Group;
  lights: THREE.Vector3[];
  portals: Portal[];
  colliders: THREE.Box3[];
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
    colliders: THREE.Box3[] = [];
  const theme = mats.forTheme(data.theme);
  const furnitureRng = random(data.seed + 3403);
  const models = new Map<FurnitureKind, FurnitureModel>();
  const furnished = new Set<number>();
  const propRecords: {
    kind: FurnitureKind;
    attachment: string;
    bounds: THREE.Box3;
  }[] = [];
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
    const uv = g.getAttribute("uv");
    if ([mats.wall, theme.wall].includes(mat as THREE.MeshStandardMaterial)) {
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        uv.setXY(
          i,
          (uv.getX(i) * (face < 2 ? d : w)) / 1.7,
          (uv.getY(i) * h) / HEIGHT,
        );
      }
    }
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
  function wall(x: number, z: number, vertical: boolean) {
    box(
      vertical ? 0.18 : CELL + 0.18,
      HEIGHT,
      vertical ? CELL + 0.18 : 0.18,
      x,
      HEIGHT / 2,
      z,
      theme.wall,
    );
    box(
      vertical ? 0.22 : CELL + 0.22,
      0.115,
      vertical ? CELL + 0.22 : 0.22,
      x,
      0.058,
      z,
      mats.trim,
    );
    box(
      vertical ? 0.21 : CELL + 0.21,
      0.055,
      vertical ? CELL + 0.21 : 0.21,
      x,
      HEIGHT - 0.027,
      z,
      mats.trim,
    );
    for (const side of [-1, 1]) {
      // Contact shadows soften the wall-to-carpet and wall-to-ceiling junctions.
      plane(
        vertical ? 0.65 : CELL,
        vertical ? CELL : 0.65,
        x + (vertical ? side * 0.39 : 0),
        0.006,
        z + (vertical ? 0 : side * 0.39),
        mats.shadow,
        -Math.PI / 2,
        side < 0 ? Math.PI : 0,
      );
    }
  }
  function model(kind: FurnitureKind) {
    if (!models.has(kind)) models.set(kind, createFurniture(kind, mats));
    return models.get(kind)!;
  }
  function furniture(
    kind: FurnitureKind,
    pose: THREE.Matrix4,
    attachment = "floor",
  ) {
    const source = model(kind);
    for (const part of source.parts) {
      const geometry = part.geometry
        .clone()
        .applyMatrix4(pose)
        .translate(ox, 0, oz);
      if (!batches.has(part.material)) batches.set(part.material, []);
      batches.get(part.material)!.push(geometry);
    }
    const bounds = source.bounds.clone().applyMatrix4(pose);
    propRecords.push({ kind, attachment, bounds: bounds.clone() });
    if (bounds.min.y < HEIGHT && bounds.max.y > 0.02)
      colliders.push(bounds.translate(new THREE.Vector3(ox, 0, oz)));
  }
  function chair(x: number, z: number, angle: number) {
    furniture(
      "chair",
      anchorPose(
        new THREE.Vector3(),
        new THREE.Vector3(x, 0, z),
        new THREE.Euler(0, angle, 0),
      ),
    );
  }
  function scatterFurniture(
    kind: FurnitureKind,
    cx: number,
    cz: number,
    mode: "floor" | "wall" | "ceiling",
  ) {
    const source = model(kind),
      bits = data.cells[cz * CHUNK + cx];
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
            HEIGHT - 0.025,
            z + (attempt % 3 ? -1.5 : 1.5),
          ),
          new THREE.Euler(
            2.4 + furnitureRng() * 0.95,
            furnitureRng() * Math.PI * 2,
            (furnitureRng() - 0.5) * 1.1,
          ),
        );
      } else {
        pose = anchorPose(
          new THREE.Vector3(),
          new THREE.Vector3(),
          new THREE.Euler(0, yaw, 0),
        );
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
          target.x += attempt % 2 ? -1.75 : 1.75;
          target.z += attempt % 3 ? -1.75 : 1.75;
        }
        pose.setPosition(target);
      }
      const bounds = source.bounds.clone().applyMatrix4(pose);
      if (leavesPassagesClear(bounds, cx, cz, bits)) {
        furniture(kind, pose, mode === "wall" && !wallBit ? "floor" : mode);
        furnished.add(cz * CHUNK + cx);
        return true;
      }
    }
    return false;
  }
  plane(
    SPAN,
    SPAN,
    SPAN / 2,
    0,
    SPAN / 2,
    theme.floor,
    -Math.PI / 2,
    0,
    data.theme === "pool" ? 3 : 4.8,
  );
  plane(SPAN, SPAN, SPAN / 2, HEIGHT, SPAN / 2, mats.top, Math.PI / 2, 0, 2.4);
  let madePortal = false;
  for (let cz = 0; cz < CHUNK; cz++)
    for (let cx = 0; cx < CHUNK; cx++) {
      const x = (cx + 0.5) * CELL,
        z = (cz + 0.5) * CELL,
        bits = data.cells[cz * CHUNK + cx];
      if (!(bits & N)) wall(x, cz * CELL, false);
      if (!(bits & W)) wall(cx * CELL, z, true);
      const lit = rng() > 0.14 || (data.x === 0 && data.z === 0 && cx === 2);
      box(1.28, 0.065, 0.67, x, HEIGHT - 0.045, z, mats.fixtures);
      plane(
        1.18,
        0.57,
        x,
        HEIGHT - 0.082,
        z,
        lit ? mats.luminous : mats.deadLight,
        Math.PI / 2,
      );
      if (lit) lights.push(new THREE.Vector3(x + ox, HEIGHT - 0.19, z + oz));
      const isSpawn = data.x === 0 && data.z === 0 && cx === 2 && cz >= 1;
      // Pillars break up open rooms without sealing a passage.
      if (bits === 15 && rng() < 0.38 && !isSpawn) {
        box(0.57, HEIGHT, 0.57, x + 1.6, HEIGHT / 2, z + 1.6, theme.wall);
        box(0.62, 0.12, 0.62, x + 1.6, 0.06, z + 1.6, mats.trim);
        colliders.push(
          new THREE.Box3(
            new THREE.Vector3(ox + x + 1.315, 0, oz + z + 1.315),
            new THREE.Vector3(ox + x + 1.885, HEIGHT, oz + z + 1.885),
          ),
        );
      }
      if (!isSpawn && rng() < (data.theme === "archive" ? 0.4 : 0.1)) {
        const yaw = rng() * Math.PI * 2;
        const count =
          data.theme === "archive" || rng() < 0.4
            ? 4 + Math.floor(rng() * 3)
            : 1;
        const poses = chairStack(x + 1.4, z + 1.4, yaw, count, furnitureRng);
        const pileBounds = new THREE.Box3();
        for (const pose of poses)
          pileBounds.union(model("chair").bounds.clone().applyMatrix4(pose));
        if (leavesPassagesClear(pileBounds, cx, cz, bits)) {
          poses.forEach((pose, index) =>
            furniture("chair", pose, index ? "chair" : "floor"),
          );
        } else chair(x + 1.4, z + 1.4, yaw);
        furnished.add(cz * CHUNK + cx);
        if (depth > 1 && rng() < 0.35)
          scatterFurniture("chair", cx, cz, "ceiling");
      }
      if (!isSpawn && rng() < 0.075 && !(bits & N)) {
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
      if (data.theme === "pool" && bits === 15 && !isSpawn && rng() < 0.25) {
        // An abandoned paddling basin occupies part of an otherwise ordinary office.
        box(1.8, 0.22, 1.8, x - 0.8, 0.11, z - 0.8, mats.tileWall);
        plane(1.58, 1.58, x - 0.8, 0.225, z - 0.8, mats.darkness, -Math.PI / 2);
        colliders.push(
          new THREE.Box3(
            new THREE.Vector3(ox + x - 1.7, 0, oz + z - 1.7),
            new THREE.Vector3(ox + x + 0.1, 0.3, oz + z + 0.1),
          ),
        );
      }
    }
  const propKinds: FurnitureKind[] = [
    "sofa",
    "table",
    "lamp",
    "blocks",
    "slide",
    "springHorse",
  ];
  const available: { cx: number; cz: number }[] = [];
  for (let cz = 0; cz < CHUNK; cz++)
    for (let cx = 0; cx < CHUNK; cx++) {
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
    // Introduce several readable silhouettes near the opening route, then let
    // procedural placement take over. Each placement still respects all exits.
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
    chair(CELL * 3.5 + 1.4, CELL * 2.5 + 1.4, 0.5);
  for (const source of models.values())
    source.parts.forEach((part) => part.geometry.dispose());
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    if (merged) {
      const mesh = new THREE.Mesh(merged, material);
      mesh.receiveShadow = true;
      mesh.castShadow = material !== mats.luminous && material !== mats.shadow;
      group.add(mesh);
    }
    geometries.forEach((g) => g.dispose());
  }
  return {
    group,
    lights,
    portals,
    colliders,
    dispose: () => {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (portals.some((p) => p.mesh === obj))
            (obj.material as THREE.Material).dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
function directionsCount(bits: number) {
  let count = 0;
  for (const bit of [N, E, S, W]) if (bits & bit) count++;
  return count;
}
export function createEntity(material: THREE.Material) {
  const entity = new THREE.Group();
  const limb = (a: number[], b: number[], radius: number) => {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b),
      delta = end.clone().sub(start);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.7, radius, delta.length(), 5),
      material,
    );
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.normalize(),
    );
    entity.add(mesh);
  };
  limb([0, 1.1, 0], [0.07, 2.3, 0], 0.09);
  limb([-0.02, 1.3, 0], [-0.29, 0.65, 0.05], 0.042);
  limb([-0.29, 0.65, 0.05], [-0.32, 0, 0.16], 0.029);
  limb([0.04, 1.3, 0], [0.3, 0.75, -0.1], 0.035);
  limb([0.3, 0.75, -0.1], [0.38, 0, 0.1], 0.025);
  limb([0, 2.15, 0], [-0.4, 1.6, 0], 0.035);
  limb([-0.4, 1.6, 0], [-0.62, 0.66, 0.15], 0.025);
  limb([0.05, 2.15, 0], [0.43, 1.7, 0], 0.035);
  limb([0.43, 1.7, 0], [0.59, 0.8, 0.15], 0.024);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), material);
  head.scale.set(0.9, 1.5, 0.8);
  head.position.set(0.07, 2.5, 0);
  entity.add(head);
  entity.visible = false;
  return entity;
}
