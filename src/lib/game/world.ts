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
  function chair(x: number, z: number, angle: number, y = 0) {
    const parts: [
      number,
      number,
      number,
      number,
      number,
      number,
      THREE.Material,
    ][] = [
      [0.48, 0.065, 0.48, 0, 0.45, 0, mats.wood],
      [0.43, 0.055, 0.43, 0, 0.51, 0, mats.fabric],
    ];
    for (const dx of [-0.19, 0.19])
      for (const dz of [-0.19, 0.19])
        parts.push([0.045, 0.46, 0.045, dx, 0.23, dz, mats.wood]);
    for (const dx of [-0.21, 0.21])
      parts.push([0.035, 0.58, 0.035, dx, 0.76, 0.21, mats.wood]);
    for (const dy of [0.67, 0.81, 0.96])
      parts.push([0.45, 0.065, 0.028, 0, dy, 0.21, mats.wood]);
    for (const [w, h, d, px, py, pz, m] of parts)
      box(
        w,
        h,
        d,
        x + px * Math.cos(angle) + pz * Math.sin(angle),
        y + py,
        z - px * Math.sin(angle) + pz * Math.cos(angle),
        m,
        angle,
      );
    if (y < 0.5)
      colliders.push(
        new THREE.Box3(
          new THREE.Vector3(ox + x - 0.31, 0, oz + z - 0.31),
          new THREE.Vector3(ox + x + 0.31, 1.1, oz + z + 0.31),
        ),
      );
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
      if (!isSpawn && rng() < (data.theme === "archive" ? 0.45 : 0.11)) {
        chair(x + 1.35, z + 0.9, rng() * 6.28);
        if (data.theme === "archive" || rng() < 0.25)
          for (let i = 1; i < 4; i++)
            chair(
              x + 1.2 + (rng() - 0.5) * 0.5,
              z + 0.9 + (rng() - 0.5) * 0.5,
              rng() * 6.28,
              i * 0.65,
            );
        if (depth > 1 && rng() < 0.4)
          chair(x - 0.7, z + 1.1, 0.8, HEIGHT - 0.65);
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
  // One solitary chair in the opening vista makes scale immediately familiar.
  if (data.x === 0 && data.z === 0) chair(CELL * 3.68, CELL * 2.4, 0.5);
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
