import assert from "node:assert/strict";
import test from "node:test";
import { Material, Mesh } from "three";
import { generateChunk } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

test("retiring a section releases object bindings and geometry without disposing shared materials or neighbors", () => {
  const mats = headlessMaterials();
  const shared = new Set(Object.values(mats).flat().filter((value) => value instanceof Material));
  let sharedDisposals = 0;
  for (const material of shared) material.addEventListener("dispose", () => sharedDisposals++);
  const sections = [0, 1].map((x) => buildSection(generateChunk(x, 0, 199307), mats, 0));
  const records = sections.map((section) => {
    const meshes: { object: number; geometry: number }[] = [];
    section.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const record = { object: 0, geometry: 0 };
      object.addEventListener("dispose", () => record.object++);
      object.geometry.addEventListener("dispose", () => record.geometry++);
      meshes.push(record);
    });
    assert.ok(meshes.length > 10, "exercise actual generated architecture and furniture batches");
    return meshes;
  });
  try {
    sections[0].dispose();
    assert.ok(records[0].every((record) => record.object === 1 && record.geometry === 1));
    assert.ok(records[1].every((record) => record.object === 0 && record.geometry === 0), "resident neighbor retains its resources");
    assert.equal(sharedDisposals, 0, "shared materials stay alive across streaming");
    sections[1].dispose();
    assert.ok(records[1].every((record) => record.object === 1 && record.geometry === 1));
    assert.equal(sharedDisposals, 0);
  } finally {
    // An assertion failure must still release any section not retired above.
    sections.forEach((section, i) => {
      if (records[i].every((record) => record.geometry === 0)) section.dispose();
    });
    mats.dispose();
  }
});
