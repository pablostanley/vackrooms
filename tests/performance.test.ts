import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { ShadowCache } from "../src/lib/game/shadow-cache";
import { ScreenVisibility } from "../src/lib/game/screen-visibility";
import { buildSection } from "../src/lib/game/world";
import { generateChunk } from "../src/lib/game/maze";
import type { ComputerStation } from "../src/lib/game/computers";
import { headlessMaterials } from "./helpers/materials";
import { qualityProfile, contactShadowsEnabled } from "../src/lib/game/render-quality";
import { RenderResolution } from "../src/lib/game/render-resolution";
import { EntityModel } from "../src/lib/game/entity-model";

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
    cache.update([]);
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
  const caster = new THREE.Sphere(new THREE.Vector3(4, 1.4, 8), 2.2);
  cache.place(lights[1], new THREE.Vector3(5, 3, 8));
  finishRender();
  for (const moving of [caster, caster, null]) {
    cache.update(moving ? [moving] : []);
    assert.ok(
      lights.every((light) => light.shadow.needsUpdate),
      "animate or clear the caster",
    );
    finishRender();
  }
  cache.update([]);
  assert.ok(lights.every((light) => !light.shadow.needsUpdate));
  lights.forEach((light) => light.dispose());
});

test("fixture rank changes retain shadow maps and only new fixtures replace slots", () => {
  const lights = [new THREE.SpotLight(), new THREE.SpotLight(), new THREE.SpotLight()];
  const cache = new ShadowCache(lights);
  const fixtures = [0, 4, 8, 12].map((x) => ({ position: new THREE.Vector3(x, 3, 4) }));
  cache.assign(fixtures);
  const positions = lights.map((light) => light.position.clone());
  lights.forEach((light) => { light.shadow.needsUpdate = false; });
  const reordered = cache.assign([fixtures[2], fixtures[0], fixtures[1], fixtures[3]]);
  assert.deepEqual(reordered, fixtures.slice(0, 3));
  assert.ok(lights.every((light, i) => light.position.equals(positions[i]) && !light.shadow.needsUpdate));
  const replaced = cache.assign([fixtures[3], fixtures[1], fixtures[2], fixtures[0]]);
  assert.deepEqual(replaced, [fixtures[3], fixtures[1], fixtures[2]]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [true, false, false]);
  assert.equal(cache.assign([]).filter(Boolean).length, 0);
  lights.forEach((light) => light.dispose());
});

test("moving casters refresh only intersecting lights and clear departed shadows once", () => {
  const lights = [0, 40, 80].map(() => new THREE.SpotLight("white", 24, 16, 1.32));
  const cache = new ShadowCache(lights);
  lights.forEach((light, i) => cache.place(light, new THREE.Vector3(i * 40, 3, 0)));
  const finishRender = () => lights.forEach((light) => { light.shadow.needsUpdate = false; });
  const caster = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 2.2);
  finishRender();
  cache.update([caster]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [true, false, false]);
  finishRender();
  caster.center.x = 40;
  cache.update([caster]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [true, true, false]);
  finishRender();
  cache.update([caster]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [false, true, false]);
  finishRender();
  cache.update([]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [false, true, false]);
  finishRender();
  cache.update([]);
  assert.ok(lights.every((light) => !light.shadow.needsUpdate));
  const second = new THREE.Sphere(new THREE.Vector3(80, 1.4, 0), 2.2);
  cache.update([caster, second]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [false, true, true]);
  finishRender();
  cache.update([second]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [false, true, true]);
  finishRender();
  cache.update([second]);
  assert.deepEqual(lights.map((light) => light.shadow.needsUpdate), [false, false, true]);
  cache.invalidate();
  assert.ok(lights.every((light) => light.shadow.needsUpdate), "world changes still refresh all maps");
  lights.forEach((light) => light.dispose());
});

for (const variant of ["stalker", "pyramid"] as const) test(`the shadow-culling sphere encloses the ${variant} through walking and reaching poses`, () => {
  const material = new THREE.MeshBasicMaterial();
  const entity = new EntityModel(material, variant);
  assert.equal(!!entity.getObjectByName("pyramid-head"), variant === "pyramid");
  const vertex = new THREE.Vector3();
  const center = new THREE.Vector3(0, 1.4, 0);
  for (const reach of [0, 1]) {
    for (let frame = 0; frame < 24; frame++) {
      entity.animate(frame * Math.PI / 6, true, 4, 1, reach, frame / 24, 0.1);
      entity.updateMatrixWorld(true);
      entity.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i);
          if (object instanceof THREE.SkinnedMesh) object.applyBoneTransform(i, vertex);
          vertex.applyMatrix4(object.matrixWorld);
          assert.ok(vertex.distanceTo(center) <= 2.2, "animated tissue remains inside the shadow bound");
        }
      });
    }
  }
  entity.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  material.dispose();
});

