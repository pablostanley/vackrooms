import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as THREE from "three";
import { generateChunk } from "../src/lib/game/maze";
import { createRoomAmbientPool, planRoomLighting } from "../src/lib/game/room-lighting";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

const fixture = (seed: number) => {
  const data = generateChunk(seed % 3 - 1, seed % 5 - 2, seed, seed % 4);
  return { data, plan: planRoomLighting(data) };
};
const { data, plan } = fixture(1);
const bright = { ...plan, cells: new Set<number>(), fixtures: new Set<number>(), lampCell: null };

test("pooled refills preserve original ambient pixels and sampling across outage modes", () => {
  // SHA-256 of the complete RGBA image from the unchanged 2fd26ee baker.
  const originals = [
    [1, "302734f80ce1a77a8cd14efa6e7d989b1ac5803933df5cd125144c41d22ad56e"],
    [4, "c6bd906a9e76b0a9c8775d5ba530776f3e62dcadc7d045139627d7e42f09f31e"],
    [9, "fbed83b606cd684b57e040c260070f1c235057ddc0cd4a77ee33e0bc8dd19e29"],
  ] as const;
  const pool = createRoomAmbientPool();
  const initial = pool.acquire(data, plan);
  const storage = initial.texture.image.data;
  assert.ok(storage instanceof Uint8Array);
  const identity = initial.texture;
  let version = identity.version;
  initial.release();
  for (const [seed, hash] of [...originals, ...originals.toReversed()]) {
    const f = fixture(seed);
    const lease = pool.acquire(f.data, f.plan);
    assert.equal(lease.texture, identity);
    assert.equal(lease.texture.image.data, storage);
    assert.equal(createHash("sha256").update(storage).digest("hex"), hash);
    assert.ok(lease.texture.version > version);
    version = lease.texture.version;
    assert.equal(lease.texture.channel, 1);
    assert.equal(lease.texture.magFilter, THREE.LinearFilter);
    assert.equal(lease.texture.minFilter, THREE.LinearFilter);
    lease.release();
  }
  const reset = pool.acquire(data, bright);
  assert.ok(reset.texture.image.data instanceof Uint8Array);
  assert.ok(reset.texture.image.data.every((value) => value === 255));
  reset.release();
  pool.dispose();
});

test("nine-section eviction-first windows reuse nine identities for 120 cycles", () => {
  const pool = createRoomAmbientPool();
  const identities = new Set<THREE.DataTexture>();
  let previous: ReturnType<typeof pool.acquire>[] = [];
  for (let cycle = 0; cycle < 120; cycle++) {
    previous.forEach((lease) => lease.release());
    previous = Array.from({ length: 9 }, () => pool.acquire(data, bright));
    assert.equal(new Set(previous.map((lease) => lease.texture)).size, 9);
    previous.forEach((lease) => identities.add(lease.texture));
  }
  assert.equal(identities.size, 9);
  previous.forEach((lease) => lease.release());
  pool.dispose();
});

test("legacy overlapping windows cap at eighteen without evicting live leases", () => {
  const pool = createRoomAmbientPool();
  const leases = Array.from({ length: 18 }, () => pool.acquire(data, bright));
  assert.equal(new Set(leases.map((lease) => lease.texture)).size, 18);
  assert.throws(() => pool.acquire(data, bright), /eighteen simultaneous/);
  leases[0].release();
  const replacement = pool.acquire(data, plan);
  assert.equal(replacement.texture, leases[0].texture);
  leases[0].release(); // A stale lease cannot release its new occupant.
  assert.throws(() => pool.acquire(data, bright), /eighteen simultaneous/);
  replacement.release();
  leases.forEach((lease) => lease.release());
  pool.dispose();
});

test("owners remain independent and retire each texture only once at final disposal", () => {
  const a = createRoomAmbientPool(), b = createRoomAmbientPool();
  const first = a.acquire(data, plan), second = b.acquire(data, plan);
  assert.notEqual(first.texture, second.texture);
  assert.notEqual(first.texture.image.data, second.texture.image.data);
  let disposed = 0;
  first.texture.addEventListener("dispose", () => disposed++);
  first.release();
  assert.equal(disposed, 0);
  a.dispose(); a.dispose(); first.release();
  assert.equal(disposed, 1);
  assert.throws(() => a.acquire(data, plan), /disposed/);
  const third = b.acquire(data, bright);
  assert.notEqual(third.texture, second.texture);
  second.release(); third.release(); b.dispose();
});

test("section retirement releases its lease only after mesh and material disposal", () => {
  const mats = headlessMaterials();
  const section = buildSection(data, mats, 1);
  const maps = new Set<THREE.Texture>();
  const events: string[] = [];
  section.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.addEventListener("dispose", () => events.push("mesh"));
    const material = object.material as THREE.MeshStandardMaterial;
    if (!material.aoMap) return;
    maps.add(material.aoMap);
    material.addEventListener("dispose", () => events.push("material"));
  });
  assert.equal(maps.size, 1);
  const acquire = mats.ambientMaps.acquire;
  // Fill remaining capacity so retirement callbacks could not acquire this slot.
  const held = Array.from({ length: 17 }, () => acquire(data, bright));
  section.group.traverse((object) => {
    if (object instanceof THREE.Mesh)
      object.addEventListener("dispose", () => assert.throws(() => acquire(data, bright), /eighteen/));
  });
  let textureDisposals = 0;
  maps.forEach((map) => map.addEventListener("dispose", () => textureDisposals++));
  section.dispose();
  assert.ok(events.includes("mesh") && events.includes("material"));
  assert.equal(textureDisposals, 0);
  const next = acquire(data, bright);
  assert.ok(maps.has(next.texture));
  next.release(); held.forEach((lease) => lease.release()); mats.dispose();
  assert.equal(textureDisposals, 1);
});
