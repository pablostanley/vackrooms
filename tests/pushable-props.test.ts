import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Group, Matrix4, Vector3 } from "three";
import { CharacterMotor, type ShapedObstacle } from "../src/lib/game/physics";
import { generateChunk } from "../src/lib/game/maze";
import { createFurniture } from "../src/lib/game/furniture-models";
import { furnitureCollisionParts } from "../src/lib/game/furniture-collision";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

async function push(mass: number, wall = false) {
  const mats = headlessMaterials();
  const source = createFurniture("chair", mats);
  const pose = new Matrix4().makeTranslation(12, -source.bounds.min.y, 12);
  const bounds = source.bounds.clone().applyMatrix4(pose);
  const object = new Group(); object.position.copy(bounds.getCenter(new Vector3()));
  const obstacle: ShapedObstacle = { bounds, parts: furnitureCollisionParts(source, pose), movable: { mass, object } };
  const data = generateChunk(0, 0, 199307); data.cells.fill(15); data.landmark = { kind: "lobby", x: 0, z: 0, width: 12, length: 12, height: 3.15 };
  const position = new Vector3(12, 1.66, 10.8);
  const motor = await CharacterMotor.create(position);
  try {
    const obstacles = [bounds];
    if (wall) obstacles.push(new Box3(new Vector3(10, 0, 14), new Vector3(14, 3, 14.2)));
    motor.addSection("0,0", data, obstacles, [obstacle]);
    const sounds: string[] = [];
    for (let i = 0; i < 100; i++) {
      motor.move(0, 0.035, 1 / 60, position);
      sounds.push(...motor.propSounds.map(sound => sound.kind));
    }
    assert.ok(sounds.includes("scrape"), "real grounded motion generates scrape events");
    if (mass === 7) assert.ok(sounds.includes("impact"), "tipping/contact generates impact events");
    const pushed = object.position.clone();
    for (let i = 0; i < 180; i++) motor.move(0, 0, 1 / 60, position);
    const settled = object.position.clone();
    for (let i = 0; i < 120; i++) {
      motor.move(0, 0, 1 / 60, position);
      assert.equal(motor.propSounds.length, 0, "settled furniture stays silent");
    }
    assert.ok(object.position.distanceTo(settled) < 0.03, "friction settles the prop");
    assert.ok(bounds.getCenter(new Vector3()).distanceTo(object.position) < 0.01, "navigation follows the mesh");
    if (wall) assert.ok(bounds.max.z < 14.06, `prop stops at wall: ${bounds.max.z}`);
    motor.removeSection("0,0");
    motor.addSection("0,0", data, []);
    motor.teleport({ x: 12, z: 10.8 });
    for (let i = 0; i < 100; i++) motor.move(0, 0.035, 1 / 60, position);
    assert.ok(position.z > 14, "unloading removes the dynamic body and its colliders");
    return pushed.z - 12;
  } finally {
    motor.dispose(); source.parts.forEach(({ geometry }) => geometry.dispose()); mats.dispose();
  }
}

test("body contact pushes real chair solids, heavier props resist, and props settle", async () => {
  const light = await push(7), heavy = await push(90);
  assert.ok(light > 1, `chair moves under sustained contact: ${light}`);
  assert.ok(heavy < light - 0.1, `mass resists pushing: light ${light}, heavy ${heavy}`);
  assert.ok(Math.abs(await push(7) - light) < 0.00001, "identical input produces identical physics");
});
test("pushed chairs cannot pass through a wall", async () => { await push(7, true); });

test("generated freestanding furniture moves but clipped props and chair piles remain fixed", () => {
  const mats = headlessMaterials(); let loose = 0, fixed = 0;
  try {
    for (const seed of [1, 2, 3, 199307]) {
      const section = buildSection(generateChunk(0, 0, seed), mats, 0);
      try {
        for (const prop of section.group.userData.furniture as { attachment: string; bounds: Box3 }[]) {
          const obstacle = section.shapedColliders.find(({ bounds }) => bounds.equals(prop.bounds));
          if (obstacle?.movable) {
            loose++;
            assert.equal(prop.attachment, "floor");
            const interior = prop.bounds.clone().expandByScalar(-0.025);
            assert.ok(!section.colliders.some(b => b !== obstacle.bounds && b.intersectsBox(interior)));
          } else fixed++;
        }
      } finally { section.dispose(); }
    }
    assert.ok(loose > 0 && fixed > 0);
  } finally { mats.dispose(); }
});

test("moving furniture refreshes navigation buckets across cells", async () => {
  const { EntityNavigation } = await import("../src/lib/game/entity-navigation");
  const data = generateChunk(0, 0, 199307); data.cells.fill(15);
  const bounds = new Box3(new Vector3(11.5, 0, 11.5), new Vector3(12.5, 1, 12.5));
  const navigation = new EntityNavigation(); navigation.addSection("0,0", data, [bounds]);
  assert.equal(navigation.canOccupy({ x: 12, z: 12 }), false);
  bounds.translate(new Vector3(6, 0, 0));
  navigation.refreshObstacles();
  assert.equal(navigation.canOccupy({ x: 12, z: 12 }), true);
  assert.equal(navigation.canOccupy({ x: 18, z: 12 }), false);
});
