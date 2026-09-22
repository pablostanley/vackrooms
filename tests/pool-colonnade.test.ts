import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Box3, Group, Mesh, Vector3 } from "three";
import { SPAN, generateChunk, poolBounds } from "../src/lib/game/maze";
import { buildLandmark } from "../src/lib/game/landmarks";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { footstepSurfaceAt } from "../src/lib/game/acoustics";
import { headlessMaterials } from "./helpers/materials";

const fixture = () => generateChunk(-2, -2, 199307, 0, 2);

test("colonnades are rare, depth-stable v2 poolrooms and never replace the opening room", () => {
  let pools = 0, colonnades = 0;
  for (const seed of [0, 2, 48, 199307]) {
    for (let z = -4; z <= 4; z++)
      for (let x = -6; x <= 6; x++) {
        const data = generateChunk(x, z, seed, 0, 2);
        assert.equal(generateChunk(x, z, seed, 22, 2).landmark.pool, data.landmark.pool);
        assert.equal(generateChunk(x, z, seed, 0, 1).landmark.pool, undefined);
        if (data.landmark.kind === "poolroom") pools++;
        if (data.landmark.pool) {
          colonnades++;
          assert.equal(data.landmark.kind, "poolroom");
          assert.ok(x !== 0 || z !== 0);
        }
      }
    assert.equal(generateChunk(0, 0, seed, 0, 2).landmark.pool, undefined);
  }
  assert.ok(colonnades / pools > 0.1 && colonnades / pools < 0.3, `${colonnades}/${pools}`);
  assert.equal(fixture().landmark.pool, "colonnade");
});

test("v1 full pool chunks and pool-owned colliders retain their pre-variant goldens", () => {
  // Captured from the actual buildLandmark at pre-colonnade commit 78d33a7.
  // Keep all pool solids; unrelated world furniture has its own regression tests.
  const mats = headlessMaterials();
  try {
    for (const [seed, x, golden] of [
      [2, 2, "acee089dd489e4cb49f0d4b9f1897688295dbaadfcdac7f65ab233689e56e2c9"],
      [48, -3, "680f0b3e75d370e798f45ecc63c023997c26508ef23168bdff9c3cf0c807d742"],
      [199307, 1, "4a36f34cd10aa7cf3501ce7453792fba8d6aa642b1956fe23b6fd2943cf45005"],
    ] as const) {
      const data = generateChunk(x, 1, seed, 0, 1), group = new Group();
      const colliders: Box3[] = [];
      try {
        assert.equal(data.landmark.kind, "poolroom");
        const builder = { group, colliders, shapedColliders: [], lights: [], water: [], box: () => {}, plane: () => {} };
        buildLandmark(data, mats, builder);
        assert.equal(colliders.length, 6, "all four coping edges and both benches are retained");
        const digest = createHash("sha256").update(JSON.stringify([
          data, colliders.map((box) => [...box.min.toArray(), ...box.max.toArray()]),
        ])).digest("hex");
        assert.equal(digest, golden);
      } finally {
        group.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose(); });
      }
    }
  } finally { mats.dispose(); }
});

test("the colonnade adds nine bounded solids with unchanged water and no extra batches or materials", () => {
  const data = fixture(), ordinary = structuredClone(data);
  delete ordinary.landmark.pool;
  const mats = headlessMaterials(), section = buildSection(data, mats, 0), base = buildSection(ordinary, mats, 0);
  let sectionDisposed = false;
  try {
    const bounds = poolBounds(data.landmark)!;
    assert.deepEqual(bounds, poolBounds(ordinary.landmark));
    assert.equal(bounds.width, 16); assert.equal(bounds.length, 25);
    assert.equal(data.landmark.height, 6.8);
    const oldBoxes = new Set(base.colliders.map((box) => JSON.stringify(box)));
    const added = section.colliders.filter((box) => !oldBoxes.has(JSON.stringify(box)));
    assert.equal(section.colliders.length - base.colliders.length, 9);
    assert.equal(added.length, 9);
    assert.equal(added.filter((box) => box.min.y < 0).length, 6);
    for (const box of added) {
      assert.ok(box.min.x > data.x * SPAN + bounds.x + 3.4);
      assert.ok(box.max.x < data.x * SPAN + bounds.x + bounds.width - 3.4);
      assert.ok(box.min.z > data.z * SPAN + bounds.z + 4.9);
      assert.ok(box.max.z < data.z * SPAN + bounds.z + bounds.length - 4.9);
      assert.ok(box.min.y >= -1.4 - 1e-9 && box.max.y <= 6.8 + 1e-9);
      if (box.min.y > 0) assert.ok(Math.abs(box.min.y - 5.8) < 1e-9);
    }
    assert.equal(section.water.length, 1);
    assert.deepEqual(section.water[0].position, base.water[0].position);
    assert.deepEqual(section.water[0].geometry.getAttribute("position").array, base.water[0].geometry.getAttribute("position").array);
    assert.deepEqual(section.lights, base.lights);
    assert.equal(section.group.children.length, base.group.children.length);
    const triangles = (value: typeof section) => {
      let total = 0;
      value.group.traverse((object) => {
        if (object instanceof Mesh) total += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
      });
      return total;
    };
    assert.equal(triangles(section) - triangles(base), 108 - 30, "nine boxes replace fifteen lane-mark planes");
    let disposed = 0, meshes = 0;
    section.group.traverse((object) => {
      if (object instanceof Mesh) { meshes++; object.geometry.addEventListener("dispose", () => disposed++); }
    });
    section.dispose();
    sectionDisposed = true;
    assert.equal(disposed, meshes, "every section-owned geometry is released");
  } finally { if (!sectionDisposed) section.dispose(); base.dispose(); mats.dispose(); }
});

