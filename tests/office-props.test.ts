import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { createFurniture } from "../src/lib/game/furniture-models";
import { buildSection } from "../src/lib/game/world";
import { generateChunk } from "../src/lib/game/maze";
import { headlessMaterials } from "./helpers/materials";

const kinds = ["waterCooler", "photocopier", "archiveCartons"] as const;

test("office props have bounded indexed solids and anchors inside actual geometry", () => {
  const mats = headlessMaterials();
  try {
    for (const kind of kinds) {
      const model = createFurniture(kind, mats);
      try {
        const union = new Box3();
        let vertices = 0;
        let anchored = false;
        for (const { geometry } of model.parts) {
          assert.ok(geometry.index && geometry.index.count % 3 === 0);
          for (const name of ["position", "normal", "uv"])
            assert.ok(Array.from(geometry.getAttribute(name).array).every(Number.isFinite));
          union.union(geometry.boundingBox!);
          anchored ||= geometry.boundingBox!.containsPoint(model.anchor);
          vertices += geometry.getAttribute("position").count;
        }
        assert.ok(union.equals(model.bounds), `${kind} collision bound contains every detail`);
        assert.ok(anchored, `${kind} wall attachment anchor is inside a solid`);
        assert.ok(Math.abs(union.min.y) < 1e-6, `${kind} rests on the floor`);
        const size = union.getSize(new Vector3());
        assert.ok(size.x < 1.3 && size.z < 0.85 && size.y < 1.6, `${kind} fits office clearance`);
        assert.ok(vertices < 3500, `${kind} stays small enough for resident-section batches`);
      } finally {
        model.parts.forEach(({ geometry }) => geometry.dispose());
      }
    }
  } finally {
    mats.dispose();
  }
});


test("each new office prop is discoverable, collidable, and reproducible on its tape", () => {
  const mats = headlessMaterials();
  try {
    for (const [kind, seed] of [["waterCooler", 1], ["archiveCartons", 14], ["photocopier", 16]] as const) {
      const snapshot = () => {
        const section = buildSection(generateChunk(0, 0, seed), mats, 0);
        try {
          const props = (section.group.userData.furniture as { kind: string; attachment: string; bounds: Box3 }[])
            .filter((prop) => prop.kind === kind && prop.attachment === "floor");
          assert.ok(props.length > 0, `${kind} has an accessible floor placement on tape ${seed}`);
          for (const prop of props) {
            assert.ok(section.colliders.some((bounds) => bounds.equals(prop.bounds)), `${kind} has physical collision`);
            assert.ok(Math.abs(prop.bounds.min.y) < 1e-6);
          }
          return props.map(({ bounds }) => [bounds.min.toArray(), bounds.max.toArray()]);
        } finally { section.dispose(); }
      };
      assert.deepEqual(snapshot(), snapshot(), `${kind} survives section eviction and regeneration`);
    }
  } finally { mats.dispose(); }
});
