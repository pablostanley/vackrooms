import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BufferGeometry, Material, Mesh } from "three";
import { createFurniture, type FurnitureKind, type FurnitureModel } from "../src/lib/game/furniture-models";
import { furnitureKinds } from "../src/lib/game/furniture-library";
import { generateChunk } from "../src/lib/game/maze";
import { buildSection, type Section } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

function geometryHash(geometry: BufferGeometry) {
  const hash = createHash("sha256");
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    hash.update(JSON.stringify([name, attribute.itemSize, attribute.normalized]));
    hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  }
  if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
  hash.update(JSON.stringify(geometry.groups));
  return hash.digest("hex");
}
function modelState(model: FurnitureModel) {
  return {
    bounds: model.bounds.clone(), anchor: model.anchor.toArray(),
    parts: model.parts.map(({ geometry }) => ({
      geometry: geometryHash(geometry), bounds: geometry.boundingBox?.clone(),
    })),
  };
}
function disposeModel(model: FurnitureModel) {
  for (const part of model.parts) part.geometry.dispose();
}
function sectionState(section: Section) {
  const meshes: unknown[] = [];
  const resources = { geometries: {}, materials: {}, textures: {}, images: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} };
  section.group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    meshes.push({
      geometry: geometryHash(object.geometry), position: object.position.toArray(),
      rotation: object.rotation.toArray(), scale: object.scale.toArray(),
      bounds: object.geometry.boundingBox?.clone(), sphere: object.geometry.boundingSphere,
      material: materials.map((material: Material) => material.toJSON(resources)),
      castShadow: object.castShadow, receiveShadow: object.receiveShadow,
    });
  });
  const identities = new Map<string, number>();
  const canonical = JSON.stringify({
    meshes, textures: Object.values(resources.textures), images: Object.values(resources.images),
    colliders: section.colliders, shaped: section.shapedColliders,
    lights: section.lights, furniture: section.group.userData.furniture,
    computers: section.computers, portals: section.portals.map(p => p.mesh.position.toArray()),
  }, (_key, value) => {
    // Normalize allocation identities and their references, retaining texture
    // pixels, sampler state, all authored material values and sharing relations.
    if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return value;
    if (!identities.has(value)) identities.set(value, identities.size);
    return `identity-${identities.get(value)}`;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

test("finite furniture inventory preserves every prototype attribute, bounds and exact material owner", () => {
  const exhaustive: Exclude<FurnitureKind, (typeof furnitureKinds)[number]> extends never ? true : false = true;
  assert.equal(exhaustive, true);
  const mats = headlessMaterials();
  try {
    const identities = new Set<FurnitureModel>();
    let bytes = 0;
    for (const kind of furnitureKinds) {
      for (const lit of [false, true]) {
        const cached = mats.furniture.get(kind, lit), original = createFurniture(kind, mats, lit);
        try {
          assert.deepEqual(modelState(cached), modelState(original), `${kind}:${lit}`);
          cached.parts.forEach((part, i) => assert.equal(part.material, original.parts[i].material));
          assert.equal(mats.furniture.get(kind, lit), cached);
          if (!identities.has(cached)) {
            for (const { geometry } of cached.parts) {
              for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
              bytes += geometry.index?.array.byteLength ?? 0;
            }
          }
          identities.add(cached);
        } finally { disposeModel(original); }
      }
      if (kind !== "lamp") assert.equal(mats.furniture.get(kind), mats.furniture.get(kind, true));
    }
    assert.equal(identities.size, furnitureKinds.length + 1);
    assert.ok(bytes < 3_000_000, `finite prototype array budget: ${bytes}`);
    assert.throws(() => mats.furniture.get("unknown" as FurnitureKind), /Unknown furniture/);
  } finally { mats.dispose(); }
});

test("shared prototypes preserve complete section output and survive repeated section disposal", () => {
  const mats = headlessMaterials(), freshModels: FurnitureModel[] = [];
  mats.wood.userData.surfaceMeters = 1.2;
  mats.cream.userData.surfaceMeters = 2.4;
  mats.fabric.userData.surfaceMeters = 0.6;
  const libraryGet = mats.furniture.get.bind(mats.furniture);
  try {
    for (const [seed, depth] of [[48, 0], [199307, 5]]) {
      for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
        const data = generateChunk(x, z, seed, depth), before = structuredClone(data);
        // Independent original constructor is the reference. No cached model is
        // reused in this control, while final batching/collision code is identical.
        mats.furniture.get = (kind, lit) => {
          const model = createFurniture(kind, mats, lit); freshModels.push(model); return model;
        };
        const expected = buildSection(data, mats, depth);
        mats.furniture.get = libraryGet;
        const actual = buildSection(data, mats, depth);
        try {
          assert.equal(sectionState(actual), sectionState(expected), `${seed}:${depth}:${x},${z}`);
          assert.deepEqual(data, before, "construction never changes seed or chunk data");
        } finally {
          actual.dispose(); expected.dispose();
          for (const model of freshModels) disposeModel(model);
          freshModels.length = 0;
        }
      }
    }
    for (const kind of furnitureKinds) {
      const raw = createFurniture(kind, mats), cached = libraryGet(kind);
      try { assert.deepEqual(modelState(cached), modelState(raw), "section cloning never mutates prototypes"); }
      finally { disposeModel(raw); }
    }
  } finally {
    mats.furniture.get = libraryGet;
    for (const model of freshModels) disposeModel(model);
    mats.dispose();
  }
});

test("material owners never share prototypes and teardown disposes each geometry once", () => {
  const first = headlessMaterials(), second = headlessMaterials();
  let disposed = 0, materialDisposed = 0, firstDisposed = false;
  try {
    const a = first.furniture.get("officeChair"), b = second.furniture.get("officeChair");
    assert.notEqual(a, b);
    a.parts.forEach((part, i) => {
      assert.notEqual(part.geometry, b.parts[i].geometry);
      assert.notEqual(part.material, b.parts[i].material);
      part.geometry.addEventListener("dispose", () => disposed++);
    });
    a.parts[0].material.addEventListener("dispose", () => materialDisposed++);
    const section = buildSection(generateChunk(0, 0, 48), first, 0);
    section.dispose();
    assert.equal(disposed, 0, "section disposal cannot free shared prototypes");
    first.furniture.dispose(); first.furniture.dispose();
    assert.equal(disposed, a.parts.length);
    assert.equal(materialDisposed, 0, "library does not own materials");
    assert.throws(() => first.furniture.get("officeChair"), /disposed/);
    assert.equal(second.furniture.get("officeChair"), b);
    first.dispose(); firstDisposed = true;
    assert.equal(disposed, a.parts.length);
    assert.equal(materialDisposed, 1);
  } finally { if (!firstDisposed) first.dispose(); second.dispose(); }
});
