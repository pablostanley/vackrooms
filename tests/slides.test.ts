import assert from "node:assert/strict";
import test from "node:test";
import { Matrix4, Vector3 } from "three";
import { CharacterMotor } from "../src/lib/game/physics";
import { createFurniture } from "../src/lib/game/furniture-models";
import { CHUNK, HEIGHT, SPAN, generateChunk } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("walk up, stand on, and walk down rotated slides without jumping", async () => {
  const mats = headlessMaterials();
  const slide = createFurniture("slide", mats);
  try {
    for (const [sectionX, sectionZ, yaw] of [[0, 0, 0], [0, 0, 0.73], [-1, 1, Math.PI / 2], [1, -1, Math.PI]]) {
      const data = generateChunk(sectionX, sectionZ, 2);
      data.cells.fill(15);
      data.landmark = { kind: "lobby", x: 0, z: 0, width: CHUNK, length: CHUNK, height: HEIGHT };
      const pose = new Matrix4().makeRotationY(yaw).scale(new Vector3(1, 0.84, 1));
      pose.setPosition(sectionX * SPAN + 12, 0, sectionZ * SPAN + 12);
      const bounds = slide.bounds.clone().applyMatrix4(pose);
      const parts = slide.parts.map(({ geometry }) => {
        const placed = geometry.clone().applyMatrix4(pose);
        const vertices = new Float32Array(placed.getAttribute("position").array);
        placed.dispose();
        return vertices;
      });
      const position = new Vector3(0, 1.66, 2).applyMatrix4(pose);
      const motor = await CharacterMotor.create(position);
      const key = `${sectionX},${sectionZ}`;
      try {
        motor.addSection(key, data, [bounds], [{ bounds, parts }]);
        const forward = new Vector3(0, 0, -1).transformDirection(pose);
        const top = new Vector3(0, 0, -0.85).applyMatrix4(pose);
        for (let i = 0; i < 180 && Math.hypot(position.x - top.x, position.z - top.z) > 0.03; i++)
          motor.move(forward.x * 0.025, forward.z * 0.025, 1 / 60, position);
        assert.ok(Math.hypot(position.x - top.x, position.z - top.z) < 0.05, `reached platform at yaw ${yaw}: ${position.toArray()}`);
        assert.ok(position.y > 2.93 && position.y < 3, `stood on platform below ceiling: ${position.y}`);
        const standing = position.clone();
        for (let i = 0; i < 120; i++) motor.move(0, 0, 1 / 60, position);
        assert.ok(motor.grounded && position.distanceTo(standing) < 0.02, "platform holds still");
        // Stop halfway down the chute: a walkable slope should hold the feet.
        for (let i = 0; i < 50; i++) motor.move(-forward.x * 0.025, -forward.z * 0.025, 1 / 60, position);
        const slope = position.clone();
        for (let i = 0; i < 90; i++) motor.move(0, 0, 1 / 60, position);
        assert.ok(motor.grounded && position.distanceTo(slope) < 0.04, "ramp holds still");
        for (let i = 0; i < 90; i++) motor.move(-forward.x * 0.025, -forward.z * 0.025, 1 / 60, position);
        assert.ok(motor.grounded && position.y > 1.6 && position.y < 1.7, "back on floor");
        motor.removeSection(key);
        motor.addSection(key, data, [bounds], [{ bounds, parts }]);
        motor.move(0, 0, 1 / 60, position);
        assert.ok(motor.grounded, "shaped collision survives section replacement");
      } finally { motor.dispose(); }
    }
  } finally {
    slide.parts.forEach(({ geometry }) => geometry.dispose());
    mats.dispose();
  }
});

test("generated slides retain navigation bounds and provide physical ramps", async () => {
  const mats = headlessMaterials();
  let traversed = 0;
  try {
    for (const seed of [1, 2, 3, 4, 5, 8, 199307]) {
      const data = generateChunk(0, 0, seed);
      const section = buildSection(data, mats, 0);
      try {
        const floorSlides = section.group.userData.furniture.filter(
          (prop: { kind: string; attachment: string }) => prop.kind === "slide" && prop.attachment === "floor",
        );
        for (const prop of floorSlides) {
          const shaped = section.shapedColliders.find(({ bounds }) => bounds.equals(prop.bounds));
          assert.ok(shaped && section.colliders.includes(shaped.bounds));
          // Platform and foot are independently authored solid meshes.
          const center = (vertices: Float32Array) => {
            const result = new Vector3();
            for (let i = 0; i < vertices.length; i += 3)
              result.add(new Vector3(vertices[i], vertices[i + 1], vertices[i + 2]));
            return result.multiplyScalar(3 / vertices.length);
          };
          const top = center(shaped.parts[0]);
          const foot = center(shaped.parts.at(-1)!);
          const forward = top.clone().sub(foot).setY(0).normalize();
          const position = foot.clone().addScaledVector(forward, -0.55).setY(1.66);
          const motor = await CharacterMotor.create(position);
          try {
            motor.addSection("0,0", data, section.colliders, section.shapedColliders);
            for (let i = 0; i < 180 && Math.hypot(position.x - top.x, position.z - top.z) > 0.04; i++)
              motor.move(forward.x * 0.025, forward.z * 0.025, 1 / 60, position);
            assert.ok(Math.hypot(position.x - top.x, position.z - top.z) < 0.06, `generated slide is climbable on tape ${seed}: ${position.toArray()}`);
            assert.ok(motor.grounded && position.y > 2.9 && position.y < 3.03);
            traversed++;
          } finally { motor.dispose(); }
        }
      } finally { section.dispose(); }
    }
    assert.ok(traversed >= 3, `tested real slide placements: ${traversed}`);
  } finally { mats.dispose(); }
});
