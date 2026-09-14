import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { CharacterMotor } from "../src/lib/game/physics";
import { generateChunk, CELL } from "../src/lib/game/maze";

test("Rapier capsule stops at a wall and slides along it", async () => {
  const position = new Vector3(CELL * 2.5, 1.66, CELL * 4.5),
    motor = await CharacterMotor.create(position);
  const wall = new Box3(new Vector3(13, 0, 17), new Vector3(13.2, 3, 25));
  motor.addSection("0,0", generateChunk(0, 0, 199307), [wall]);
  for (let i = 0; i < 120; i++) motor.move(0.04, -0.015, 1 / 60, position);
  assert.ok(position.x < 12.81, `stopped before wall: ${position.x}`);
  assert.ok(position.z < 20.4, `slid along wall: ${position.z}`);
  assert.ok(
    position.y > 1.6 && position.y < 1.8,
    `remained on floor: ${position.y}`,
  );
  motor.dispose();
});
test("streamed floors and noclip teleports keep the capsule grounded", async () => {
  const position = new Vector3(12, 1.66, 21.6),
    motor = await CharacterMotor.create(position);
  motor.addSection("0,0", generateChunk(0, 0, 199307), []);
  for (let i = 0; i < 30; i++) motor.move(0, 0, 1 / 60, position);
  assert.ok(position.y > 1.6 && position.y < 1.8);
  motor.clearSections();
  motor.teleport({ x: 12, z: 21.6 });
  motor.addSection("0,0", generateChunk(0, 0, 199307, 1), []);
  for (let i = 0; i < 30; i++) motor.move(0, -0.03, 1 / 60, position);
  assert.ok(position.z < 21 && position.y > 1.6);
  motor.dispose();
});
