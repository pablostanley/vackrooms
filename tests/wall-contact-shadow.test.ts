import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CELL, generateChunk } from "../src/lib/game/maze";
import { wallContactShadowGeometry } from "../src/lib/game/wall-contact-shadow";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("all four wall-contact strips face up and fade outward within their original footprint", () => {
  for (const vertical of [false, true])
    for (const side of [-1, 1]) {
      const geometry = wallContactShadowGeometry(vertical, side);
      try {
        geometry.translate(vertical ? side * 0.39 : 0, 0.006, vertical ? 0 : side * 0.39);
        const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
        const along = vertical ? "getZ" : "getX", across = vertical ? "getX" : "getZ";
        for (let i = 0; i < p.count; i++) {
          assert.ok(n.getY(i) > 0.9999, "FrontSide remains visible from the room");
          assert.ok(Math.abs(p.getY(i) - 0.006) < 1e-7);
          assert.ok(Math.abs(Math.abs(p[along](i)) - CELL / 2) < 1e-6);
          const outward = side * p[across](i);
          const expected = uv.getY(i) === 1 ? 0.065 : 0.715;
          assert.ok(Math.abs(outward - expected) < 1e-6, "dark V=1 edge adjoins wall; transparent V=0 edge faces room");
        }
        const a = new THREE.Vector3().fromBufferAttribute(p, 0), b = new THREE.Vector3().fromBufferAttribute(p, 2), c = new THREE.Vector3().fromBufferAttribute(p, 1);
        assert.ok(b.sub(a).cross(c.sub(a)).y > 0, "triangle winding agrees with the upward normal");
      } finally { geometry.dispose(); }
    }
});

test("real section batching preserves upward shadow normals across positive and negative sections", () => {
  const mats = headlessMaterials();
  try {
    for (const [x, z] of [[0, 0], [-2, 1]]) {
      const section = buildSection(generateChunk(x, z, 199307), mats, 0);
      try {
        let vertices = 0;
        section.group.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || object.material !== mats.shadow) return;
          const p = object.geometry.getAttribute("position"), n = object.geometry.getAttribute("normal");
          for (let i = 0; i < p.count; i++) {
            assert.ok(n.getY(i) > 0.9999);
            assert.ok(Math.abs(p.getY(i) - 0.006) < 1e-7);
          }
          vertices += p.count;
        });
        assert.ok(vertices > 100, "exercise batched wall strips, not an empty fixture");
      } finally { section.dispose(); }
    }
  } finally { mats.dispose(); }
});
