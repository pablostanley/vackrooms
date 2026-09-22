import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { generateChunk } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { SURFACE_SIZE } from "../src/lib/game/surface-textures";
import { headlessMaterials } from "./helpers/materials";

for (const [variant, x] of [["ground", -3], ["overlook", 3]] as const)
  test(`${variant} courtyard wood circle matches world-scale grain without changing its shape`, () => {
    const data = generateChunk(x, -2, 199307);
    assert.equal(data.landmark.courtyard, variant);
    const mats = headlessMaterials();
    mats.courtyardWood.userData.surfaceMeters = SURFACE_SIZE.wood;
    const section = buildSection(data, mats, 0);
    const original = new THREE.CylinderGeometry(2.9, 2.9, 0.025, 48);
    try {
      const circle = section.group.children.find((object) => object instanceof THREE.Mesh && object.geometry instanceof THREE.CylinderGeometry && object.material === mats.courtyardWood);
      assert.ok(circle instanceof THREE.Mesh);
      assert.ok(circle.geometry instanceof THREE.CylinderGeometry);
      const geometry = circle.geometry;
      assert.deepEqual(geometry.getAttribute("position").array, original.getAttribute("position").array);
      assert.deepEqual(geometry.getAttribute("normal").array, original.getAttribute("normal").array);
      assert.deepEqual(geometry.index!.array, original.index!.array);
      const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
      const point = new THREE.Vector3();
      let top = 0, rim = 0;
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(circle.matrixWorld);
        if (Math.abs(n.getY(i)) > 0.5) {
          assert.ok(Math.abs(uv.getX(i) * SURFACE_SIZE.wood - point.x) < 0.00003);
          assert.ok(Math.abs(uv.getY(i) * SURFACE_SIZE.wood - (n.getY(i) > 0 ? -point.z : point.z)) < 0.00003);
          if (n.getY(i) > 0) top++;
        } else {
          assert.ok(Math.abs(uv.getY(i) * SURFACE_SIZE.wood - point.y) < 0.000003);
          rim++;
        }
      }
      assert.ok(top > 0 && rim > 0);
      // The thin cylindrical edge keeps a continuous unwrap, including across
      // the normal-axis changes at 45 degrees. No collapsed/stretched triangles.
      const index = geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        if (n.getY(a) !== 0) continue;
        const du = Math.max(uv.getX(a), uv.getX(b), uv.getX(c)) - Math.min(uv.getX(a), uv.getX(b), uv.getX(c));
        const dv = Math.max(uv.getY(a), uv.getY(b), uv.getY(c)) - Math.min(uv.getY(a), uv.getY(b), uv.getY(c));
        assert.ok(Math.abs(du * SURFACE_SIZE.wood - 2 * Math.PI * 2.9 / 48) < 0.000003);
        assert.ok(Math.abs(dv * SURFACE_SIZE.wood - 0.025) < 0.000003);
      }
      // The neighboring wood strip uses the same top-plane mapping and phase.
      const strip = section.group.children.find((object) => object instanceof THREE.Mesh && object !== circle && !Array.isArray(object.material) && object.material.userData.surfaceMeters === SURFACE_SIZE.wood);
      assert.ok(strip instanceof THREE.Mesh);
      const sp = strip.geometry.getAttribute("position"), su = strip.geometry.getAttribute("uv");
      for (let i = 0; i < sp.count; i++) {
        assert.ok(Math.abs(su.getX(i) * SURFACE_SIZE.wood - sp.getX(i)) < 0.00003);
        assert.ok(Math.abs(su.getY(i) * SURFACE_SIZE.wood + sp.getZ(i)) < 0.00003);
      }
    } finally {
      original.dispose(); section.dispose(); mats.dispose();
    }
  });
