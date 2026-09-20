import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Euler, Matrix3, Matrix4, Vector3 } from "three";
import { OBB } from "three/addons/math/OBB.js";
import {
  anchorPose,
  chairStack,
  chairStackStyles,
  leavesPassagesClear,
} from "../src/lib/game/furniture-layout";
import { CELL, N, E, S, W, directions, random } from "../src/lib/game/maze";

// Exact chair solids, rather than a whole-chair bound that includes empty air.
const seatCenter = new Vector3(0, 0.45, 0);
const seatSize = new Vector3(0.48, 0.065, 0.48);
const legSize = new Vector3(0.045, 0.46, 0.045);
function orientedBox(center: Vector3, size: Vector3, pose: Matrix4) {
  const scale = new Vector3().setFromMatrixScale(pose);
  const rotation = new Matrix3().setFromMatrix4(
    new Matrix4().extractRotation(pose),
  );
  return new OBB(
    center.clone().applyMatrix4(pose),
    size.clone().multiply(scale).multiplyScalar(0.5),
    rotation,
  );
}

function boxAt(center: Vector3, size: Vector3) {
  return new Box3().setFromCenterAndSize(center, size);
}

test("every upper chair leg intersects the previous seat under seeded rotations", () => {
  for (const style of chairStackStyles) {
    for (let seed = 0; seed < 48; seed++) {
      for (const count of [2, 4, 6]) {
        const poses = chairStack(-13.4, 7.9, seed * 0.71, count, random(seed), style);
        assert.equal(poses.length, count);
        for (let i = 1; i < poses.length; i++) {
          const lowerSeat = orientedBox(seatCenter, seatSize, poses[i - 1]);
          const upperLeg = orientedBox(
            new Vector3(0.19, 0.23, 0.19),
            legSize,
            poses[i],
          );
          assert.ok(
            lowerSeat.intersectsOBB(upperLeg),
            `chair ${i} floats above its support for seed ${seed}, count ${count}`,
          );
        }
      }
    }
  }
});

test("all four base-chair legs rest on the floor at arbitrary placement and yaw", () => {
  for (const [x, z, yaw] of [
    [0, 0, 0],
    [-17.3, -8.9, 0.84],
    [22.1, -40.7, Math.PI],
    [-0.2, 3.4, Math.PI * 1.7],
  ]) {
    const [base] = chairStack(x, z, yaw, 4, random(18));
    for (const lx of [-0.19, 0.19]) {
      for (const lz of [-0.19, 0.19]) {
        const bottom = new Vector3(lx, 0, lz).applyMatrix4(base);
        assert.ok(Math.abs(bottom.y) < 1e-10);
        assert.ok(Math.hypot(bottom.x - x, bottom.z - z) < 0.28);
      }
    }
  }
});

test("the same tape produces the same stack while other seeds vary the pile", () => {
  const poseValues = (seed: number) =>
    chairStack(2.4, -12, 0.5, 5, random(seed)).map((pose) => pose.elements);
  assert.deepEqual(poseValues(199307), poseValues(199307));
  assert.notDeepEqual(poseValues(199307).slice(1), poseValues(199308).slice(1));
});

test("stack styles have distinct silhouettes and reproduce from the same tape", () => {
  const silhouettes = new Set<string>();
  for (const style of chairStackStyles) {
    const snapshot = () => chairStack(0, 0, 0, 5, random(42), style)
      .map((pose) => pose.elements);
    assert.deepEqual(snapshot(), snapshot());
    silhouettes.add(JSON.stringify(snapshot()));
  }
  assert.equal(silhouettes.size, chairStackStyles.length);
});

test("rotated and scaled furniture remains attached to a solid wall", () => {
  const wall = new OBB(
    new Vector3(-0.09, 1.5, -6),
    new Vector3(0.09, 1.5, 2),
  );
  const attachment = new Vector3(-0.06, 1.7, -6.2);
  const furnitureSize = new Vector3(1.4, 0.8, 0.6);
  const furnitureAnchor = new Vector3(0, -0.4, 0);
  for (const scale of [0.65, 1, 1.8]) {
    for (const rotation of [
      new Euler(0.42, -0.8, 1.1),
      new Euler(-1.2, 0.31, -0.64),
      new Euler(Math.PI / 2, Math.PI, 0.2),
    ]) {
      const pose = anchorPose(furnitureAnchor, attachment, rotation, scale);
      const placedAnchor = furnitureAnchor.clone().applyMatrix4(pose);
      assert.ok(placedAnchor.distanceTo(attachment) < 1e-10);
      assert.ok(
        orientedBox(new Vector3(), furnitureSize, pose).intersectsOBB(wall),
        "a tilted furniture solid must touch the wall, not hang beside it",
      );
    }
  }
});

test("furniture cannot obstruct room centers or open doorways, including negative cells", () => {
  for (const [cx, cz] of [
    [-7, -3],
    [-1, -1],
    [0, 0],
    [4, -8],
  ]) {
    const center = new Vector3((cx + 0.5) * CELL, 0.5, (cz + 0.5) * CELL);
    const toy = new Vector3(0.45, 1, 0.45);
    for (let bits = 0; bits < 16; bits++) {
      assert.equal(leavesPassagesClear(boxAt(center, toy), cx, cz, bits), false);
      for (const direction of directions) {
        const doorway = center.clone().add(
          new Vector3(direction.dx, 0, direction.dz).multiplyScalar(
            CELL / 2 - 0.2,
          ),
        );
        assert.equal(
          leavesPassagesClear(boxAt(doorway, toy), cx, cz, bits),
          !(bits & direction.bit),
          `blocked passage ${direction.bit} in cell ${cx},${cz}, mask ${bits}`,
        );
      }
    }
  }
});

test("overhead props allow walking below, but head-height and floor props block the lane", () => {
  const cx = -2,
    cz = -5;
  const x = (cx + 0.5) * CELL,
    z = (cz + 0.5) * CELL;
  const opening = N | E | S | W;
  assert.equal(
    leavesPassagesClear(
      new Box3(
        new Vector3(x - 0.7, 2.1, z - 0.4),
        new Vector3(x + 0.7, 2.7, z + 0.4),
      ),
      cx,
      cz,
      opening,
    ),
    true,
  );
  for (const bottom of [0, 0.8, 1.7]) {
    const prop = boxAt(
      new Vector3(x, bottom + 0.1, z),
      new Vector3(1.4, 0.2, 0.8),
    );
    assert.equal(leavesPassagesClear(prop, cx, cz, opening), false);
  }
});

test("wall-clipped props can overlap the wall without reaching the adjacent room center", () => {
  const cx = -3,
    cz = -1;
  const wallX = cx * CELL,
    z = (cz + 0.5) * CELL;
  const clipped = new Box3(
    new Vector3(wallX - 0.35, 0, z - 0.4),
    new Vector3(wallX + 0.8, 1.4, z + 0.4),
  );
  assert.equal(leavesPassagesClear(clipped, cx, cz, N | E | S), true);
  const reachingNextRoom = clipped.clone();
  reachingNextRoom.min.x = wallX - CELL / 2;
  assert.equal(leavesPassagesClear(reachingNextRoom, cx, cz, N | E | S), false);
});
