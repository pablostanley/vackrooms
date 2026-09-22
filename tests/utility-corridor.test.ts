import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CELL, CHUNK, SPAN, N, S, E, W, generateChunk, hash, landmarkKind } from "../src/lib/game/maze";
import { buildUtilityCorridor, utilityBays, UTILITY_PIPE_Y, UTILITY_PIPE_RADIUS } from "../src/lib/game/utility-corridor";
import { EntityNavigation } from "../src/lib/game/entity-navigation";
import { CharacterMotor } from "../src/lib/game/physics";
import type { LandmarkBuilder } from "../src/lib/game/landmarks";
import { headlessMaterials } from "./helpers/materials";

function pipes(data: ReturnType<typeof generateChunk>, mats: ReturnType<typeof headlessMaterials>) {
  const group = new THREE.Group(), colliders: THREE.Box3[] = [];
  const builder: LandmarkBuilder & { shapedColliders: [] } = { group, colliders, shapedColliders: [], box: () => {}, plane: () => {}, lights: [], water: [] };
  buildUtilityCorridor(data, mats, builder);
  return { group, colliders, dispose() { group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); } };
}

test("utility runs are rare, disjoint from hotels, and preserve shared gates across negative coordinates", () => {
  let utilities = 0, ordinary = 0;
  for (const seed of [0, 3, 42, 199307])
    for (let z = -5; z <= 5; z++)
      for (let run = -5; run <= 5; run++) {
        if (landmarkKind(run * 3, z, seed) !== "corridor") continue;
        const roll = hash(run, z, seed + 8117);
        const chunks = [0, 1, 2].map((i) => generateChunk(run * 3 + i, z, seed, i * 11));
        for (const [i, data] of chunks.entries()) {
          assert.equal(data.landmark.corridor === "hotel", roll % 4 === 0);
          assert.equal(data.landmark.corridor === "utility", roll % 8 === 1);
          assert.deepEqual(data.landmark, generateChunk(data.x, z, seed).landmark);
          assert.equal(data.landmark.height, 3.15);
          if (i < 2) {
            assert.ok(data.cells[6 * CHUNK + CHUNK - 1] & E);
            assert.ok(chunks[i + 1].cells[6 * CHUNK] & W);
          }
          const south = generateChunk(data.x, z + 1, seed, 22);
          for (let x = 0; x < CHUNK; x++) assert.equal(!!(data.cells[(CHUNK - 1) * CHUNK + x] & S), !!(south.cells[x] & N));
        }
        if (chunks[0].landmark.corridor === "utility") utilities++; else ordinary++;
      }
  assert.ok(utilities > 0 && ordinary > utilities * 4);
});

test("pipe assemblies stay bounded and mains join exactly across both section seams", () => {
  const mats = headlessMaterials();
  const sections = [-3, -2, -1].map((x) => pipes(generateChunk(x, -5, 199307), mats));
  try {
    for (const [i, section] of sections.entries()) {
      const report = section.group.userData.utilityCorridor;
      assert.ok(report.triangles <= 2500 && report.batches <= 4 && report.risers <= 2);
      const mains = section.colliders.filter((box) => box.max.x - box.min.x > SPAN - 1);
      assert.equal(mains.length, 2);
      for (const main of mains) {
        assert.ok(main.min.y > 2.75, "mains stay above creature navigation clearance");
        assert.ok(Math.abs(main.min.x - (-3 + i) * SPAN) < 0.00002);
        assert.ok(Math.abs(main.max.x - (-2 + i) * SPAN) < 0.00002);
      }
      if (i) {
        const previous = sections[i - 1].colliders.filter((box) => box.max.x - box.min.x > SPAN - 1);
        mains.forEach((main, n) => {
          assert.equal(previous[n].max.x, main.min.x);
          assert.equal(previous[n].min.y, main.min.y);
          assert.equal(previous[n].min.z, main.min.z);
        });
      }
    }
  } finally { sections.forEach((s) => s.dispose()); mats.dispose(); }
});

test("actual players and creatures traverse seams and every side opening; jumps bump pipes without trapping", async () => {
  const mats = headlessMaterials();
  const chunks = [-3, -2, -1].map((x) => generateChunk(x, -5, 199307));
  const sections = chunks.map((data) => pipes(data, mats));
  const nav = new EntityNavigation(), position = new THREE.Vector3();
  const centerZ = -5 * SPAN + 6.5 * CELL;
  const motor = await CharacterMotor.create({ x: -3 * SPAN + 1, z: centerZ });
  try {
    chunks.forEach((data, i) => {
      nav.addSection(`${data.x},-5`, data, sections[i].colliders);
      motor.addSection(`${data.x},-5`, data, sections[i].colliders);
      for (const bay of utilityBays(data)) assert.equal(data.cells[6 * CHUNK + bay.x] & (bay.side < 0 ? N : S), 0);
    });
    for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
    for (let i = 0; i < 3600; i++) motor.move(0.045, 0, 1 / 60, position);
    assert.ok(position.x > -SPAN + CELL, "player crosses both seams");
    assert.ok(nav.clearSegment({ x: -3 * SPAN + 1, z: centerZ }, { x: -1, z: centerZ }));
    let openings = 0;
    for (const data of chunks)
      for (let x = 0; x < CHUNK; x++)
        for (const [bit, direction] of [[N, -1], [S, 1]]) {
          if (!(data.cells[6 * CHUNK + x] & bit)) continue;
          openings++;
          const px = data.x * SPAN + (x + 0.5) * CELL;
          const wallZ = data.z * SPAN + (direction < 0 ? 6 : 7) * CELL;
          const a = { x: px, z: wallZ - direction * 1.2 }, b = { x: px, z: wallZ + direction * 0.7 };
          assert.ok(nav.canOccupy(a) && nav.canOccupy(b) && nav.clearSegment(a, b), `creature exit ${data.x}/${x}/${bit}`);
          motor.teleport(a);
          for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
          for (let i = 0; i < 55; i++) motor.move(0, direction * 0.04, 1 / 60, position);
          assert.ok((position.z - wallZ) * direction > 0.65);
          for (let i = 0; i < 55; i++) motor.move(0, -direction * 0.04, 1 / 60, position);
          assert.ok((position.z - wallZ) * direction < -1);
        }
    assert.ok(openings > 0);
    // Start below the flange of a main, clear of closed-wall risers.
    motor.teleport({ x: -3 * SPAN + CELL * 0.5, z: -5 * SPAN + 6 * CELL + 0.68 });
    for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
    let maxEye = position.y;
    for (let i = 0; i < 150; i++) {
      if (i === 0 || i === 18) motor.jump();
      motor.move(0, 0, 1 / 60, position); maxEye = Math.max(maxEye, position.y);
    }
    assert.ok(maxEye > 2 && maxEye < UTILITY_PIPE_Y - UTILITY_PIPE_RADIUS, "head bumps the pipe before passing through it");
    assert.ok(motor.grounded && position.y < 1.8);
    for (let i = 0; i < 35; i++) motor.move(0, 0.04, 1 / 60, position);
    assert.ok(position.z > -5 * SPAN + 6 * CELL + 1.9, "can walk away after bumping the pipe");
  } finally { motor.dispose(); nav.clear(); sections.forEach((s) => s.dispose()); mats.dispose(); }
});
