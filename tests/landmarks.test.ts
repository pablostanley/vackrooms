import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import {
  CELL,
  CHUNK,
  SPAN,
  N,
  E,
  S,
  W,
  directions,
  generateChunk,
  inLandmark,
  canStand,
  landmarkKind,
  poolBounds,
} from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { headlessMaterials } from "./helpers/materials";

test("every tape has a reachable first landmark and a bounded recurring variety", () => {
  for (let seed = 0; seed < 128; seed++) {
    const first = generateChunk(0, 0, seed);
    const distances = new Map([[4 * CHUNK + 2, 0]]);
    const queue = [...distances.keys()];
    let nearest = Infinity;
    for (const at of queue) {
      const x = at % CHUNK,
        z = Math.floor(at / CHUNK);
      if (inLandmark(first.landmark, x, z))
        nearest = Math.min(nearest, distances.get(at)!);
      for (const d of directions) {
        const nx = x + d.dx,
          nz = z + d.dz,
          next = nz * CHUNK + nx;
        if (
          nx < 0 ||
          nz < 0 ||
          nx >= CHUNK ||
          nz >= CHUNK ||
          !(first.cells[at] & d.bit) ||
          distances.has(next)
        )
          continue;
        distances.set(next, distances.get(at)! + 1);
        queue.push(next);
      }
    }
    assert.ok(
      nearest > 0 && nearest * CELL <= 30,
      `tape ${seed} reveals a landmark within 30m`,
    );
    for (const z of [-5, 0, 8]) {
      const kinds = new Set();
      for (let x = -6; x < 6; x++) {
        const data = generateChunk(x, z, seed);
        assert.deepEqual(data.landmark, generateChunk(x, z, seed, 33).landmark);
        kinds.add(data.landmark.kind);
      }
      assert.equal(
        kinds.size,
        4,
        "each 12-section walk crosses all four landmark families",
      );
    }
  }
});

test("long corridors continue straight across three sections and regenerated gates", () => {
  for (const seed of [0, 3, 199307, 882731]) {
    for (const z of [-3, 0, 2]) {
      for (let block = -4; block <= 4; block++) {
        const start = block * 3;
        if (landmarkKind(start, z, seed) !== "corridor") continue;
        const chunks = [0, 1, 2].map((i) =>
          generateChunk(start + i, z, seed, i * 11),
        );
        assert.ok(SPAN * chunks.length >= 170);
        for (const [i, data] of chunks.entries()) {
          const row = data.landmark.z;
          for (let x = 0; x < CHUNK - 1; x++) {
            assert.ok(data.cells[row * CHUNK + x] & E);
            assert.ok(data.cells[row * CHUNK + x + 1] & W);
          }
          if (i < 2) {
            assert.ok(data.cells[row * CHUNK + CHUNK - 1] & E);
            assert.ok(chunks[i + 1].cells[row * CHUNK] & W);
          }
        }
      }
    }
  }
});

test("all boundary gates stay connected around real landmark and furniture obstacles", () => {
  const mats = headlessMaterials();
  try {
    for (const seed of [1, 2, 3, 8]) {
      const data = generateChunk(0, 0, seed),
        section = buildSection(data, mats, 0);
      try {
        const step = CELL / 8,
          size = CHUNK * 8;
        const basin = poolBounds(data.landmark);
        const chunks = new Map([["0,0", data]]);
        const free = new Uint8Array(size * size);
        for (let iz = 0; iz < size; iz++)
          for (let ix = 0; ix < size; ix++) {
            const x = (ix + 0.5) * step,
              z = (iz + 0.5) * step;
            const pool =
              basin &&
              x > basin.x &&
              x < basin.x + basin.width &&
              z > basin.z &&
              z < basin.z + basin.length;
            const obstacle = section.colliders.some(
              (b) =>
                b.max.y > 0.1 &&
                b.min.y < 1.8 &&
                x > b.min.x - 0.24 &&
                x < b.max.x + 0.24 &&
                z > b.min.z - 0.24 &&
                z < b.max.z + 0.24,
            );
            free[iz * size + ix] = Number(
              !pool && !obstacle && canStand(chunks, x, z, 0.24),
            );
          }
        const gates: number[] = [];
        for (let c = 0; c < CHUNK; c++) {
          const middle = c * 8 + 4;
          if (data.cells[c] & N) gates.push(middle);
          if (data.cells[(CHUNK - 1) * CHUNK + c] & S)
            gates.push((size - 1) * size + middle);
          if (data.cells[c * CHUNK] & W) gates.push(middle * size);
          if (data.cells[c * CHUNK + CHUNK - 1] & E)
            gates.push(middle * size + size - 1);
        }
        const queue = [gates[0]],
          seen = new Set(queue);
        for (const at of queue) {
          const x = at % size,
            z = Math.floor(at / size);
          for (const d of directions) {
            const nx = x + d.dx,
              nz = z + d.dz,
              next = nz * size + nx;
            if (
              nx < 0 ||
              nz < 0 ||
              nx >= size ||
              nz >= size ||
              !free[next] ||
              seen.has(next)
            )
              continue;
            seen.add(next);
            queue.push(next);
          }
        }
        assert.equal(gates.length, 4);
        for (const gate of gates)
          assert.ok(
            free[gate] && seen.has(gate),
            `${data.landmark.kind}: every gate is physically reachable`,
          );
        assert.ok(
          section.group.children.length < 40,
          "geometry remains batched",
        );
      } finally {
        section.dispose();
      }
    }
  } finally {
    mats.dispose();
  }
});

test("full-sized pools have continuous dry decks and coping that stops the capsule", async () => {
  const data = generateChunk(0, 0, 2),
    basin = poolBounds(data.landmark)!;
  assert.equal(basin.length, 25);
  assert.equal(basin.width, 16);
  const mats = headlessMaterials(),
    section = buildSection(data, mats, 0);
  const position = new Vector3(basin.x - 1.1, 1.66, basin.z + basin.length / 2);
  const motor = await CharacterMotor.create(position);
  try {
    motor.addSection("0,0", data, section.colliders);
    for (let i = 0; i < 120; i++) motor.move(0.04, 0, 1 / 60, position);
    assert.ok(
      position.x < basin.x - 0.35,
      "visible coping blocks accidental entry",
    );
    assert.ok(
      position.y > 1.6 && position.y < 1.8,
      "player stays on the dry deck",
    );
    assert.equal(section.water.length, 1);
    assert.equal(section.water[0].position.y, -0.18);
    const waypoints = [
      [basin.x - 1.1, basin.z - 1.1],
      [basin.x + basin.width + 1.1, basin.z - 1.1],
      [basin.x + basin.width + 1.1, basin.z + basin.length + 1.1],
      [basin.x - 1.1, basin.z + basin.length + 1.1],
    ];
    motor.teleport({ x: waypoints[0][0], z: waypoints[0][1] });
    motor.move(0, 0, 1 / 60, position);
    for (const [x, z] of [...waypoints.slice(1), waypoints[0]]) {
      for (
        let i = 0;
        i < 900 && Math.hypot(x - position.x, z - position.z) > 0.08;
        i++
      ) {
        const dx = x - position.x,
          dz = z - position.z,
          distance = Math.hypot(dx, dz);
        motor.move(
          (dx / distance) * 0.07,
          (dz / distance) * 0.07,
          1 / 60,
          position,
        );
      }
      assert.ok(
        Math.hypot(x - position.x, z - position.z) < 0.1,
        "Rapier can walk around the complete pool",
      );
    }
  } finally {
    motor.dispose();
    section.dispose();
    mats.dispose();
  }
});
