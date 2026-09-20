import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { EntityModel } from "../src/lib/game/entity-model";

for (const variant of ["stalker", "pyramid"] as const) {
  test(`${variant} has finite normalized skinning across anatomical joints`, () => {
    const material = new THREE.MeshBasicMaterial();
    const entity = new EntityModel(material, variant);
    const skin = entity.getObjectByName("continuous-void-skin") as THREE.SkinnedMesh;
    assert.ok(skin.isSkinnedMesh);
    const weights = skin.geometry.getAttribute("skinWeight");
    const indices = skin.geometry.getAttribute("skinIndex");
    const positions = skin.geometry.getAttribute("position");
    assert.ok(positions.count < 180000, "bounded surface geometry");
    const blended = new Set<string>();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      let sum = 0;
      const attached: THREE.Bone[] = [];
      for (let slot = 0; slot < 4; slot++) {
        const weight = weights.getComponent(vertex, slot);
        assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
        sum += weight;
        const bone = skin.skeleton.bones[indices.getComponent(vertex, slot)];
        assert.ok(bone);
        if (weight > 0.1) attached.push(bone);
      }
      assert.ok(Math.abs(sum - 1) < 1e-6);
      if (attached.length > 1) attached.forEach(bone => blended.add(bone.name));
      assert.ok(Number.isFinite(positions.getX(vertex)) && Number.isFinite(positions.getY(vertex)) && Number.isFinite(positions.getZ(vertex)));
    }
    for (const side of ["left", "right"]) {
      for (const joint of ["knee", "hand", "shoulder"]) {
        assert.ok(blended.has(`${side}-${joint}`), `skin distributes bending at ${side} ${joint}`);
      }
    }
    entity.traverse(object => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
    material.dispose();
  });
}
