import assert from "node:assert/strict";
import test from "node:test";
import { Raycaster, Vector3 } from "three";
import {
  CELL,
  CHUNK,
  SPAN,
  N,
  E,
  S,
  W,
  canStand,
  courtyardBounds,
  generateChunk,
} from "../src/lib/game/maze";
import { CharacterMotor } from "../src/lib/game/physics";
import { EntityNavigation } from "../src/lib/game/entity-navigation";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("courtyards recur sparsely, alternate access, and survive regeneration without changing shared gates", () => {
  for (const seed of [0, 1, 2, 42, 199307, 882731]) {
    const variants = new Set();
    for (let bz = -2; bz <= 1; bz++)
      for (let bx = -2; bx <= 1; bx++) {
        let count = 0;
        for (let z = bz * 5; z < bz * 5 + 5; z++)
          for (let x = bx * 5; x < bx * 5 + 5; x++) {
            const data = generateChunk(x, z, seed);
            if (data.landmark.kind !== "courtyard") continue;
            count++;
            variants.add(data.landmark.courtyard);
            assert.deepEqual(
              data.landmark,
              generateChunk(x, z, seed, 11).landmark,
            );
            const east = generateChunk(x + 1, z, seed, 8);
            const south = generateChunk(x, z + 1, seed, 9);
            for (let c = 0; c < CHUNK; c++) {
              assert.equal(
                !!(data.cells[c * CHUNK + CHUNK - 1] & E),
                !!(east.cells[c * CHUNK] & W),
              );
              assert.equal(
                !!(data.cells[(CHUNK - 1) * CHUNK + c] & S),
                !!(south.cells[c] & N),
              );
            }
            for (const [dx, dz] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ])
              assert.notEqual(
                generateChunk(x + dx, z + dz, seed).landmark.kind,
                "courtyard",
              );
          }
        assert.equal(count, 1, "exactly one courtyard per 25 sections");
      }
    assert.deepEqual(variants, new Set(["ground", "overlook"]));
  }
});

