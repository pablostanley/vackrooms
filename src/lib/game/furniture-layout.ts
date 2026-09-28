import { Box3, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { OBB } from "three/addons/math/OBB.js";
import { CELL, HEIGHT, N, E, S, W } from "./maze";
import type { ChairFrame, FurnitureModel } from "./furniture-models";

/** Attach a solid point on a rotated model to a solid point in the world. */
export function anchorPose(
  anchor: Vector3,
  target: Vector3,
  rotation: Euler,
  scale = 1,
) {
  const pose = new Matrix4().compose(
    new Vector3(),
    new Quaternion().setFromEuler(rotation),
    new Vector3(scale, scale, scale),
  );
  return pose.setPosition(
    target.clone().sub(anchor.clone().applyMatrix4(pose)),
  );
}

/** Oriented solids for every part of a placed model. */
export function partSolids(model: FurnitureModel, pose: Matrix4): OBB[] {
  const scale = new Vector3().setFromMatrixScale(pose);
  const rotation = new Matrix3().setFromMatrix4(
    new Matrix4().extractRotation(pose),
  );
  return model.parts.map(({ geometry }) => {
    const local = geometry.boundingBox!;
    return new OBB(
      local.getCenter(new Vector3()).applyMatrix4(pose),
      local.getSize(new Vector3()).multiply(scale).multiplyScalar(0.5),
      rotation.clone(),
    );
  });
}

/** True when any two solids overlap by more than the tolerated contact. */
export function solidsOverlap(a: readonly OBB[], b: readonly OBB[], contact = 0.002) {
  for (const first of a) {
    const shrunk = new OBB(
      first.center,
      first.halfSize.clone().subScalar(contact).max(new Vector3()),
      first.rotation,
    );
    for (const second of b) if (shrunk.intersectsOBB(second)) return true;
  }
  return false;
}

export const chairStackStyles = ["crooked", "aligned", "crossed", "spiral"] as const;
export type ChairStackStyle = (typeof chairStackStyles)[number];

/** Clearance between a hanging backrest and the furniture it passes. */
const pileGap = 0.008;
/** Hanging directions in the base chair's frame: front, +X, back, -X. */
const hang = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const hangYaw = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

/** The tallest pile that still leaves the top chair clear of the ceiling. */
export function maxChairPile(frame: ChairFrame) {
  return Math.max(1, Math.floor((HEIGHT - 0.12) / frame.seatTop));
}

/**
 * A janitor's pile: one upright chair, then chairs turned upside down. The
 * first rests seat-to-seat in front of the lower backrest; each later chair
 * rests its seat on the upturned legs below. Every backrest hangs clear of
 * the seat it passes, so solids touch without passing through each other.
 */
export function chairStack(
  frame: ChairFrame,
  x: number,
  z: number,
  yaw: number,
  count: number,
  rng: () => number,
  style: ChairStackStyle = "crooked",
): Matrix4[] {
  const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const poses = [
    new Matrix4().compose(new Vector3(x, 0, z), turn, new Vector3(1, 1, 1)),
  ];
  const { seatHalf, legInset, legHalf, backFront, seatTop } = frame;
  // Seat-to-seat, the upper seat stays in front of the lower back posts.
  const first = seatHalf + pileGap - backFront;
  // On upturned legs, the offset keeps the hanging back outside the lower
  // seat while the seat still covers the far pair of leg tips.
  const later = (first + seatHalf - legInset + legHalf) / 2;
  const side = rng() < 0.5 ? 1 : 3;
  const spin = rng() < 0.5 ? 1 : 3;
  const total = Math.min(count, maxChairPile(frame));
  const center = new Vector3(0, 0, -first);
  for (let i = 1; i < total; i++) {
    let direction: number;
    if (style === "aligned") direction = 0;
    else if (style === "crossed") direction = i % 2 ? 0 : side;
    else if (style === "spiral") direction = ((i - 1) * spin) % 4;
    else {
      // The second chair would hang its back into the upright backrest.
      const allowed = i === 1 ? [0, 1, 3] : i === 2 ? [0, 1, 3] : [0, 1, 2, 3];
      direction = allowed[Math.floor(rng() * allowed.length)];
    }
    const [dx, dz] = hang[direction];
    const step = i === 1 ? (direction ? first : 0) : later;
    center.x += dx * step;
    center.z += dz * step;
    const contact = i * seatTop;
    const rotation = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), yaw + hangYaw[direction])
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI));
    const position = center.clone().applyQuaternion(turn).add(new Vector3(x, 0, z));
    position.y = contact + seatTop;
    poses.push(new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)));
  }
  return poses;
}

/** Keep the room center and each open doorway connected around furniture. */
export function leavesPassagesClear(
  bounds: Box3,
  cx: number,
  cz: number,
  bits: number,
) {
  if (bounds.min.y > 1.85 || bounds.max.y < 0) return true;
  const x = (cx + 0.5) * CELL,
    z = (cz + 0.5) * CELL;
  const radius = 0.68;
  const overlaps = (x0: number, z0: number, x1: number, z1: number) =>
    bounds.max.x > x0 &&
    bounds.min.x < x1 &&
    bounds.max.z > z0 &&
    bounds.min.z < z1;
  if (overlaps(x - radius, z - radius, x + radius, z + radius)) return false;
  if (bits & N && overlaps(x - radius, cz * CELL - 0.25, x + radius, z))
    return false;
  if (bits & S && overlaps(x - radius, z, x + radius, (cz + 1) * CELL + 0.25))
    return false;
  if (bits & W && overlaps(cx * CELL - 0.25, z - radius, x, z + radius))
    return false;
  if (bits & E && overlaps(x, z - radius, (cx + 1) * CELL + 0.25, z + radius))
    return false;
  // Wall-clipped parts may protrude a little into the next room, never its center.
  return (
    bounds.min.x >= cx * CELL - 0.55 &&
    bounds.max.x <= (cx + 1) * CELL + 0.55 &&
    bounds.min.z >= cz * CELL - 0.55 &&
    bounds.max.z <= (cz + 1) * CELL + 0.55
  );
}
