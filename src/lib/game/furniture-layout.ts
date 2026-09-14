import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { CELL, N, E, S, W } from "./maze";

const seatContact = new Vector3(0, 0.455, 0);
export const chairLegContact = new Vector3(0.19, 0.11, 0.19);

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

/** Every upper chair's leg penetrates the seat directly below it. */
export function chairStack(
  x: number,
  z: number,
  yaw: number,
  count: number,
  rng: () => number,
): Matrix4[] {
  const poses = [
    anchorPose(new Vector3(), new Vector3(x, 0, z), new Euler(0, yaw, 0)),
  ];
  for (let i = 1; i < count; i++) {
    const contact = seatContact.clone().applyMatrix4(poses[i - 1]);
    poses.push(
      anchorPose(
        chairLegContact,
        contact,
        new Euler(
          (rng() - 0.5) * 0.32,
          yaw + (i % 2) * Math.PI + (rng() - 0.5) * 1.5,
          (rng() - 0.5) * 0.38,
        ),
      ),
    );
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
