import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { createDiscoveryParts, planDiscovery, type Discovery } from "../src/lib/game/discoveries";
import { CELL, CHUNK, SPAN, N, E, S, W, generateChunk, inLandmark } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

const cells = Array.from({ length: CHUNK * CHUNK }, (_, i) => ({ cx: i % CHUNK, cz: Math.floor(i / CHUNK) }));

test("discoveries are sparse, seeded, excluded from origin and wet/service themes", () => {
  let found = 0;
  const variants = new Set<number>();
  for (let x = -50; x < 50; x++) {
    const data = generateChunk(x, 1, 199307);
    const available = cells.filter(({ cx, cz }) => !inLandmark(data.landmark, cx, cz));
    const first = planDiscovery(data, available, new Set(), []);
    assert.deepEqual(planDiscovery(data, available, new Set(), []), first);
    if (data.theme === "service" || data.theme === "pool") assert.equal(first, null);
    if (first) {
      found++;
      variants.add(first.variant);
      assert.ok([N, E, S, W].includes(data.cells[first.cell]), "only a dead-end office");
      assert.equal(planDiscovery(data, available, new Set(available.map(({ cx, cz }) => cz * CHUNK + cx)), []), null);
      assert.equal(planDiscovery(data, available, new Set(), [new Box3(new Vector3(-10000, -1, -10000), new Vector3(10000, 5, 10000))]), null);
    }
  }
  assert.ok(found > 2 && found < 20, `${found} discoveries in 100 sections`);
  assert.equal(variants.size, 3);
  assert.equal(planDiscovery(generateChunk(0, 0, 199307), cells, new Set(), []), null);
});

test("actual discovery geometry stays inside its clearance bounds and rests at the wall", () => {
  const mats = headlessMaterials();
  try {
    for (const entrance of [N, E, S, W]) {
      const data = generateChunk(4, 1, 199307);
      data.theme = "offices";
      data.cells.fill(entrance);
      const discovery = planDiscovery(data, [{ cx: 3, cz: 3 }], new Set(), []);
      assert.ok(discovery);
      const parts = createDiscoveryParts(discovery, mats);
      try {
        const union = new Box3();
        for (const { geometry } of parts) {
          geometry.computeBoundingBox();
          union.union(geometry.boundingBox!);
          assert.ok(geometry.index && geometry.index.count > 0);
          for (const attribute of ["position", "normal", "uv"])
            assert.ok(Array.from(geometry.getAttribute(attribute).array).every(Number.isFinite));
        }
        assert.ok(discovery.bounds.clone().expandByScalar(1e-6).containsBox(union));
        assert.ok(Math.abs(union.min.y) < 1e-6);
        const center = new Vector3(CELL * 3.5, 1, CELL * 3.5);
        assert.ok(union.distanceToPoint(center) > 1.8, "far from the room center and exit lane");
      } finally { parts.forEach(({ geometry }) => geometry.dispose()); }
    }
  } finally { mats.dispose(); }
});

test("built discoveries avoid furniture and colliders and regenerate after section disposal", () => {
  const mats = headlessMaterials();
  const snapshot = () => {
    const data = generateChunk(4, 1, 199307);
    const section = buildSection(data, mats, 0);
    try {
      const discoveries: Discovery[] = section.group.userData.discoveries;
      assert.equal(discoveries.length, 1);
      for (const discovery of discoveries) {
        const bounds = discovery.bounds.clone().translate(new Vector3(data.x * SPAN, 0, data.z * SPAN));
        assert.ok(!section.colliders.some((collider) => collider.intersectsBox(bounds)));
        assert.ok(!section.group.userData.furniture.some((prop: { bounds: Box3 }) => prop.bounds.intersectsBox(discovery.bounds)));
      }
      return discoveries.map(({ cell, variant, pose }) => ({ cell, variant, pose: pose.elements }));
    } finally { section.dispose(); }
  };
  try { assert.deepEqual(snapshot(), snapshot()); }
  finally { mats.dispose(); }
});
