import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { ShadowCache } from "../src/lib/game/shadow-cache";
import { ScreenVisibility } from "../src/lib/game/screen-visibility";
import { buildSection } from "../src/lib/game/world";
import { generateChunk } from "../src/lib/game/maze";
import type { ComputerStation } from "../src/lib/game/computers";
import { headlessMaterials } from "./helpers/materials";

test("cached shadows refresh for fixture/world changes and clear departed casters", () => {
  const lights = [new THREE.SpotLight(), new THREE.SpotLight()];
  const cache = new ShadowCache(lights);
  const finishRender = () =>
    lights.forEach((light) => {
      light.shadow.needsUpdate = false;
    });
  assert.ok(
    lights.every(
      (light) => !light.shadow.autoUpdate && light.shadow.needsUpdate,
    ),
  );
  finishRender();
  for (let frame = 0; frame < 120; frame++) {
    lights[0].intensity = 24 + Math.sin(frame);
    cache.update(false);
    assert.ok(
      lights.every((light) => !light.shadow.needsUpdate),
      "flicker reuses shadow depth",
    );
  }
  cache.place(lights[0], new THREE.Vector3(4, 3, 8));
  assert.ok(lights[0].shadow.needsUpdate);
  assert.equal(lights[1].shadow.needsUpdate, false);
  assert.deepEqual(lights[0].target.position.toArray(), [4, 0, 8]);
  finishRender();
  cache.place(lights[0], new THREE.Vector3(4, 3, 8));
  assert.equal(lights[0].shadow.needsUpdate, false);
  cache.invalidate();
  assert.ok(
    lights.every((light) => light.shadow.needsUpdate),
    "streaming/descent invalidates every map",
  );
  finishRender();
  for (const moving of [true, true, false]) {
    cache.update(moving);
    assert.ok(
      lights.every((light) => light.shadow.needsUpdate),
      "animate or clear the caster",
    );
    finishRender();
  }
  cache.update(false);
  assert.ok(lights.every((light) => !light.shadow.needsUpdate));
  lights.forEach((light) => light.dispose());
});

function referenceVisibility(
  station: ComputerStation,
  position: THREE.Vector3,
  meshes: THREE.Mesh[],
) {
  const raycaster = new THREE.Raycaster();
  for (const [x, y] of [
    [0, 0],
    [-0.49, -0.49],
    [-0.49, 0.49],
    [0.49, -0.49],
    [0.49, 0.49],
  ]) {
    const delta = new THREE.Vector3(x * station.width, y * station.height, 0)
      .applyQuaternion(station.quaternion)
      .add(station.position)
      .sub(position);
    raycaster.set(position, delta.clone().normalize());
    raycaster.far = delta.length() - 0.025;
    if (raycaster.intersectObjects(meshes, false).length) return false;
  }
  return true;
}

test("cached section occluders retain exact glass visibility across rooms and pool sections", () => {
  const mats = headlessMaterials();
  const visibility = new ScreenVisibility();
  let clear = 0,
    blocked = 0;
  try {
    for (const seed of [1, 2, 199307]) {
      const sections = [0, 1].map((x) =>
        buildSection(generateChunk(x, 0, seed), mats, 0),
      );
      try {
        const meshes = sections.flatMap((section) => section.occluders);
        // Match the live renderer's transparent water before collecting the
        // original per-update scene traversal used as the reference.
        for (const section of sections)
          for (const water of section.water) water.material = mats.shadow;
        const referenceMeshes = sections.flatMap((section) =>
          section.group.children.filter(
            (object): object is THREE.Mesh =>
              object instanceof THREE.Mesh &&
              !(object.material as THREE.Material).transparent,
          ),
        );
        assert.deepEqual(meshes, referenceMeshes);
        for (const section of sections) {
          assert.ok(
            section.water.every((mesh) => !section.occluders.includes(mesh)),
          );
          for (const station of section.computers) {
            for (const distance of [1.1, 3, 8, 17]) {
              for (const side of [-3, 0, 3]) {
                const position = station.position
                  .clone()
                  .addScaledVector(station.normal, distance);
                position.x += side;
                position.y = 1.66;
                const expected = referenceVisibility(
                  station,
                  position,
                  referenceMeshes,
                );
                assert.equal(
                  visibility.unobstructed(station, position, meshes),
                  expected,
                );
                if (expected) clear++;
                else blocked++;
              }
            }
          }
        }
      } finally {
        sections.forEach((section) => section.dispose());
      }
    }
    assert.ok(
      clear > 0 && blocked > 0,
      "checks both visible and occluded screens",
    );
  } finally {
    mats.dispose();
  }
});

test("screen visibility checks the corners and stops after an obstruction", () => {
  const material = new THREE.MeshBasicMaterial();
  const blocker = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.1),
    material,
  );
  blocker.position.set(0.49, 0.49, 1);
  blocker.updateMatrixWorld();
  const station: ComputerStation = {
    id: "test",
    kind: "computerDesk",
    homeUrl: "https://vgpu.sh/",
    position: new THREE.Vector3(0, 0, 0),
    normal: new THREE.Vector3(0, 0, 1),
    quaternion: new THREE.Quaternion(),
    width: 2,
    height: 2,
  };
  const position = new THREE.Vector3(0, 0, 2);
  const visibility = new ScreenVisibility();
  assert.equal(
    visibility.unobstructed(station, position, [blocker]),
    false,
    "a clipped corner hides the glass",
  );
  blocker.position.set(0, 0, 1);
  blocker.updateMatrixWorld();
  const later = new THREE.Mesh();
  later.raycast = () => assert.fail("must stop at the first blocker");
  assert.equal(
    visibility.unobstructed(station, position, [blocker, later]),
    false,
  );
  assert.equal(
    visibility.unobstructed(station, position, []),
    true,
    "previous hits do not leak into another query",
  );
  blocker.geometry.dispose();
  later.geometry.dispose();
  (later.material as THREE.Material).dispose();
  material.dispose();
});