test("Rapier retains a complete dry route, blocks piers, and can pass between them", async () => {
  const data = fixture(), basin = poolBounds(data.landmark)!, mats = headlessMaterials();
  const section = buildSection(data, mats, 0), position = new Vector3();
  const bx = data.x * SPAN + basin.x, bz = data.z * SPAN + basin.z;
  const centerX = bx + 8, centerZ = bz + 12.5;
  const waypoints = [[bx - 1.1, bz - 1.1], [bx + 17.1, bz - 1.1], [bx + 17.1, bz + 26.1], [bx - 1.1, bz + 26.1]];
  const motor = await CharacterMotor.create({ x: waypoints[0][0], z: waypoints[0][1] });
  const chunks = new Map([["-2,-2", data]]);
  try {
    motor.addSection("-2,-2", data, section.colliders, section.shapedColliders);
    for (let i = 0; i < 30; i++) motor.move(0, 0, 1 / 60, position);
    for (const [x, z] of [...waypoints.slice(1), waypoints[0]]) {
      for (let i = 0; i < 900 && Math.hypot(x - position.x, z - position.z) > 0.08; i++) {
        const distance = Math.hypot(x - position.x, z - position.z);
        motor.move((x - position.x) / distance * 0.07, (z - position.z) / distance * 0.07, 1 / 60, position);
      }
      assert.ok(Math.hypot(x - position.x, z - position.z) < 0.1);
      assert.equal(footstepSurfaceAt(chunks, { x: position.x, y: position.y - 1.66, z: position.z }), "hard");
    }
    motor.teleport({ x: centerX - 6, z: centerZ });
    for (let i = 0; i < 120; i++) motor.move(0.04, 0, 1 / 60, position);
    assert.ok(Math.abs(position.x - (centerX - 4 - 0.55 - 0.235)) < 0.002, "pillar stops the real capsule");
    assert.ok(motor.grounded && position.y < 0.3);
    assert.equal(footstepSurfaceAt(chunks, { x: position.x, y: position.y - 1.66, z: position.z }), "water");
    motor.teleport({ x: centerX, z: centerZ - 9 });
    for (let i = 0; i < 60; i++) motor.move(0, 0, 1 / 60, position);
    for (let i = 0; i < 600 && position.z < centerZ + 9; i++) motor.move(0, 0.04, 1 / 60, position);
    assert.ok(position.z > centerZ + 8.9, `the aisle between the two rows remains traversable: ${position.z - centerZ}`);
    assert.ok(motor.grounded && position.y < 0.3);
  } finally { motor.dispose(); section.dispose(); mats.dispose(); }
});

for (const hz of [30, 60, 144])
  test(`colonnade pool entry and single-jump escape retain every edge and corner at ${hz}Hz`, async () => {
    const data = fixture(), basin = poolBounds(data.landmark)!, mats = headlessMaterials();
    const section = buildSection(data, mats, 0), position = new Vector3();
    const cx = data.x * SPAN + basin.x + 8, cz = data.z * SPAN + basin.z + 12.5;
    const motor = await CharacterMotor.create({ x: cx - 8.8, z: cz });
    try {
      motor.addSection("-2,-2", data, section.colliders, section.shapedColliders);
      for (let i = 0; i < hz; i++) motor.move(0, 0, 1 / hz, position);
      motor.jump();
      for (let i = 0; i < hz; i++) motor.move(2.35 / hz, 0, 1 / hz, position);
      for (let i = 0; i < hz; i++) motor.move(0, 0, 1 / hz, position);
      assert.ok(motor.grounded && position.y < 0.3 && position.x > cx - 7.5, "normal jump enters basin");
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        motor.teleport({ x: cx + dx * (8 - 0.65), z: cz + dz * (12.5 - 0.65) });
        const step = 2.35 / hz / Math.hypot(dx, dz);
        for (let i = 0; i < hz; i++) motor.move(dx * step, dz * step, 1 / hz, position);
        assert.ok(motor.grounded && position.y < 0.3);
        motor.jump();
        for (let i = 0; i < hz * 2; i++) motor.move(dx * step, dz * step, 1 / hz, position);
        assert.ok(Math.abs(position.x - cx) > 8.4 || Math.abs(position.z - cz) > 12.9, `escaped ${dx},${dz}`);
        assert.ok(motor.grounded && position.y > 1.6 && position.y < 1.7);
      }
    } finally { motor.dispose(); section.dispose(); mats.dispose(); }
  });
