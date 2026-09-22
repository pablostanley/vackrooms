import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { CELL, SPAN, generateChunk } from "../src/lib/game/maze";
import { houseLots } from "../src/lib/game/neighborhood";
import { CharacterMotor } from "../src/lib/game/physics";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("neighborhood double jumps hit pitched roofs and can return to the street", async () => {
  // The nearest street on ?tape=199307&visit=neighborhood includes narrow
  // gables and wide houses with both ridge orientations, on both sides.
  const data = generateChunk(-3, -3, 199307);
  assert.equal(data.landmark.kind, "neighborhood");
  const mats = headlessMaterials(), section = buildSection(data, mats, 0);
  const room = data.landmark;
  const orientations = new Set<string>();
  try {
    for (const lot of houseLots(data)) {
      orientations.add(lot.rows === 1 || (lot.style >>> 3) % 2 === 0 ? "gable" : "parallel");
      const inward = -lot.side;
      const edge = (lot.side < 0 ? room.x : room.x + room.width) * CELL + data.x * SPAN;
      const center = (room.z + lot.row + lot.rows / 2) * CELL + data.z * SPAN;
      const flip = (lot.style >>> 4) % 2 ? 1 : -1;
      const doorAt = flip * (lot.rows === 2 ? -1.1 : -0.75);
      const motor = await CharacterMotor.create({ x: edge + inward * 4.1, z: center + doorAt });
      const position = new Vector3();
      try {
        motor.addSection("street", data, section.colliders, section.shapedColliders);
        for (let i = 0; i < 40; i++) motor.move(-inward * 0.01, 0, 1 / 60, position);
        for (let i = 0; i < 180; i++) {
          if (i === 0 || i === 18) motor.jump();
          motor.move(i < 70 ? -inward * 0.025 : 0, 0, 1 / 60, position);
        }
        assert.ok(motor.grounded, "a roof collision must not leave the player suspended");
        assert.ok(position.y < 2, `lot ${lot.side}/${lot.row} lands on its porch, not inside the roof`);
        assert.ok((position.x - edge) * inward > 3.5, "player stays outside the sealed house");
        for (let i = 0; i < 180; i++) motor.move(inward * 0.045, 0, 1 / 60, position);
        assert.ok((position.x - edge) * inward > 10, "the porch still exits onto the street");
        assert.ok(motor.grounded && Math.abs(position.y - 1.66) < 0.03);
      } finally {
        motor.dispose();
      }
    }
    assert.equal(orientations.size, 2);
  } finally {
    section.dispose();
    mats.dispose();
  }
});
