import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CELL, CHUNK, SPAN, N, S, E, W, generateChunk, landmarkKind } from "../src/lib/game/maze";
import { buildHotelCorridor, hotelBays } from "../src/lib/game/hotel-corridor";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import type { LandmarkBuilder } from "../src/lib/game/landmarks";
import { headlessMaterials } from "./helpers/materials";

test("hotel selection agrees across complete positive and negative corridor runs and regeneration", () => {
  let hotel = 0, ordinary = 0;
  for (const seed of [0, 3, 42, 199307, 882731])
    for (let z = -4; z <= 4; z++)
      for (let group = -5; group <= 5; group++) {
        if (landmarkKind(group * 3, z, seed) !== "corridor") continue;
        const chunks = [0, 1, 2].map((i) => generateChunk(group * 3 + i, z, seed, i * 11));
        const selection = chunks[0].landmark.corridor;
        if (selection === "hotel") hotel++; else ordinary++;
        for (const [i, data] of chunks.entries()) {
          assert.equal(data.landmark.corridor, selection);
          assert.deepEqual(data.landmark, generateChunk(data.x, z, seed).landmark);
          assert.equal(data.landmark.height, 3.15);
          for (let x = 0; x < CHUNK - 1; x++) assert.ok(data.cells[6 * CHUNK + x] & E);
          if (i < 2) {
            assert.ok(data.cells[6 * CHUNK + CHUNK - 1] & E);
            assert.ok(chunks[i + 1].cells[6 * CHUNK] & W);
          }
          const south = generateChunk(data.x, z + 1, seed);
          for (let x = 0; x < CHUNK; x++) assert.equal(!!(data.cells[(CHUNK - 1) * CHUNK + x] & S), !!(south.cells[x] & N));
        }
      }
  assert.ok(hotel > 0 && ordinary > hotel * 2, "hotel runs remain a minority");
});

test("hotel joinery stays inside closed bays and a worst-case section remains within budget", () => {
  const data = generateChunk(-5, 4, 199307), mats = headlessMaterials();
  // More closed bays than a real corridor: upper bound including a cupboard.
  data.cells = new Uint8Array(data.cells);
  for (let x = 0; x < CHUNK; x++) data.cells[6 * CHUNK + x] &= ~(N | S);
  const group = new THREE.Group(), colliders: THREE.Box3[] = [];
  const materials = new Set<THREE.Material>();
  let triangles = 0;
  try {
    const builder: LandmarkBuilder & { shapedColliders: [] } = {
      group, colliders, shapedColliders: [], lights: [], water: [], plane: () => {},
      box: (_w, _h, _d, _x, _y, _z, material) => { triangles += 12; materials.add(material); },
    };
    buildHotelCorridor(data, mats, builder);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
        materials.add(object.material);
      }
    });
    assert.ok(triangles <= 4500, `${triangles} triangles`);
    assert.ok(materials.size <= 8, `${materials.size} material batches`);
    assert.equal(hotelBays(data).length, 24);
    for (const bounds of colliders) {
      assert.ok(bounds.min.x >= data.x * SPAN && bounds.max.x <= (data.x + 1) * SPAN);
      const localMin = bounds.min.z - data.z * SPAN, localMax = bounds.max.z - data.z * SPAN;
      assert.ok(localMax < 6 * CELL + 0.5 || localMin > 7 * CELL - 0.5, "over four meters remain clear down the hall");
    }
  } finally {
    group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    mats.dispose();
  }
});

test("Rapier traverses both hotel seams and every side exit without blocked thresholds", async () => {
  const mats = headlessMaterials();
  const chunks = [-6, -5, -4].map((x) => generateChunk(x, 4, 199307));
  const sections = chunks.map((data) => buildSection(data, mats, 0));
  const position = new THREE.Vector3();
  const motor = await CharacterMotor.create({ x: -6 * SPAN + 1, z: 4 * SPAN + 6.5 * CELL });
  try {
    chunks.forEach((data, i) => motor.addSection(`${data.x},4`, data, sections[i].colliders, sections[i].shapedColliders));
    for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
    for (let i = 0; i < 3700; i++) motor.move(0.045, 0, 1 / 60, position);
    assert.ok(position.x > -4 * SPAN + CELL, `crosses both seams along the unbroken centerline: ${position.x}`);
    for (const data of chunks)
      for (let x = 0; x < CHUNK; x++)
        for (const [bit, direction] of [[N, -1], [S, 1]]) {
          if (!(data.cells[6 * CHUNK + x] & bit)) continue;
          const px = data.x * SPAN + (x + 0.5) * CELL;
          const wallZ = data.z * SPAN + (direction < 0 ? 6 : 7) * CELL;
          motor.teleport({ x: px, z: wallZ - direction * 0.65 });
          for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
          for (let i = 0; i < 35; i++) motor.move(0, direction * 0.04, 1 / 60, position);
          assert.ok((position.z - wallZ) * direction > 0.65, `exit ${data.x}/${x}/${bit}`);
          for (let i = 0; i < 45; i++) motor.move(0, -direction * 0.04, 1 / 60, position);
          assert.ok((position.z - wallZ) * direction < -0.6, `can return through exit ${data.x}/${x}/${bit}: ${(position.z - wallZ) * direction}`);
        }
    for (const data of chunks)
      for (const bay of hotelBays(data)) {
        const x = data.x * SPAN + (bay.x + 0.5) * CELL;
        const wallZ = data.z * SPAN + (bay.side < 0 ? 6 : 7) * CELL;
        motor.teleport({ x, z: wallZ - bay.side * 0.8 });
        for (let i = 0; i < 20; i++) motor.move(0, 0, 1 / 60, position);
        for (let i = 0; i < 150; i++) {
          if (i === 0 || i === 18) motor.jump();
          motor.move(0, i < 80 ? bay.side * 0.035 : 0, 1 / 60, position);
        }
        assert.ok((wallZ - position.z) * bay.side > 0.4, "door trim blocks jumping through sealed doors");
        assert.ok(motor.grounded && position.y < 1.8, "jump lands on the floor without catching on a transom");
        for (let i = 0; i < 30; i++) motor.move(0, -bay.side * 0.04, 1 / 60, position);
        assert.ok((wallZ - position.z) * bay.side > 1.5, "can step away after jumping at the door");
      }
  } finally {
    motor.dispose(); sections.forEach((section) => section.dispose()); mats.dispose();
  }
});
