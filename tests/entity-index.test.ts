import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { EntityModel } from "../src/lib/game/entity-model";
import { indexEntityGeometry } from "../src/lib/game/entity-index";

// Captured from the canonical (seed 0) bodies' unindexed position/normal/skinIndex/skinWeight buffers.
const baseline = {
  stalker: { vertices: 81672, unique: 14720, bytes: 869904, hash: "88d4d1cf646c4622c328a095172e25502ca25e4b020ca4f13308dc799f6ddfcf" },
  pyramid: { vertices: 72048, unique: 13007, bytes: 768432, hash: "b10dad7a644be956886a4d13ec01840e63de7e4f8e08bdfa50b150244c3f120a" },
};

for (const variant of ["stalker", "pyramid"] as const) {
  test(`${variant} indexed surface exactly reproduces baseline triangles and deformation`, () => {
    const material = new THREE.MeshBasicMaterial();
    const model = new EntityModel(material, variant);
    const skin = model.getObjectByName("continuous-void-skin") as THREE.SkinnedMesh;
    const expanded = skin.geometry.toNonIndexed();
    const reference = new THREE.SkinnedMesh(expanded, material);
    reference.bind(skin.skeleton, skin.bindMatrix);
    try {
      const expected = baseline[variant], hash = createHash("sha256");
      for (const name of ["position", "normal", "skinIndex", "skinWeight"])
        hash.update(Buffer.from(expanded.getAttribute(name).array.buffer));
      assert.equal(hash.digest("hex"), expected.hash, "every triangle attribute retains its baseline bits and order");
      assert.equal(skin.geometry.index!.count, expected.vertices);
      assert.equal(skin.geometry.getAttribute("position").count, expected.unique);
      assert.ok(skin.geometry.index!.array instanceof Uint16Array);
      const bytes = Object.values(skin.geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, skin.geometry.index!.array.byteLength);
      assert.equal(bytes, expected.bytes);
      assert.ok(bytes < expected.vertices * 48 * 0.23, "resident buffers stay below 23% of the unindexed surface");
      assert.ok(bytes <= 914304, "the fuller anatomy stays within the original creature's residency");
      const actual = new THREE.Vector3(), original = new THREE.Vector3();
      for (const [gait, speed, reach, squeeze] of [[0, 0, 0, 0], [1.5, 2.85, 0, 0], [3.8, 4.65, 1, 1]]) {
        model.animate(gait, speed > 0, speed, 1, reach, squeeze);
        model.updateMatrixWorld(true);
        skin.skeleton.update();
        for (let triangleVertex = 0; triangleVertex < expected.vertices; triangleVertex++) {
          skin.getVertexPosition(skin.geometry.index!.getX(triangleVertex), actual);
          reference.getVertexPosition(triangleVertex, original);
          assert.deepEqual(actual.toArray(), original.toArray());
          assert.ok(actual.toArray().every(Number.isFinite));
        }
      }
    } finally {
      expanded.dispose();
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      });
      material.dispose();
    }
  });
}

test("exact indexing preserves signed zero, attribute seams, and large index ranges", () => {
  const small = new THREE.BufferGeometry();
  small.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  small.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0], 3));
  indexEntityGeometry(small);
  assert.deepEqual(Array.from(small.index!.array), [0, 1, 0, 2]);
  assert.ok(Object.is(small.getAttribute("position").getX(1), -0));
  small.dispose();
  const large = new THREE.BufferGeometry();
  const positions = new Float32Array(65538 * 3);
  for (let i = 0; i < 65538; i++) positions[i * 3] = i;
  large.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  indexEntityGeometry(large);
  assert.ok(large.index!.array instanceof Uint32Array);
  assert.equal(large.index!.getX(65537), 65537);
  large.dispose();
});
