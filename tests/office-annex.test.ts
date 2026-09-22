import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CELL, CHUNK, HEIGHT, SPAN, N, E, S, W, directions, generateChunk, inLandmark } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { headlessMaterials } from "./helpers/materials";

test("office annexes are stable, connected variations that preserve every shared gate", () => {
  let annexes = 0, lobbies = 0;
  for (const seed of [12, 42, 199307, 882731])
    for (let z = -3; z <= 3; z++)
      for (let x = -4; x <= 4; x++) {
        const data = generateChunk(x, z, seed);
        if (data.landmark.kind === "lobby") lobbies++;
        if (!data.landmark.office) continue;
        annexes++;
        assert.equal(data.landmark.height, HEIGHT);
        assert.deepEqual(data.landmark, generateChunk(x, z, seed, 19).landmark);
        const east = generateChunk(x + 1, z, seed, 17);
        const south = generateChunk(x, z + 1, seed, 5);
        for (let c = 0; c < CHUNK; c++) {
          assert.equal(Boolean(data.cells[c * CHUNK + CHUNK - 1] & E), Boolean(east.cells[c * CHUNK] & W));
          assert.equal(Boolean(data.cells[(CHUNK - 1) * CHUNK + c] & S), Boolean(south.cells[c] & N));
        }
        const queue = [0], seen = new Set(queue);
        for (const at of queue)
          for (const { bit, dx, dz } of directions) {
            const nx = at % CHUNK + dx, nz = Math.floor(at / CHUNK) + dz;
            const next = nz * CHUNK + nx;
            if (nx < 0 || nz < 0 || nx >= CHUNK || nz >= CHUNK || !(data.cells[at] & bit) || seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
          }
        assert.equal(seen.size, CHUNK * CHUNK);
      }
  assert.ok(annexes > 8 && annexes < lobbies / 2, "variety without replacing most large lobbies");
});

test("annex windows and fixtures remain batched and every doorway admits Rapier in both directions", async () => {
  const data = generateChunk(0, 0, 12), room = data.landmark;
  assert.equal(room.office, "annex");
  const mats = headlessMaterials(), section = buildSection(data, mats, 0);
  const position = new THREE.Vector3(0, 1.66, 0);
  const motor = await CharacterMotor.create(position);
  let crossed = 0;
  try {
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    const details = section.group.userData.officeAnnex;
    assert.ok(details.windows >= 4, "repeated sealed windows define the office");
    assert.equal(details.fixtures, 2, "water station and vending cabinet are discoverable");
    assert.ok(section.group.children.length < 40, "no mesh per blind slat or bottle");
    for (let z = room.z; z < room.z + room.length; z++)
      for (let x = room.x; x < room.x + room.width; x++)
        for (const { bit, dx, dz } of directions) {
          if (inLandmark(room, x + dx, z + dz) || !(data.cells[z * CHUNK + x] & bit)) continue;
          const doorX = data.x * SPAN + (x + 0.5 + dx * 0.5) * CELL;
          const doorZ = data.z * SPAN + (z + 0.5 + dz * 0.5) * CELL;
          for (const side of [-1, 1]) {
            position.set(doorX + dx * side, 1.66, doorZ + dz * side);
            motor.teleport(position);
            for (let frame = 0; frame < 50; frame++)
              motor.move(-dx * side * 0.04, -dz * side * 0.04, 1 / 60, position);
            assert.ok(((position.x - doorX) * dx + (position.z - doorZ) * dz) * side < -0.7);
            assert.ok(Math.abs(position.y - 1.66) < 0.1);
          }
          crossed++;
        }
    assert.ok(crossed >= 4, "the four approaches remain open");
  } finally {
    motor.dispose(); section.dispose(); mats.dispose();
  }
});
