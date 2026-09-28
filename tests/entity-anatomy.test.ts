import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  entityBodySeed,
  MAX_HEIGHT,
  rollEntityBody,
  standingHeight,
  type EntityBody,
  type EntityVariant,
} from "../src/lib/game/entity-anatomy";
import { EntityModel, sculptEntity } from "../src/lib/game/entity-model";

const seeds = Array.from({ length: 600 }, (_, i) => entityBodySeed(199307, i % 2, i));
const bodies = seeds.map(seed => rollEntityBody("stalker", seed));

// One sculpted sample per feature keeps the suite fast while covering every part.
const samples = new Map<string, [EntityVariant, number]>();
const want = (name: string, test: (body: EntityBody) => boolean) => {
  const index = bodies.findIndex(test);
  assert.ok(index >= 0, `some body has ${name}`);
  samples.set(name, ["stalker", seeds[index]]);
};
for (const kind of ["skull", "bulb", "long", "jaw", "pin", "slab"]) want(`${kind} head`, b => b.heads[0].kind === kind);
for (const hand of ["long", "splay", "claw", "twig", "mitten"]) want(`${hand} hands`, b => b.arms.some(a => a.hand === hand));
want("two heads", b => b.heads.length === 2);
want("a limp", b => b.legs[0] !== b.legs[1]);
want("one long arm", b => b.arms[0].upper / b.arms[1].upper > 1.15 || b.arms[1].upper / b.arms[0].upper > 1.15);
samples.set("pyramid", ["pyramid", seeds[3]]);

const dispose = (model: THREE.Object3D) => model.traverse(object => {
  if (object instanceof THREE.Mesh) object.geometry.dispose();
  if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
});

test("each appearance seed grows one reproducible body", () => {
  assert.deepEqual(rollEntityBody("stalker", seeds[5]), rollEntityBody("stalker", seeds[5]));
  assert.equal(new Set(seeds).size, seeds.length, "appearances never repeat a seed");
  assert.ok(seeds.every(seed => seed > 0), "seed zero stays reserved for the canonical body");
  assert.equal(entityBodySeed(1, 0, 3), entityBodySeed(1, 0, 3));
  assert.notEqual(entityBodySeed(1, 0, 3), entityBodySeed(2, 0, 3), "each tape has its own relatives");
});

test("bodies vary in heads, heights, limbs and symmetry", () => {
  const heights = bodies.map(standingHeight);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.3, "heights spread across a third of a meter");
  const share = (test: (body: EntityBody) => boolean) => bodies.filter(test).length / bodies.length;
  assert.ok(share(b => b.heads.length === 2) > 0.1 && share(b => b.heads.length === 2) < 0.3, "two heads are uncommon, not rare");
  assert.ok(share(b => b.legs[0] !== b.legs[1]) > 0.12, "some legs are uneven");
  assert.ok(share(b => b.arms[0].hand !== b.arms[1].hand) > 0.05, "some hands differ side to side");
  assert.ok(new Set(bodies.map(b => b.heads[0].kind)).size === 6);
  for (let i = 1; i < 40; i++) assert.notDeepEqual(bodies[i], bodies[i - 1], "consecutive appearances differ");
});

test("every body stands under the ceiling with hands off the floor", () => {
  for (const variant of ["stalker", "pyramid"] as const) for (const seed of seeds) {
    const body = rollEntityBody(variant, seed);
    assert.ok(standingHeight(body) <= MAX_HEIGHT + 1e-9, `seed ${seed} fits under the ceiling`);
  }
  for (const [name, [variant, seed]] of samples) {
    const model = new EntityModel(new THREE.MeshBasicMaterial(), variant, seed);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    assert.ok(box.max.y < 3.0, `${name} clears the 3.15m ceiling (${box.max.y.toFixed(2)}m)`);
    for (const side of ["left", "right"]) {
      const hand = model.getObjectByName(`${side}-hand`)!.getWorldPosition(new THREE.Vector3());
      assert.ok(hand.y > 0.3, `${name} ${side} hand hangs clear of the floor`);
    }
    dispose(model);
  }
});

test("sampled bodies skin cleanly and stay inside the shadow bound", () => {
  const vertex = new THREE.Vector3(), center = new THREE.Vector3(0, 1.4, 0);
  for (const [name, [variant, seed]] of samples) {
    const model = new EntityModel(new THREE.MeshBasicMaterial(), variant, seed);
    const skin = model.getObjectByName("continuous-void-skin") as THREE.SkinnedMesh;
    const weights = skin.geometry.getAttribute("skinWeight");
    for (let i = 0; i < weights.count; i++) {
      const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      assert.ok(Math.abs(sum - 1) < 1e-6, `${name} weights normalize`);
    }
    for (const reach of [0, 1]) for (let frame = 0; frame < 12; frame++) {
      model.animate(frame * Math.PI / 3, true, 4, 1, reach, frame / 12, 0.1);
      model.updateMatrixWorld(true);
      const positions = skin.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i += 3) {
        skin.getVertexPosition(i, vertex).applyMatrix4(skin.matrixWorld);
        assert.ok(vertex.toArray().every(Number.isFinite));
        assert.ok(vertex.distanceTo(center) <= 2.2, `${name} stays within the shadow bound`);
      }
    }
    dispose(model);
  }
});

test("uneven legs keep planted feet on the floor with forward knees", () => {
  const [, seed] = samples.get("a limp")!;
  const model = new EntityModel(new THREE.MeshBasicMaterial(), "stalker", seed, null);
  const [left, right] = model.body.legs;
  assert.notEqual(left, right);
  for (const speed of [1.2, 4.65]) for (let i = 0; i < 60; i++) {
    model.animate(i / 60 * Math.PI * 2, true, speed, 1);
    model.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const [side, length] of [["left", left], ["right", right]] as const) {
      const h = model.getObjectByName(`${side}-hip`)!.getWorldPosition(new THREE.Vector3());
      const k = model.getObjectByName(`${side}-knee`)!.getWorldPosition(new THREE.Vector3());
      const a = model.getObjectByName(`${side}-ankle`)!.getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(h.distanceTo(k) - length) < 1e-6 && Math.abs(k.distanceTo(a) - length) < 1e-6);
      assert.ok(a.y >= 0.045, `${side} foot stays above the floor`);
      lowest = Math.min(lowest, a.y);
    }
    assert.ok(lowest < 0.07, "one foot is always near the floor");
  }
});

test("worker surfaces match an in-place sculpt bit for bit", () => {
  const [, seed] = samples.get("two heads")!;
  const surface = sculptEntity("stalker", seed);
  const material = new THREE.MeshBasicMaterial();
  const direct = new EntityModel(material, "stalker", seed);
  const prebuilt = new EntityModel(material, "stalker", seed, surface);
  const a = (direct.getObjectByName("continuous-void-skin") as THREE.SkinnedMesh).geometry;
  const b = (prebuilt.getObjectByName("continuous-void-skin") as THREE.SkinnedMesh).geometry;
  for (const name of ["position", "normal", "skinIndex", "skinWeight"])
    assert.deepEqual(a.getAttribute(name).array, b.getAttribute(name).array);
  assert.deepEqual(a.index!.array, b.index!.array);
  assert.ok(prebuilt.sculpted && !new EntityModel(material, "stalker", seed, null).sculpted);
  assert.ok(prebuilt.getObjectByName("head-1"), "the second head has its own bone");
  dispose(direct);
  dispose(prebuilt);
});
