import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { CELL, CHUNK, SPAN, N, E, S, W, directions, generateChunk, canStand } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { headlessMaterials } from "./helpers/materials";

test("warehouses stay a rare seeded food-court variation through regeneration", () => {
  let warehouses = 0, courts = 0;
  for (const seed of [1, 48, 60, 199307])
    for (let z = -5; z <= 5; z++)
      for (let x = -5; x <= 5; x++) {
        const data = generateChunk(x, z, seed);
        if (data.landmark.kind === "foodCourt") courts++;
        if (!data.landmark.warehouse) continue;
        warehouses++;
        assert.equal(data.landmark.kind, "foodCourt");
        const next = generateChunk(x, z, seed, 9);
        const east = generateChunk(x + 1, z, seed, 7), south = generateChunk(x, z + 1, seed, 11);
        assert.deepEqual(next.landmark, data.landmark);
        for (let c = 0; c < CHUNK; c++) {
          assert.equal(Boolean(data.cells[c * CHUNK + CHUNK - 1] & E), Boolean(east.cells[c * CHUNK] & W));
          assert.equal(Boolean(data.cells[(CHUNK - 1) * CHUNK + c] & S), Boolean(south.cells[c] & N));
          assert.equal(data.cells[c] & N, next.cells[c] & N);
          assert.equal(data.cells[(CHUNK - 1) * CHUNK + c] & S, next.cells[(CHUNK - 1) * CHUNK + c] & S);
          assert.equal(data.cells[c * CHUNK] & W, next.cells[c * CHUNK] & W);
          assert.equal(data.cells[c * CHUNK + CHUNK - 1] & E, next.cells[c * CHUNK + CHUNK - 1] & E);
        }
      }
  assert.ok(warehouses > courts * 0.15 && warehouses < courts * 0.35);
});

test("warehouse columns and supplies leave all four section gates connected, including negative sections", () => {
  const mats = headlessMaterials();
  const sites: [number, number, number][] = [[0, 0, 48], [0, 0, 60]];
  for (let x = -12; x < 0 && sites.length < 4; x++)
    for (let z = -12; z < 0 && sites.length < 4; z++)
      if (generateChunk(x, z, 48).landmark.warehouse) sites.push([x, z, 48]);
  assert.equal(sites.length, 4);
  try {
    for (const [sx, sz, seed] of sites) {
      const data = generateChunk(sx, sz, seed), section = buildSection(data, mats, 0);
      try {
        assert.ok(data.landmark.warehouse);
        const step = CELL / 8, size = CHUNK * 8, chunks = new Map([[`${sx},${sz}`, data]]);
        const free = new Uint8Array(size * size);
        for (let iz = 0; iz < size; iz++)
          for (let ix = 0; ix < size; ix++) {
            const x = sx * SPAN + (ix + 0.5) * step, z = sz * SPAN + (iz + 0.5) * step;
            const obstacle = section.colliders.some((b) => b.max.y > 0.1 && b.min.y < 1.8 && x > b.min.x - 0.24 && x < b.max.x + 0.24 && z > b.min.z - 0.24 && z < b.max.z + 0.24);
            free[iz * size + ix] = Number(!obstacle && canStand(chunks, x, z, 0.24));
          }
        const gates: number[] = [];
        for (let c = 0; c < CHUNK; c++) {
          const middle = c * 8 + 4;
          if (data.cells[c] & N) gates.push(middle);
          if (data.cells[(CHUNK - 1) * CHUNK + c] & S) gates.push((size - 1) * size + middle);
          if (data.cells[c * CHUNK] & W) gates.push(middle * size);
          if (data.cells[c * CHUNK + CHUNK - 1] & E) gates.push(middle * size + size - 1);
        }
        const queue = [gates[0]], seen = new Set(queue);
        for (const at of queue)
          for (const d of directions) {
            const nx = at % size + d.dx, nz = Math.floor(at / size) + d.dz, next = nz * size + nx;
            if (nx < 0 || nz < 0 || nx >= size || nz >= size || !free[next] || seen.has(next)) continue;
            seen.add(next); queue.push(next);
          }
        assert.equal(gates.length, 4);
        for (const gate of gates) assert.ok(free[gate] && seen.has(gate), `warehouse ${sx},${sz}: reachable gate`);
        assert.ok(section.group.children.length < 40, "warehouse shares existing material batches");
        assert.equal(section.group.userData.warehouse.columns, 4);
        assert.ok(section.group.userData.warehouse.supplies <= 4);
        assert.equal(section.water.length, 0);
      } finally { section.dispose(); }
    }
  } finally { mats.dispose(); }
});

test("Rapier crosses the warehouse and stops at its visible structural column", async () => {
  const data = generateChunk(0, 0, 48), room = data.landmark;
  const mats = headlessMaterials(), section = buildSection(data, mats, 0);
  const x = room.x * CELL, z = room.z * CELL;
  const position = new Vector3(x + 1.5 * CELL, 1.66, z + 2.5 * CELL);
  const motor = await CharacterMotor.create(position);
  try {
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    for (let i = 0; i < 250; i++) motor.move(0.06, 0, 1 / 60, position);
    assert.ok(position.x > x + 4.5 * CELL, "wide central lane remains walkable");
    motor.teleport({ x: x + CELL, z: z + 2 * CELL });
    for (let i = 0; i < 130; i++) motor.move(0.05, 0, 1 / 60, position);
    assert.ok(position.x < x + 2 * CELL - 0.65, "column blocks the capsule");
    assert.ok(position.x > x + 1.5 * CELL, "capsule reaches the actual column");
  } finally { motor.dispose(); section.dispose(); mats.dispose(); }
});
