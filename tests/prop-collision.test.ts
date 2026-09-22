import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Matrix4, Vector3 } from "three";
import { createFurniture } from "../src/lib/game/furniture-models";
import { furnitureCollisionParts } from "../src/lib/game/furniture-collision";
import { CharacterMotor } from "../src/lib/game/physics";
import { EntityNavigation } from "../src/lib/game/entity-navigation";
import { CHUNK, generateChunk } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

for (const kind of ["utilityCart", "computerDesk"] as const) {
  test(`${kind} supports its visible surface after a jump, including rotated placements`, async () => {
    const mats = headlessMaterials(), model = createFurniture(kind, mats);
    try {
      for (const yaw of [0, Math.PI / 2, 0.73]) {
        const pose = new Matrix4().makeRotationY(yaw).setPosition(12, 0, 12);
        const bounds = model.bounds.clone().applyMatrix4(pose);
        const parts = furnitureCollisionParts(model, pose);
        assert.equal(parts.length, kind === "computerDesk" ? 9 : 15);
        const data = generateChunk(0, 0, 1);
        data.cells.fill(15);
        data.landmark = { kind: "lobby", x: 0, z: 0, width: CHUNK, length: CHUNK, height: 3.15 };
        const x = kind === "computerDesk" ? 0.73 : -0.12;
        const z = kind === "computerDesk" ? 0.25 : 0;
        const position = new Vector3(x, 1.66, 1.2).applyMatrix4(pose);
        const target = new Vector3(x, 0, z).applyMatrix4(pose);
        const delta = new Vector3(0, 0, (z - 1.2) / 30).transformDirection(pose).multiplyScalar((1.2 - z) / 30);
        const motor = await CharacterMotor.create(position);
        try {
          motor.addSection("0,0", data, [bounds], [{ bounds, parts }]);
          for (let i = 0; i < 5; i++) motor.move(0, 0, 1 / 60, position);
          motor.jump();
          for (let i = 0; i < 180; i++) {
            if (i === 8) motor.jump();
            const move = i >= 10 && i < 40;
            motor.move(move ? delta.x : 0, move ? delta.z : 0, 1 / 60, position);
          }
          const top = kind === "computerDesk" ? 0.8075 : 0.7025;
          assert.ok(motor.grounded);
          assert.ok(Math.hypot(position.x - target.x, position.z - target.z) < 0.03, "reached the real surface without an invisible front wall");
          assert.ok(Math.abs(position.y - 1.66 - top) < 0.015, `standing on ${kind} surface at yaw ${yaw}: ${position.y}`);
          // Navigation still reserves the complete footprint, not a route through legs.
          const nav = new EntityNavigation(); nav.addSection("0,0", data, [bounds]);
          assert.equal(nav.canOccupy(target), false);
          for (let i = 0; i < 70; i++) motor.move(-delta.x, -delta.z, 1 / 60, position);
          for (let i = 0; i < 60; i++) motor.move(0, 0, 1 / 60, position);
          assert.ok(motor.grounded && Math.abs(position.y - 1.66) < 0.02, "walked off onto the floor");
        } finally { motor.dispose(); }
      }
    } finally { model.parts.forEach(({ geometry }) => geometry.dispose()); mats.dispose(); }
  });
}

test("generated desks and carts retain coarse navigation bounds and separate physical solids", () => {
  const mats = headlessMaterials(), seen = new Set<string>();
  try {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 199307]) {
      const section = buildSection(generateChunk(0, 0, seed), mats, 0);
      try {
        for (const prop of section.group.userData.furniture as { kind: string; bounds: Box3 }[]) {
          if (prop.kind !== "computerDesk" && prop.kind !== "utilityCart") continue;
          const shaped = section.shapedColliders.find(({ bounds }) => bounds.equals(prop.bounds));
          assert.ok(shaped && section.colliders.includes(shaped.bounds));
          assert.equal(shaped.parts.length, prop.kind === "computerDesk" ? 9 : 15);
          seen.add(prop.kind);
        }
      } finally { section.dispose(); }
    }
    assert.deepEqual(seen, new Set(["computerDesk", "utilityCart"]));
  } finally { mats.dispose(); }
});

test("shared hull extraction preserves slide transforms across negative sections", () => {
  const mats = headlessMaterials(), model = createFurniture("slide", mats);
  try {
    const pose = new Matrix4().makeRotationY(0.73).scale(new Vector3(1, 0.84, 1));
    pose.setPosition(7.2, 0, 12);
    const translation = new Matrix4().makeTranslation(-57.6, 0, 115.2);
    const parts = furnitureCollisionParts(model, pose.clone().premultiply(translation));
    for (const [i, part] of model.parts.entries()) {
      const old = part.geometry.clone().applyMatrix4(pose).translate(-57.6, 0, 115.2);
      try {
        const expected = old.getAttribute("position").array;
        assert.equal(parts[i].length, expected.length);
        for (let vertex = 0; vertex < expected.length; vertex++)
          assert.ok(Math.abs(parts[i][vertex] - expected[vertex]) < 0.00002);
      } finally { old.dispose(); }
    }
  } finally { model.parts.forEach(({ geometry }) => geometry.dispose()); mats.dispose(); }
});
