import * as THREE from "three";
import { CELL, CHUNK, SPAN, N, E, S, W, random, type ChunkData } from "./maze";
import type { Materials } from "./materials";
import { leavesPassagesClear } from "./furniture-layout";

export interface Discovery {
  cell: number;
  variant: number;
  pose: THREE.Matrix4;
  bounds: THREE.Box3;
}

/** One quiet find in a few office sections, using an independent tape stream. */
export function planDiscovery(
  data: ChunkData,
  available: readonly { cx: number; cz: number }[],
  furnished: ReadonlySet<number>,
  colliders: readonly THREE.Box3[],
): Discovery | null {
  if ((data.x === 0 && data.z === 0) || (data.theme !== "offices" && data.theme !== "archive")) return null;
  const rng = random(data.seed + 713893);
  if (rng() >= 0.12) return null;
  const candidates = available.filter(({ cx, cz }) => {
    const cell = cz * CHUNK + cx;
    return !furnished.has(cell) && [N, E, S, W].includes(data.cells[cell]);
  }).map((cell) => ({ ...cell, order: rng() })).sort((a, b) => a.order - b.order);
  for (const { cx, cz } of candidates) {
    const cell = cz * CHUNK + cx;
    const entrance = data.cells[cell];
    // Model faces +Z; the back wall is opposite the only exit.
    const yaw = entrance === S ? 0 : entrance === N ? Math.PI : entrance === E ? Math.PI / 2 : -Math.PI / 2;
    const x = (cx + 0.5) * CELL + (entrance === E ? -CELL / 2 : entrance === W ? CELL / 2 : 0);
    const z = (cz + 0.5) * CELL + (entrance === S ? -CELL / 2 : entrance === N ? CELL / 2 : 0);
    const pose = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    const bounds = new THREE.Box3(new THREE.Vector3(-0.19, 0, 0.11), new THREE.Vector3(0.19, 1.88, 0.39)).applyMatrix4(pose);
    if (!leavesPassagesClear(bounds, cx, cz, entrance)) continue;
    const worldBounds = bounds.clone().translate(new THREE.Vector3(data.x * SPAN, 0, data.z * SPAN));
    if (colliders.some((other) => other.intersectsBox(worldBounds))) continue;
    return { cell, variant: Math.floor(rng() * 3), pose, bounds };
  }
  return null;
}

/** Small original VHS prop and pinned maintenance note; all parts join normal batches. */
export function createDiscoveryParts(discovery: Discovery, mats: Materials) {
  const parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    geometry.translate(x, y, z).applyMatrix4(discovery.pose);
    parts.push({ geometry, material });
  };
  add(new THREE.BoxGeometry(0.32, 0.4, 0.004), mats.paper, 0, 1.65, 0.113);
  add(new THREE.PlaneGeometry(0.32, 0.4), mats.discoveryNotes[discovery.variant], 0, 1.65, 0.116);
  add(new THREE.BoxGeometry(0.035, 0.075, 0.003), mats.cream, 0, 1.84, 0.119);
  // Actual cassette proportions, paper label with two recessed reel windows.
  add(new THREE.BoxGeometry(0.188, 0.026, 0.104), mats.metal, 0.035, 0.013, 0.32);
  add(new THREE.BoxGeometry(0.072, 0.002, 0.054), mats.paper, 0.035, 0.027, 0.32);
  for (const x of [-0.027, 0.097]) {
    add(new THREE.BoxGeometry(0.037, 0.002, 0.058), mats.enamel, x, 0.027, 0.32);
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 12), mats.cream, x, 0.029, 0.32);
  }
  add(new THREE.BoxGeometry(0.027, 0.001, 0.003), mats.fadedRed, 0.04, 0.029, 0.327);
  return parts;
}
