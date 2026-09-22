import assert from "node:assert/strict";
import test from "node:test";
import { updateResidentSections } from "../src/lib/game/resident-sections";

test("every intermediate streaming operation stays within nine sections across walking, diagonal seams and teleports", () => {
  const resident = new Map<string, { x: number; z: number }>();
  const physics = new Set<string>(), navigation = new Set<string>(), scene = new Set<string>();
  const creations = new Map<string, number>(), disposals = new Map<string, number>();
  for (const [cx, cz] of [[0, 0], [1, 0], [2, 1], [-1, -1], [-1, -1], [-12, 9], [0, 0]]) {
    const retained = new Map([...resident].filter(([, p]) => Math.abs(p.x - cx) <= 1 && Math.abs(p.z - cz) <= 1));
    const calls: string[] = [];
    const check = () => {
      assert.ok(resident.size <= 9);
      assert.deepEqual([...physics], [...resident.keys()]);
      assert.deepEqual([...navigation], [...resident.keys()]);
      assert.deepEqual([...scene], [...resident.keys()]);
    };
    updateResidentSections(resident, cx, cz, (key) => {
      assert.ok(!calls.includes("add"), "all retirements precede all allocations");
      calls.push("remove");
      assert.ok(!retained.has(key), "never evict player-adjacent retained geometry");
      assert.ok(resident.delete(key));
      physics.delete(key); navigation.delete(key); scene.delete(key);
      disposals.set(key, (disposals.get(key) ?? 0) + 1);
      check();
    }, (key, x, z) => {
      calls.push("add");
      assert.ok(resident.size < 9, "capacity exists before allocating section resources");
      assert.ok(!resident.has(key));
      resident.set(key, { x, z }); physics.add(key); navigation.add(key); scene.add(key);
      creations.set(key, (creations.get(key) ?? 0) + 1);
      check();
    });
    assert.equal(resident.size, 9);
    for (const [key, value] of retained) assert.equal(resident.get(key), value);
    for (const data of resident.values()) assert.ok(Math.abs(data.x - cx) <= 1 && Math.abs(data.z - cz) <= 1);
  }
  for (const [key, count] of creations)
    assert.equal(count - (disposals.get(key) ?? 0), resident.has(key) ? 1 : 0, "every retired allocation disposed exactly once");
});

test("resident insertion order matches the previous streamer's final order for seeded mutations", () => {
  const optimized = new Map<string, { x: number; z: number }>();
  const previous = new Map<string, { x: number; z: number }>();
  for (let step = 0; step < 60; step++) {
    const cx = Math.floor(step / 4) - 8, cz = step % 3 - 1;
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++)
        if (!previous.has(`${x},${z}`)) previous.set(`${x},${z}`, { x, z });
    for (const [key, data] of previous)
      if (Math.abs(data.x - cx) > 1 || Math.abs(data.z - cz) > 1) previous.delete(key);
    updateResidentSections(optimized, cx, cz, (key) => { optimized.delete(key); }, (key, x, z) => { optimized.set(key, { x, z }); });
    assert.deepEqual([...optimized], [...previous]);
  }
});
