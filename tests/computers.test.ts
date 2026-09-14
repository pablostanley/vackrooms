import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  computerKinds,
  computerScreen,
  createComputerModel,
} from "../src/lib/game/computer-models";
import {
  browserAddress,
  canUseComputer,
  computerFocus,
} from "../src/lib/game/computers";
import { buildSection } from "../src/lib/game/world";
import { generateChunk, CELL, canStand } from "../src/lib/game/maze";
import { headlessMaterials } from "./helpers/materials";

test("computers reproduce by tape with three distinct grounded models per section", () => {
  const mats = headlessMaterials();
  const snapshots = [];
  try {
    for (const seed of [1, 199307, 882731])
      for (const [x, z, depth] of [
        [0, 0, 0],
        [-2, 1, 1],
        [3, -2, 4],
      ]) {
        const data = generateChunk(x, z, seed, depth);
        const section = buildSection(data, mats, depth);
        const repeat = buildSection(data, mats, depth);
        try {
          const snapshot = (s: typeof section) =>
            s.computers.map((c) => ({
              id: c.id,
              kind: c.kind,
              position: c.position.toArray(),
              rotation: c.quaternion.toArray(),
            }));
          assert.equal(section.computers.length, 3);
          assert.deepEqual(
            new Set(section.computers.map((c) => c.kind)),
            new Set(computerKinds),
          );
          assert.deepEqual(snapshot(section), snapshot(repeat));
          snapshots.push(snapshot(section));
          for (const station of section.computers) {
            const approach = station.position
              .clone()
              .addScaledVector(station.normal, 1.1);
            assert.ok(
              canStand(new Map([[`${x},${z}`, data]]), approach.x, approach.z),
              "screen can be approached from its room",
            );
            assert.ok(
              !section.colliders.some((b) => b.containsPoint(approach)),
              "focus point is outside solid furniture",
            );
          }
          if (x === 0 && z === 0)
            assert.ok(
              section.computers.some(
                (c) =>
                  Math.abs(c.position.x - CELL * 2.5) < 2.5 &&
                  c.position.z <= CELL * 4.5,
              ),
              "a computer is introduced on the opening route",
            );
        } finally {
          section.dispose();
          repeat.dispose();
        }
      }
    assert.notDeepEqual(snapshots[0], snapshots[3]);
    for (const kind of computerKinds) {
      const model = createComputerModel(kind, mats);
      assert.ok(Math.abs(model.bounds.min.y) < 0.00001);
      assert.ok(model.bounds.containsPoint(computerScreen(kind).position));
      for (const part of model.parts) part.geometry.dispose();
    }
  } finally {
    mats.dispose();
  }
});

test("focus keeps the bulky bezel visible across aspect ratios and desk rotations", () => {
  const mats = headlessMaterials();
  const section = buildSection(generateChunk(0, 0, 199307), mats, 0);
  try {
    for (const station of section.computers)
      for (const aspect of [390 / 844, 1, 16 / 9, 21 / 9]) {
        const view = computerFocus(station, aspect);
        const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.065, 85);
        camera.position.copy(view.position);
        camera.quaternion.copy(view.quaternion);
        camera.updateMatrixWorld();
        for (const x of [-0.46, 0.46])
          for (const y of [-0.4, 0.35]) {
            const corner = new THREE.Vector3(x, y, 0)
              .applyQuaternion(station.quaternion)
              .add(station.position)
              .project(camera);
            assert.ok(
              Math.abs(corner.x) < 0.9 && Math.abs(corner.y) < 0.9,
              "monitor bezel fits in the view",
            );
          }
        if (aspect >= 1) assert.ok(canUseComputer(station, camera));
        camera.position
          .copy(station.position)
          .addScaledVector(station.normal, -1);
        camera.lookAt(station.position);
        assert.equal(
          canUseComputer(station, camera),
          false,
          "cannot interact through the back of a CRT",
        );
      }
  } finally {
    section.dispose();
    mats.dispose();
  }
});

test("the address bar accepts HTTPS sites and rejects executable or privileged URLs", () => {
  assert.equal(
    browserAddress(" vgpu.sh/examples "),
    "https://vgpu.sh/examples",
  );
  assert.equal(
    browserAddress("https://example.com/?q=desk#one"),
    "https://example.com/?q=desk#one",
  );
  for (const value of [
    "",
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "http://example.com",
    "https://user:pass@example.com",
    "not a url",
  ])
    assert.equal(browserAddress(value), null);
});
