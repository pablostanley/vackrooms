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
import { planRoomLighting, roomAmbient } from "../src/lib/game/room-lighting";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("dark pockets are seeded, connected, rare, and leave landmarks and the opening bright", () => {
  const modes = new Set<string>();
  let darkCells = 0;
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
    const queue = [[...plan.cells][0]];
    const seen = new Set(queue);
    for (const at of queue) {
      const x = at % CHUNK,
        z = Math.floor(at / CHUNK);
      assert.ok(x > 0 && x < CHUNK - 1 && z > 0 && z < CHUNK - 1);
      assert.ok(!inLandmark(data.landmark, x, z));
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
  assert.deepEqual(modes, new Set(["fluorescent", "lamp", "dark"]));
  assert.ok(darkCells / (150 * CHUNK * CHUNK) > 0.01);
  assert.ok(
    darkCells / (150 * CHUNK * CHUNK) < 0.05,
    "at least 95% of the world retains normal lighting",
  );
});

test("ambient spill fades from open doorways and cannot cross a closed wall", () => {
  const data = generateChunk(0, 0, 8);
  const at = 5 * CHUNK + 5;
  const plan = {
    cells: new Set([at]),
    mode: "dark" as const,
    fixtures: new Set<number>(),
    lampCell: null,
  };
  data.cells[at] = 1; // Only north is open to a lit neighbor.
  const sample = (x: number, z: number) =>
    roomAmbient(data, plan, 5 * CELL + x, 5 * CELL + z);
  assert.ok(sample(CELL / 2, 0.05) > 0.9);
  assert.ok(sample(CELL / 2, 1.5) < 0.1);
  assert.ok(sample(CELL / 2, 3.5) < 0.01);
  assert.ok(sample(0.05, CELL / 2) < 0.02, "west wall admits no bounce");
  assert.equal(roomAmbient(data, plan, 3 * CELL, 3 * CELL), 1);
});

test("outages remove actual fixtures, lamps illuminate from the shade, and section lighting releases its resources", () => {
  const mats = headlessMaterials();
  const modes = new Set<string>();
  try {
    for (const seed of [1, 3, 8]) {
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
      assert.ok(textureDisposed);
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