test("render resolution starts at high detail with a bounded 4K pixel workload", () => {
  const resolution = new RenderResolution("high");
  assert.equal(resolution.pixelRatio(1280, 720, 2), 2);
  assert.equal(resolution.pixelRatio(390, 844, 3), 2);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 1);
  for (const [width, height] of [[3840, 2160], [2560, 1440], [5120, 1440], [1440, 2560]]) {
    const ratio = resolution.pixelRatio(width, height, 2);
    assert.ok(width * height * ratio * ratio <= 3840 * 2160 + 0.01);
    assert.ok(ratio > 0);
  }
});

test("resolution ignores standby and isolated hitches, then steps down on sustained slow gameplay", () => {
  const resolution = new RenderResolution();
  const sample = (frames: number, milliseconds: number, playing = true) => {
    let changes = 0;
    for (let i = 0; i < frames; i++) changes += Number(resolution.recordFrame(milliseconds, playing));
    return changes;
  };
  assert.equal(sample(300, 1000 / 30, false), 0, "standby is intentionally capped");
  assert.equal(sample(480, 1000 / 120), 0, "high-refresh gameplay retains detail");
  assert.equal(sample(1, 2000), 0, "background and streaming gaps reset sampling");
  assert.equal(sample(120, 1000 / 60), 0);
  assert.equal(sample(1, 100), 0, "one slow frame does not resize");
  assert.equal(sample(240, 1000 / 60), 0);
  resolution.resetSampling();
  assert.equal(sample(100, 1000 / 30), 1);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 0.85);
  assert.equal(sample(600, 1000 / 60), 0, "recovery does not cause resolution oscillation");
  resolution.resetSampling();
  assert.equal(sample(100, 1000 / 30), 1);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 0.7);
  assert.equal(sample(600, 1000 / 20), 2);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 0.35);
  assert.equal(sample(600, 1000 / 20), 0, "minimum scale is bounded");
});

test("sustained severe frame stalls can recover without treating an isolated gap as low performance", () => {
  const resolution = new RenderResolution();
  assert.equal(resolution.recordFrame(1000, true), false);
  assert.equal(resolution.recordFrame(16, true), false);
  assert.equal(resolution.recordFrame(300, true), false);
  assert.equal(resolution.recordFrame(300, true), false);
  assert.equal(resolution.recordFrame(300, true), true);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 0.85);
  for (let i = 0; i < 10; i++) {
    assert.equal(resolution.recordFrame(1000, false), false, "paused frames never lower resolution");
  }
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


test("quality budgets bound GPU pixels at every viewport without reducing the HUD", () => {
  for (const quality of ["auto", "high", "balanced", "low"] as const) {
    const resolution = new RenderResolution(quality);
    for (const [w, h, dpr] of [[390, 844, 3], [1920, 1080, 2], [5120, 2880, 2]]) {
      const ratio = resolution.pixelRatio(w, h, dpr);
      assert.ok(w * h * ratio ** 2 <= qualityProfile(quality).maxPixels + 0.01);
      assert.ok(ratio <= qualityProfile(quality).maxDpr);
    }
  }
  assert.equal(new RenderResolution().pixelRatio(1280, 720, 2), 1.25);
  assert.equal(new RenderResolution("low").pixelRatio(1920, 1080, 2), 2 / 3);
});

test("manual presets remain stable and switching quality clears adaptive downscaling", () => {
  const resolution = new RenderResolution();
  for (let i = 0; i < 3; i++) resolution.recordFrame(300, true);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 0.85);
  assert.equal(resolution.setQuality("high"), true);
  for (let i = 0; i < 600; i++) assert.equal(resolution.recordFrame(100, true), false);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 1);
  assert.equal(resolution.setQuality("auto"), true);
  assert.equal(resolution.pixelRatio(1920, 1080, 1), 1);
  assert.equal(resolution.setQuality("auto"), false);
});

test("low quality removes contact passes and an explicit off applies to every preset", () => {
  for (const quality of ["auto", "high", "balanced", "low"] as const) {
    assert.equal(contactShadowsEnabled({ quality, contactShadows: true, tapeEffects: true }), quality !== "low");
    assert.equal(contactShadowsEnabled({ quality, contactShadows: false, tapeEffects: true }), false);
  }
});
