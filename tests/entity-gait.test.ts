import assert from "node:assert/strict";
import test from "node:test";
import { gaitUrgency, solveEntityLeg, stepLength } from "../src/lib/game/entity-gait";

test("swing feet leave and meet the floor with zero vertical and toe-pitch velocity", () => {
  const epsilon = 1e-5;
  for (const speed of [0.38, 1.2, 2.85, 4.65]) {
    for (const motion of [0.1, 0.5, 1]) {
      const solve = (gait: number) => solveEntityLeg(gait, speed, motion, 1.15);
      const toe = (gait: number) => {
        const { hip, knee, ankle } = solve(gait);
        return hip + knee + ankle;
      };
      for (const boundary of [Math.PI / 2, Math.PI * 1.5]) {
        const left = solve(boundary - epsilon), right = solve(boundary + epsilon);
        assert.ok(Math.abs((right.footY - left.footY) / (2 * epsilon)) < 1e-4);
        assert.ok(Math.abs((toe(boundary + epsilon) - toe(boundary - epsilon)) / (2 * epsilon)) < 1e-4);
        assert.ok(Math.abs(solve(boundary).footY - 0.05) < 1e-10);
      }
      const apex = solve(Math.PI);
      assert.ok(Math.abs(apex.footY - (0.05 + (0.15 + gaitUrgency(speed) * 0.18) * motion)) < 1e-10, "peak clearance is unchanged");
      const first = solve(-Math.PI / 2), last = solve(Math.PI / 2);
      assert.ok(Math.abs(first.footZ - last.footZ - stepLength(speed) * motion) < 1e-10, "stride length is unchanged");
      for (let i = 0; i <= 240; i++) {
        const pose = solve(i * Math.PI / 120);
        assert.ok(pose.footY >= 0.05);
        assert.ok([pose.hip, pose.knee, pose.ankle].every(Number.isFinite));
      }
    }
  }
});
