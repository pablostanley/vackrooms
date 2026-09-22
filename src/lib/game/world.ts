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
  hash,
  inLandmark,
  ceilingAt,
  poolBounds,
  courtyardBounds,
  type ChunkData,
} from "./maze";
import { createDiscoveryParts, planDiscovery } from "./discoveries";
import { furnitureCollisionParts } from "./furniture-collision";
import { buildLandmark } from "./landmarks";
import { wallContactShadowGeometry } from "./wall-contact-shadow";
import { createRoomAmbientMap, planRoomLighting } from "./room-lighting";
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
  createFurniture,
  chairKinds,
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
} from "./furniture-layout";

export interface Portal {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  mesh: THREE.Mesh;
}
export interface Section {
  group: THREE.Group;
  lights: THREE.Vector3[];
  lampLights: THREE.Vector3[];
  portals: Portal[];
  colliders: THREE.Box3[];
  shapedColliders: ShapedObstacle[];
  water: THREE.Mesh[];
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
  const shapedColliders: ShapedObstacle[] = [];
  const computers: ComputerStation[] = [];
  const lampLights: THREE.Vector3[] = [];
  const lighting = planRoomLighting(data);
  group.userData.lighting = lighting;
  const theme = mats.forTheme(data.theme);
  const furnitureRng = random(data.seed + 3403);
  const chairRng = random(data.seed + 39217);
  const models = new Map<string, FurnitureModel>();
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
  function wall(x: number, z: number, vertical: boolean, height = HEIGHT) {
    // Collinear segments meet at cell edges. Extending them by their thickness
    // puts two faces at the same depth, exposing both themes at section seams.
    box(
      vertical ? 0.18 : CELL,
      height,
      vertical ? CELL : 0.18,
      x,
      height / 2,
      z,
      theme.wall,
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
  function model(kind: FurnitureKind, lampOn = false) {
    const key = `${kind}:${lampOn}`;
    if (!models.has(key)) models.set(key, createFurniture(kind, mats, lampOn));
    return models.get(key)!;
  }
  function furniture(
    kind: FurnitureKind,
    pose: THREE.Matrix4,
    attachment = "floor",
    lampOn = false,
  ) {
    const source = model(kind, lampOn);
    if (lampOn)
      lampLights.push(
        new THREE.Vector3(0, 1.4, 0)
          .applyMatrix4(pose)
          .add(new THREE.Vector3(ox, 0, oz)),
      );
    const shaped = kind === "slide" || kind === "utilityCart" || kind === "computerDesk";
    for (const part of source.parts) {
      const geometry = part.geometry.clone();
      // Furniture grain follows the object when it rotates or hangs from a wall.
      if (part.material.userData.surfaceMeters)
        projectSurfaceUVs(geometry, part.material.userData.surfaceMeters);
      geometry.applyMatrix4(pose).translate(ox, 0, oz);
      if (!batches.has(part.material)) batches.set(part.material, []);
      batches.get(part.material)!.push(geometry);
    }
    const bounds = source.bounds.clone().applyMatrix4(pose);
    propRecords.push({ kind, attachment, bounds: bounds.clone() });
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
  function chair(
    x: number,
    z: number,
    angle: number,
    kind: ChairKind = "chair",
  ) {
    furniture(
      kind,
      anchorPose(
        new THREE.Vector3(),
        new THREE.Vector3(x, -model(kind).bounds.min.y, z),
        new THREE.Euler(0, angle, 0),
      ),
    );
  }
  function scatterFurniture(
    kind: FurnitureKind,
    cx: number,
    cz: number,
    mode: "floor" | "wall" | "ceiling",
    lampOn = false,
  ) {
    const source = model(kind, lampOn),
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
          target.x += attempt % 2 ? -1.75 : 1.75;
          target.z += attempt % 3 ? -1.75 : 1.75;
        }
        pose.setPosition(target);
      }
      const bounds = source.bounds.clone().applyMatrix4(pose);
      if (leavesPassagesClear(bounds, cx, cz, bits)) {
        furniture(
          kind,
          pose,
          mode === "wall" && !wallBit ? "floor" : mode,
          lampOn,
        );
        furnished.add(cz * CHUNK + cx);
        return true;
      }
    }
    return false;
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
  buildLandmark(data, mats, { box, plane, lights, colliders, shapedColliders, water, group });
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
      if (!(bits & N)) wall(x, cz * CELL, false, northHeight);
      else if (height !== ceilingAt(data, cx, cz - 1))
        box(
          CELL,
          northHeight - HEIGHT,
          0.18,
          x,
          (northHeight + HEIGHT) / 2,
          cz * CELL,
          theme.wall,
        );
      if (!(bits & W)) wall(cx * CELL, z, true, westHeight);
      else if (height !== ceilingAt(data, cx - 1, cz))
        box(
          0.18,
          westHeight - HEIGHT,
          CELL,
          cx * CELL,
          (westHeight + HEIGHT) / 2,
          z,
          theme.wall,
        );
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
      box(
        landmark ? 2.4 : 1.28,
        0.065,
        0.67,
        x,
        fixtureHeight - 0.045,
        z,
        mats.fixtures,
      );
      plane(
        landmark ? 2.3 : 1.18,
        0.57,
        x,
        fixtureHeight - 0.082,
        z,
        lit ? mats.luminous : mats.deadLight,
        Math.PI / 2,
      );
      if (lit) lights.push(new THREE.Vector3(x + ox, fixtureHeight - 0.19, z + oz));
      // Landmarks have authored empty space and perimeter details of their own.
      if (landmark) continue;
      const isSpawn = data.x === 0 && data.z === 0 && cx === 2 && cz >= 1;
      // Pillars break up open rooms without sealing a passage.
      if (bits === 15 && rng() < 0.38 && !isSpawn && !furnished.has(at)) {
        box(0.57, HEIGHT, 0.57, x + 1.6, HEIGHT / 2, z + 1.6, theme.wall);
        box(0.62, 0.12, 0.62, x + 1.6, 0.06, z + 1.6, mats.trim);
        colliders.push(
          new THREE.Box3(
            new THREE.Vector3(ox + x + 1.315, 0, oz + z + 1.315),
            new THREE.Vector3(ox + x + 1.885, HEIGHT, oz + z + 1.885),
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
        if (arrangement < 0.14) {
          if (
            !scatterFurniture(
              kind,
              cx,
              cz,
              chairRng() < 0.8 ? "wall" : "ceiling",
            )
          )
            scatterFurniture(kind, cx, cz, "floor");
        } else if (arrangement < 0.29) {
          // Only the wooden model has the seat/leg contract used by the piles.
          const style =
            chairStackStyles[Math.floor(chairRng() * chairStackStyles.length)];
          // Sometimes two short piles replace the single tall tower.
          const paired = chairRng() < 0.3;
          const count = paired
            ? 2 + Math.floor(chairRng() * 2)
            : 3 + Math.floor(chairRng() * 3);
          const poses = chairStack(x + 1.4, z + 1.4, yaw, count, chairRng, style);
          if (paired)
            poses.push(...chairStack(
              x - 1.4, z - 1.4, yaw + Math.PI / 2, count, chairRng, style,
            ));
          // Check each pile's solids, preserving the walking lane between them.
          if (poses.every((pose) => leavesPassagesClear(
            model("chair").bounds.clone().applyMatrix4(pose), cx, cz, bits,
          )))
            poses.forEach((pose, index) => furniture(
              "chair", pose,
              index === 0 || (paired && index === count) ? "floor" : "chair",
            ));
          else chair(x + 1.4, z + 1.4, yaw, kind);
        } else {
          chair(x + 1.4, z + 1.4, yaw, kind);
          if (arrangement < 0.57)
            chair(x + 1.4, z - 1.4, yaw + 0.3 + chairRng() * 0.7, kind);
        }
        furnished.add(at);
      }
      if (!isSpawn && !furnished.has(at) && rng() < 0.075 && !(bits & N)) {
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
    if (furnished.has(cz * CHUNK + cx) || lighting.cells.has(cz * CHUNK + cx))
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
      if (!leavesPassagesClear(bounds, cx, cz, bits)) continue;
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
    chair(CELL * 3.5 + 1.4, CELL * 2.5 + 1.4, 0.5);
  const discovery = planDiscovery(data, available, furnished, colliders);
  group.userData.discoveries = discovery ? [discovery] : [];
  if (discovery) {
    for (const { geometry, material } of createDiscoveryParts(discovery, mats)) {
      geometry.translate(ox, 0, oz);
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material)!.push(geometry);
    }
  }
  for (const source of models.values())
    source.parts.forEach((part) => part.geometry.dispose());
  const ambientMap = lighting.cells.size
    ? createRoomAmbientMap(data, lighting)
    : null;
  const ownedMaterials: THREE.Material[] = [];
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
        material !== mats.lampGlow &&
        material !== mats.shadow;
      group.add(mesh);
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
    if (
      !water.includes(object) &&
      !(object.material as THREE.Material).transparent
    )
      occluders.push(object);
  });
  group.updateMatrixWorld(true);
  return {
    group,
    lights,
    lampLights,
    portals,
    colliders,
    shapedColliders,
    water,
    computers,
    occluders,
    dispose: () => {
      ambientMap?.dispose();
      ownedMaterials.forEach((material) => material.dispose());
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
