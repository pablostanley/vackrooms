import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CHUNK, E, N, S, W, directions, generateChunk } from "../src/lib/game/maze";
import { interiorSeed } from "../src/lib/game/generation";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("explicit and default v1 preserve pre-versioning chunk goldens", () => {
  const fixtures: [number, number, number, number, string][] = [
    [0, 0, 199307, 0, "07213284c639ee52174a17ce49b17b6b977d050b10240343e58d9bc4ff03248b"],
    [-1, 1, 199307, 0, "eee9472f4c43c092f5939a9af7fdc83e5d5d5beefaefa755913201b102baf4e1"],
    [3, 1, 48, 0, "bb8e3aa2060d163374a88ad1bb49a7ccdcb4ed26b0ad4a54cd643624115de200"],
    [-4, 2, 882731, 22, "a37b490c5a76157c6fa7f4ba9d30ecad1090ac5e808cdc534265b9bfed66c175"],
    [2, -3, 0, 4, "714c68b425e9bcd6cf9d5ed4430750dce53bae2ca9c87c4481b6a249c2722044"],
  ];
  for (const [x, z, seed, depth, golden] of fixtures) {
    const legacy = generateChunk(x, z, seed, depth);
    assert.deepEqual(generateChunk(x, z, seed, depth, 1), legacy);
    assert.equal(createHash("sha256").update(JSON.stringify(legacy)).digest("hex"), golden);
  }
});

test("v2 removes the sampled opposite-coordinate symmetry and remains deterministic", () => {
  for (const seed of [0, 1, 48, 199307])
    for (let x = 1; x <= 24; x++)
      for (let z = -24; z <= 24; z++) {
        if (z === 0) continue;
        assert.notEqual(interiorSeed(x, z, seed), interiorSeed(-x, -z, seed));
      }
  for (const [x, z] of [[0, 0], [3, 1], [-3, -1], [-4, 2]]) {
    const first = generateChunk(x, z, 48, 0, 2);
    assert.deepEqual(generateChunk(x, z, 48, 0, 2), first);
    assert.deepEqual(generateChunk(x, z, 48, 22, 2), generateChunk(x, z, 48, 22, 2));
    assert.notDeepEqual(generateChunk(x, z, 48, 22, 2).cells, first.cells);
    const shape = { ...first.landmark };
    delete shape.pool;
    assert.deepEqual(shape, generateChunk(x, z, 48, 0, 1).landmark);
  }
});

test("both generations retain shared boundary gates and connected interiors across depth", () => {
  for (const seed of [0, 1, 48, 199307])
    for (const x of [-6, -3, -1, 0, 1, 3, 6])
      for (const z of [-3, -1, 0, 2])
        for (const generation of [1, 2] as const)
          for (const depth of [0, 22]) {
            const data = generateChunk(x, z, seed, depth, generation);
            const legacy = generateChunk(x, z, seed, depth, 1);
            const shape = { ...data.landmark };
            delete shape.pool;
            assert.deepEqual(shape, legacy.landmark);
            for (const neighborGeneration of [1, 2] as const) {
              const east = generateChunk(x + 1, z, seed, 22, neighborGeneration);
              const south = generateChunk(x, z + 1, seed, 33, neighborGeneration);
              for (let i = 0; i < CHUNK; i++) {
                assert.equal(!!(data.cells[i * CHUNK + CHUNK - 1] & E), !!(east.cells[i * CHUNK] & W));
                assert.equal(!!(data.cells[(CHUNK - 1) * CHUNK + i] & S), !!(south.cells[i] & N));
                for (const [index, bit] of [[i, N], [(CHUNK - 1) * CHUNK + i, S], [i * CHUNK, W], [i * CHUNK + CHUNK - 1, E]])
                  assert.equal(data.cells[index] & bit, legacy.cells[index] & bit);
              }
            }
            const queue = [0], visited = new Set(queue);
            for (let i = 0; i < queue.length; i++) {
              const cell = queue[i];
              for (const direction of directions) {
                const cx = cell % CHUNK + direction.dx, cz = Math.floor(cell / CHUNK) + direction.dz;
                if (cx < 0 || cz < 0 || cx >= CHUNK || cz >= CHUNK || !(data.cells[cell] & direction.bit)) continue;
                const next = cz * CHUNK + cx;
                assert.ok(data.cells[next] & direction.opposite);
                if (!visited.has(next)) { visited.add(next); queue.push(next); }
              }
            }
            assert.equal(visited.size, CHUNK * CHUNK);
          }
});

test("the known repeated corridor now has distinct deterministic furniture", () => {
  const mats = headlessMaterials();
  const sections: ReturnType<typeof buildSection>[] = [];
  try {
    const furniture = (x: number, z: number, version: 1 | 2) => {
      const section = buildSection(generateChunk(x, z, 48, 0, version), mats, 0);
      sections.push(section);
      return section.group.userData.furniture;
    };
    assert.deepEqual(furniture(3, 1, 1), furniture(-3, -1, 1), "legacy reproduction remains intact");
    const first = furniture(3, 1, 2);
    assert.notDeepEqual(first, furniture(-3, -1, 2));
    assert.deepEqual(first, furniture(3, 1, 2));
  } finally {
    sections.forEach((section) => section.dispose());
    mats.dispose();
  }
});
