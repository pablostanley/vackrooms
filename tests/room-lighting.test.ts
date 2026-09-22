import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CELL,
  CHUNK,
  directions,
  generateChunk,
  inLandmark,
} from "../src/lib/game/maze";
import {
  planRoomLighting,
  createRoomAmbientSampler,
} from "../src/lib/game/room-lighting";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("dark pockets include hallway runs and stay seeded, connected, and uncommon", () => {
  const modes = new Set<string>();
  let darkCells = 0;
  let hallways = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const data = generateChunk((seed % 3) - 1, (seed % 5) - 2, seed, seed % 4);
    const original = data.cells.slice();
    const plan = planRoomLighting(data);
    assert.deepEqual(plan, planRoomLighting(data));
    assert.deepEqual(data.cells, original, "lighting never changes maze gates");
    assert.ok(
      plan.cells.size === 0 || (plan.cells.size >= 4 && plan.cells.size <= 8),
    );
    if (!plan.cells.size) continue;
    darkCells += plan.cells.size;
    modes.add(plan.mode);
    const hallway = [...plan.cells].some((at) =>
      inLandmark(data.landmark, at % CHUNK, Math.floor(at / CHUNK)),
    );
    if (hallway) {
      hallways++;
      assert.equal(data.landmark.kind, "corridor");
      const cells = [...plan.cells].sort((a, b) => a - b);
      assert.ok(cells.length >= 4 && cells.length <= 6);
      assert.ok(
        cells.every((at) => Math.floor(at / CHUNK) === data.landmark.z),
      );
      assert.equal(
        cells.at(-1)! - cells[0],
        cells.length - 1,
        "a continuous hallway stretch",
      );
    }
    const queue = [[...plan.cells][0]];
    const seen = new Set(queue);
    for (const at of queue) {
      const x = at % CHUNK,
        z = Math.floor(at / CHUNK);
      assert.ok(x > 0 && x < CHUNK - 1 && z > 0 && z < CHUNK - 1);
      assert.ok(hallway || !inLandmark(data.landmark, x, z));
      assert.ok(!(data.x === 0 && data.z === 0 && x <= 3 && z <= 4));
      for (const { bit, dx, dz } of directions) {
        const next = at + dx + dz * CHUNK;
        if (data.cells[at] & bit && plan.cells.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    assert.equal(seen.size, plan.cells.size);
    assert.ok([...plan.fixtures].every((at) => plan.cells.has(at)));
    if (plan.mode === "fluorescent")
      assert.ok(plan.fixtures.size >= 1 && plan.fixtures.size <= 2);
    else assert.equal(plan.fixtures.size, 0);
    if (plan.mode === "lamp") assert.ok(plan.cells.has(plan.lampCell!));
    else assert.equal(plan.lampCell, null);
  }
  assert.ok(
    hallways >= 3 && hallways <= 20,
    "hallway outages recur without dominating",
  );
  assert.deepEqual(modes, new Set(["fluorescent", "lamp", "dark"]));
  assert.ok(
    darkCells / (150 * CHUNK * CHUNK) > 0.03,
    "a small increase over the previous 2.6% sample",
  );
  assert.ok(
    darkCells / (150 * CHUNK * CHUNK) < 0.05,
    "at least 95% of the world retains normal lighting",
  );
});

test("ambient spill fades gradually through connected cells and around bends without seams", () => {
  const data = generateChunk(0, 0, 8);
  data.cells.fill(0);
  const cells = [5 * CHUNK + 5, 5 * CHUNK + 6, 5 * CHUNK + 7, 6 * CHUNK + 7];
  const connect = (a: number, b: number, bit: number, opposite: number) => {
    data.cells[a] |= bit;
    data.cells[b] |= opposite;
  };
  connect(cells[0] - 1, cells[0], 2, 8);
  connect(cells[0], cells[1], 2, 8);
  connect(cells[1], cells[2], 2, 8);
  connect(cells[2], cells[3], 4, 1);
  const plan = {
    cells: new Set(cells),
    mode: "dark" as const,
    fixtures: new Set<number>(),
    lampCell: null,
  };
  const sample = createRoomAmbientSampler(data, plan);
  const entrance = (distance: number) =>
    sample(5 * CELL + distance, 5.5 * CELL);
  assert.ok(entrance(0.05) > 0.99);
  assert.ok(
    entrance(1.5) > 0.8,
    "doorway light does not immediately collapse to black",
  );
  assert.ok(entrance(3.5) > 0.5 && entrance(3.5) < 0.85);
  assert.ok(
    entrance(7) > 0.15 && entrance(7) < entrance(3.5),
    "spill reaches the next room",
  );
  assert.ok(
    sample(7.5 * CELL, 6.1 * CELL) > 0.03,
    "bounce turns into the last connected room",
  );
  assert.ok(sample(7.5 * CELL, 6.9 * CELL) < 0.06, "deep recesses stay dark");
  for (const edge of [0, CELL, CELL * 2])
    assert.ok(
      Math.abs(entrance(edge - 0.001) - entrance(edge + 0.001)) < 0.001,
      "no step at open cell boundaries",
    );
  assert.equal(sample(3 * CELL, 3 * CELL), 1);

  data.cells.fill(0);
  const sealed = createRoomAmbientSampler(data, plan);
  assert.ok(
    sealed(5 * CELL + 0.09, 5.5 * CELL) < 0.026,
    "bright neighboring rooms cannot fill through closed walls",
  );
});

test("working lamps and fluorescents provide dim indirect fill inside an enclosed room", () => {
  const data = generateChunk(0, 0, 8);
  data.cells.fill(0);
  const at = 5 * CHUNK + 5;
  const plan = {
    cells: new Set([at]),
    mode: "dark" as const,
    fixtures: new Set<number>(),
    lampCell: null as number | null,
  };
  const x = 5.5 * CELL,
    z = 5.5 * CELL;
  const dark = createRoomAmbientSampler(data, plan)(x, z);
  plan.lampCell = at;
  const lamp = createRoomAmbientSampler(data, plan)(x, z);
  plan.lampCell = null;
  plan.fixtures.add(at);
  const fluorescent = createRoomAmbientSampler(data, plan)(x, z);
  assert.ok(dark > 0.02 && dark < 0.03);
  assert.ok(lamp > dark * 3 && lamp < 0.2);
  assert.ok(fluorescent > lamp && fluorescent < 0.4);
});

test("outages remove actual fixtures, lamps illuminate from the shade, and section lighting releases its resources", () => {
  const mats = headlessMaterials();
  const modes = new Set<string>();
  try {
    for (const seed of [1, 3, 20]) {
      const data = generateChunk(0, 0, seed);
      const section = buildSection(data, mats, 0);
      const plan = planRoomLighting(data);
      modes.add(plan.mode);
      const darkFixtures = section.lights.filter((p) =>
        plan.cells.has(Math.floor(p.z / CELL) * CHUNK + Math.floor(p.x / CELL)),
      );
      assert.equal(darkFixtures.length, plan.fixtures.size);
      assert.equal(section.lampLights.length, plan.mode === "lamp" ? 1 : 0);
      assert.ok(section.lampLights.every((p) => p.y > 1.3 && p.y < 1.5));
      const owned = new Set<THREE.Material>();
      const disposed = new Set<THREE.Material>();
      let texture: THREE.Texture | null = null;
      let textureDisposed = false;
      section.group.traverse((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          !(object.material instanceof THREE.MeshStandardMaterial)
        )
          return;
        const material = object.material;
        if (!material.aoMap) return;
        assert.equal(material.emissiveMap, material.aoMap);
        assert.equal(material.aoMap.channel, 1);
        assert.equal(
          object.geometry.getAttribute("uv1").count,
          object.geometry.getAttribute("position").count,
        );
        owned.add(material);
        material.addEventListener("dispose", () => disposed.add(material));
        texture = material.aoMap;
      });
      assert.ok(owned.size > 8);
      assert.ok(texture);
      (texture as THREE.Texture).addEventListener("dispose", () => {
        textureDisposed = true;
      });
      section.dispose();
      assert.deepEqual(disposed, owned);
      assert.equal(textureDisposed, false, "retired map remains owned by its pool");
      assert.equal(
        mats.wall.aoMap,
        null,
        "shared bright-room materials stay untouched",
      );
    }
    assert.equal(modes.size, 3);
  } finally {
    mats.dispose();
  }
});
