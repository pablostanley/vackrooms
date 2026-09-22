import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { EntityNavigation } from "../src/lib/game/entity-navigation";
import { E, W, generateChunk } from "../src/lib/game/maze";

const from = { x: 2.4, z: 2.4 }, to = { x: 7.2, z: 2.4 };
function fixture() {
  const data = generateChunk(0, 0, 1);
  data.cells.fill(0);
  data.cells[0] = E; data.cells[1] = W;
  const barrier = new Box3(new Vector3(4.7, 0, 0), new Vector3(4.9, 3, 4.8));
  const nav = new EntityNavigation();
  nav.addSection("0,0", data, [barrier]);
  let checks = 0;
  const original = nav.clearSegment.bind(nav);
  nav.clearSegment = (a, b) => { checks++; return original(a, b); };
  return { data, barrier, nav, checks: () => checks };
}

test("identical failed routes skip searches while exact endpoint changes retry", () => {
  const { nav, checks } = fixture();
  assert.deepEqual(nav.route(from, to), []);
  const first = checks();
  assert.ok(first > 20, "fixture performs a real unsuccessful grid search");
  for (let i = 0; i < 100; i++) assert.deepEqual(nav.route({ ...from }, { ...to }), []);
  assert.equal(checks(), first);
  assert.deepEqual(nav.route({ ...from, x: from.x + 0.001 }, to), []);
  assert.ok(checks() > first, "different start retries even within the same navigation grid cell");
  const second = checks();
  assert.deepEqual(nav.route(from, { ...to, z: to.z + 0.001 }), []);
  assert.ok(checks() > second, "different destination retries");
});

test("section add, replacement, removal, and clear invalidate failed routes", () => {
  const { nav, data, barrier, checks } = fixture();
  nav.route(from, to);
  let previous = checks();
  nav.addSection("0,0", data, [barrier]);
  nav.route(from, to); assert.ok(checks() > previous); previous = checks();
  nav.addSection("1,0", generateChunk(1, 0, 1), []);
  nav.route(from, to); assert.ok(checks() > previous); previous = checks();
  nav.removeSection("1,0");
  nav.route(from, to); assert.ok(checks() > previous); previous = checks();
  nav.clear();
  nav.route(from, to); assert.ok(checks() > previous);
  nav.addSection("0,0", data, []);
  assert.deepEqual(nav.route(from, to), [to], "removing the blocking solid makes the destination reachable immediately");
});

test("failed-route storage evicts the oldest entry after 32 endpoint pairs", () => {
  const { nav, checks } = fixture();
  const start = (i: number) => ({ x: 2 + i * 0.005, z: 2.4 });
  for (let i = 0; i < 32; i++) assert.deepEqual(nav.route(start(i), to), []);
  const populated = checks();
  nav.route(start(0), to); assert.equal(checks(), populated);
  nav.route(start(32), to);
  const afterEviction = checks();
  nav.route(start(0), to); assert.ok(checks() > afterEviction);
});

test("successful detours retain clearance and return independent path arrays", () => {
  const { nav, data } = fixture();
  nav.addSection("0,0", data, [new Box3(new Vector3(4.7, 0, 0), new Vector3(4.9, 3, 3.2))]);
  const expected = nav.route(from, to);
  assert.ok(expected.length > 1);
  for (let i = 0; i < 10; i++) {
    const route = nav.route(from, to);
    assert.deepEqual(route, expected);
    let previous = from;
    for (const point of route) { assert.ok(nav.clearSegment(previous, point)); previous = point; }
    route[0].x += 100;
  }
  assert.deepEqual(nav.route(from, to), expected);
});