for (const [variant, cx] of [
  ["ground", -3],
  ["overlook", 3],
] as const) {
  test(`${variant} courtyard keeps all four gates connected around its actual facade`, () => {
    const data = generateChunk(cx, -2, 199307);
    assert.equal(data.landmark.courtyard, variant);
    const mats = headlessMaterials(),
      section = buildSection(data, mats, 0);
    const navigation = new EntityNavigation();
    navigation.addSection(`${cx},-2`, data, section.colliders);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      navigation.addSection(
        `${cx + dx},${-2 + dz}`,
        generateChunk(cx + dx, -2 + dz, 199307),
        [],
      );
    const ox = cx * SPAN,
      oz = -2 * SPAN;
    try {
      const size = CHUNK * 8,
        step = CELL / 8;
      const free = new Uint8Array(size * size);
      for (let iz = 0; iz < size; iz++)
        for (let ix = 0; ix < size; ix++)
          free[iz * size + ix] = Number(
            navigation.canOccupy({
              x: ox + (ix + 0.5) * step,
              z: oz + (iz + 0.5) * step,
            }),
          );
      const gates: number[] = [];
      for (let c = 0; c < CHUNK; c++) {
        const center = c * 8 + 4;
        if (data.cells[c] & N) gates.push(center);
        if (data.cells[(CHUNK - 1) * CHUNK + c] & S)
          gates.push((size - 1) * size + center);
        if (data.cells[c * CHUNK] & W) gates.push(center * size);
        if (data.cells[c * CHUNK + CHUNK - 1] & E)
          gates.push(center * size + size - 1);
      }
      const queue = [gates[0]],
        seen = new Set(queue);
      for (const at of queue)
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = (at % size) + dx,
            z = Math.floor(at / size) + dz,
            next = z * size + x;
          if (
            x < 0 ||
            z < 0 ||
            x >= size ||
            z >= size ||
            !free[next] ||
            seen.has(next)
          )
            continue;
          seen.add(next);
          queue.push(next);
        }
      assert.equal(gates.length, 4);
      for (const gate of gates) assert.ok(free[gate] && seen.has(gate));
      const court = courtyardBounds(data.landmark)!;
      const centerX = court.x + court.width / 2,
        centerZ = court.z + court.length / 2;
      assert.equal(
        navigation.canOccupy({ x: ox + centerX, z: oz + centerZ }),
        variant === "ground",
      );
      assert.equal(
        canStand(new Map([[`${cx},-2`, data]]), ox + centerX, oz + centerZ),
        variant === "ground",
      );
      assert.ok(
        section.group.children.length < 40,
        "repeated windows remain material-batched",
      );
      const ground = new Raycaster(
        new Vector3(ox + centerX, 1, oz + centerZ),
        new Vector3(0, -1, 0),
      );
      const hits = ground.intersectObject(section.group, true);
      assert.ok(hits.length);
      assert.ok(
        Math.abs(hits[0].point.y - court.floorY) < 0.06,
        "visible patio floor matches the physical recess",
      );
    } finally {
      section.dispose();
      mats.dispose();
    }
  });

  test(`${variant} Rapier ${variant === "ground" ? "enters and leaves the patio" : "blocks walking and boosted jumps through all overlook windows"}`, async () => {
    const data = generateChunk(cx, -2, 199307),
      court = courtyardBounds(data.landmark)!;
    const mats = headlessMaterials(),
      section = buildSection(data, mats, 0);
    const ox = cx * SPAN,
      oz = -2 * SPAN;
    const doorX = court.x + (Math.floor(court.width / CELL / 2) + 0.5) * CELL;
    const doorZ = court.z + (Math.floor(court.length / CELL / 2) + 0.5) * CELL;
    const position = new Vector3(),
      motor = await CharacterMotor.create({
        x: ox + doorX,
        z: oz + court.z - 1,
      });
    try {
      motor.addSection(
        `${cx},-2`,
        data,
        section.colliders,
        section.shapedColliders,
      );
      for (const [px, pz, dx, dz] of [
        [doorX, court.z - 1, 0, 1],
        [doorX, court.z + court.length + 1, 0, -1],
        [court.x - 1, doorZ, 1, 0],
        [court.x + court.width + 1, doorZ, -1, 0],
      ]) {
        motor.teleport({ x: ox + px, z: oz + pz });
        for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
        const start = position.clone();
        for (let i = 0; i < 150; i++) {
          if (variant === "overlook" && (i === 35 || i === 47)) motor.jump();
          motor.move(dx * 0.045, dz * 0.045, 1 / 60, position);
        }
        const progress =
          (position.x - start.x) * dx + (position.z - start.z) * dz;
        if (variant === "ground") {
          assert.ok(progress > 5, "walks through the real doorway");
          for (let i = 0; i < 150; i++)
            motor.move(-dx * 0.045, -dz * 0.045, 1 / 60, position);
          assert.ok(
            position.distanceTo(start) < 0.1,
            "returns to the surrounding corridor",
          );
        } else
          assert.ok(
            progress < 0.7,
            "sealed window stops the capsule even during boosted jumps",
          );
        assert.ok(
          position.y > 1.6 && position.y < 1.8,
          "player returns to the gallery floor",
        );
      }
      if (variant === "overlook") {
        // Probe the physics floor directly: no invisible maze-level slab spans the void.
        motor.teleport({
          x: ox + court.x + court.width / 2,
          z: oz + court.z + court.length / 2,
        });
        for (let i = 0; i < 240; i++) motor.move(0, 0, 1 / 60, position);
        assert.ok(Math.abs(position.y - court.floorY - 1.66) < 0.08);
      }
    } finally {
      motor.dispose();
      section.dispose();
      mats.dispose();
    }
  });
}
