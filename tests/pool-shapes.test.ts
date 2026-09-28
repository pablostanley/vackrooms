import assert from "node:assert/strict";
import test from "node:test";
import { Mesh, Vector3 } from "three";
import { CELL, SPAN, canStand, generateChunk, poolBounds, type ChunkData } from "../src/lib/game/maze";
import {
  crossings,
  deckRects,
  distanceToOutline,
  pointInPolygon,
  signedArea,
} from "../src/lib/game/pool-shape";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { footstepSurfaceAt } from "../src/lib/game/acoustics";
import { headlessMaterials } from "./helpers/materials";

function* shapedPools(seeds = [0, 2, 7, 48, 199307]) {
  for (const seed of seeds)
    for (let z = -9; z <= 9; z++)
      for (let x = -9; x <= 9; x++) {
        const data = generateChunk(x, z, seed, 0, 2);
        if (data.landmark.basin) yield Object.assign(data, { tape: seed });
      }
}
const find = (match: (data: ChunkData) => boolean) => {
  for (const data of shapedPools()) if (match(data)) return data;
  throw new Error("no fixture");
};

test("v2 pools vary in outline and size, stay depth-stable, and leave legacy rooms alone", () => {
  const shapes = new Set<string>(), sizes = new Set<string>();
  let bridges = 0, piers = 0, trampolines = 0, total = 0;
  for (const data of shapedPools()) {
    const { landmark } = data, design = landmark.basin!;
    total++;
    shapes.add(design.shape);
    sizes.add(`${design.width}x${design.length}`);
    if (design.bridge?.pier) piers++;
    else if (design.bridge) bridges++;
    if (design.trampoline) trampolines++;
    assert.equal(landmark.kind, "poolroom");
    assert.equal(landmark.pool, undefined, "colonnades keep the classic basin");
    assert.ok(data.x !== 0 || data.z !== 0, "the opening pool stays familiar");
    assert.deepEqual(generateChunk(data.x, data.z, data.tape, 22, 2).landmark.basin, design);
    assert.equal(generateChunk(data.x, data.z, data.tape, 0, 1).landmark.basin, undefined);
    assert.ok(signedArea(design.outline) > 0);
    for (const [x, z] of design.outline) {
      assert.ok(x >= -1e-9 && x <= design.width + 1e-9 && z >= -1e-9 && z <= design.length + 1e-9);
    }
    // At least five meters of dry deck to every hall wall.
    const bounds = poolBounds(landmark)!;
    assert.ok(bounds.x - landmark.x * CELL >= 5.1);
    assert.ok(bounds.z - landmark.z * CELL >= 5.4);
    assert.ok((landmark.x + landmark.width) * CELL - bounds.x - bounds.width >= 5.1);
    assert.ok((landmark.z + landmark.length) * CELL - bounds.z - bounds.length >= 5.4);
  }
  assert.equal(shapes.size, 8, [...shapes].join());
  assert.ok(sizes.size > total * 0.6, `${sizes.size} sizes over ${total} pools`);
  for (const [name, count] of [["bridges", bridges], ["piers", piers], ["trampolines", trampolines]] as const)
    assert.ok(count / total > 0.1 && count / total < 0.5, `${name}: ${count}/${total}`);
});

test("bridges land on dry deck, piers stop over open water, and trampolines stay dry", () => {
  for (const data of shapedPools()) {
    const design = data.landmark.basin!;
    const { bridge, trampoline, outline } = design;
    if (bridge) {
      assert.ok(!pointInPolygon(outline, bridge.x0, bridge.z) || !pointInPolygon(outline, bridge.x1, bridge.z));
      const xs = crossings(outline, bridge.z);
      assert.equal(xs.length, 2);
      if (bridge.pier) {
        const tip = pointInPolygon(outline, bridge.x0, bridge.z) ? bridge.x0 : bridge.x1;
        assert.ok(pointInPolygon(outline, tip, bridge.z), "the pier ends over water");
        assert.ok(distanceToOutline(outline, tip, bridge.z) > 1, "with room to jump in");
      } else {
        assert.ok(!pointInPolygon(outline, bridge.x0, bridge.z) && !pointInPolygon(outline, bridge.x1, bridge.z));
        assert.ok(bridge.x0 < xs[0] - 0.5 && bridge.x1 > xs[1] + 0.5);
      }
    }
    if (trampoline) {
      assert.ok(!pointInPolygon(outline, trampoline.x, trampoline.z));
      assert.ok(distanceToOutline(outline, trampoline.x, trampoline.z) > 1.4);
    }
    // Dry deck rectangles never cover the water.
    for (const rect of deckRects(design))
      assert.ok(!pointInPolygon(outline, rect.x + rect.width / 2, rect.z + rect.length / 2) ||
        distanceToOutline(outline, rect.x + rect.width / 2, rect.z + rect.length / 2) < 0.2 + Math.max(rect.width, rect.length));
  }
});

test("a shaped section clips its water to the outline and releases every geometry", () => {
  const data = find((d) => d.landmark.basin!.shape === "kidney" && !!d.landmark.basin!.trampoline);
  const errors: unknown[] = [], error = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  const mats = headlessMaterials();
  let section;
  try { section = buildSection(data, mats, 0); } finally { console.error = error; }
  assert.deepEqual(errors, [], "every material batch merges");
  try {
    const design = data.landmark.basin!, bounds = poolBounds(data.landmark)!;
    assert.equal(section.water.length, 1);
    const water = section.water[0], positions = water.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) + water.position.x - data.x * SPAN - bounds.x;
      const z = positions.getZ(i) + water.position.z - data.z * SPAN - bounds.z;
      assert.ok(pointInPolygon(design.outline, x, z) || distanceToOutline(design.outline, x, z) < 1e-3);
    }
    assert.ok((water.geometry.index?.count ?? 0) > 3000);
    let disposed = 0, meshes = 0;
    section.group.traverse((object) => {
      if (object instanceof Mesh) { meshes++; object.geometry.addEventListener("dispose", () => disposed++); }
    });
    section.dispose();
    assert.equal(disposed, meshes);
  } finally { mats.dispose(); }
});

async function walk(
  data: ChunkData,
  from: [number, number],
  to: [number, number],
  check?: (position: Vector3, motor: CharacterMotor) => void,
) {
  const mats = headlessMaterials(), section = buildSection(data, mats, 0), position = new Vector3();
  const key = `${data.x},${data.z}`;
  const motor = await CharacterMotor.create({ x: from[0], z: from[1] });
  try {
    motor.addSection(key, data, section.colliders, section.shapedColliders);
    for (let i = 0; i < 30; i++) motor.move(0, 0, 1 / 60, position);
    for (let i = 0; i < 1500 && Math.hypot(to[0] - position.x, to[1] - position.z) > 0.08; i++) {
      const distance = Math.hypot(to[0] - position.x, to[1] - position.z);
      motor.move((to[0] - position.x) / distance * 0.06, (to[1] - position.z) / distance * 0.06, 1 / 60, position);
      check?.(position, motor);
    }
    return { position, reached: Math.hypot(to[0] - position.x, to[1] - position.z) < 0.1, motor };
  } finally { motor.dispose(); section.dispose(); mats.dispose(); }
}

test("Rapier carries the player over a full bridge at coping height", async () => {
  const data = find((d) => !!d.landmark.basin!.bridge && !d.landmark.basin!.bridge.pier);
  const bounds = poolBounds(data.landmark)!, bridge = data.landmark.basin!.bridge!;
  const ox = data.x * SPAN + bounds.x, oz = data.z * SPAN + bounds.z;
  let lowest = Infinity, highest = -Infinity;
  const { reached } = await walk(
    data,
    [ox + bridge.x0 - 1.2, oz + bridge.z],
    [ox + bridge.x1 + 1.2, oz + bridge.z],
    (position) => { lowest = Math.min(lowest, position.y); highest = Math.max(highest, position.y); },
  );
  assert.ok(reached, "the far landing is reached");
  assert.ok(lowest > 1.5, `never dropped into the water: ${lowest}`);
  assert.ok(Math.abs(highest - (0.44 + 1.66)) < 0.05, `walked on the deck: ${highest}`);
});

test("stepping onto a trampoline bounces the player well above the deck", async () => {
  const data = find((d) => !!d.landmark.basin!.trampoline);
  const bounds = poolBounds(data.landmark)!, { x, z } = data.landmark.basin!.trampoline!;
  const tx = data.x * SPAN + bounds.x + x, tz = data.z * SPAN + bounds.z + z;
  // Approach from whichever side is walkable deck.
  const chunks = new Map([[`${data.x},${data.z}`, data]]);
  const start = [[-2.4, 0], [2.4, 0], [0, -2.4], [0, 2.4]]
    .map(([dx, dz]) => [tx + dx, tz + dz] as [number, number])
    .find(([sx, sz]) => canStand(chunks, sx, sz))!;
  let peak = -Infinity;
  await walk(data, start, [tx, tz], (position) => { peak = Math.max(peak, position.y); });
  assert.ok(peak > 1.66 + 1.2, `bounce apex ${peak}`);
});

test("the dry notch inside an L-shaped basin is solid deck", async () => {
  const data = find((d) => d.landmark.basin!.shape === "trueL");
  const design = data.landmark.basin!, bounds = poolBounds(data.landmark)!;
  const rect = deckRects(design).sort((a, b) => b.width * b.length - a.width * a.length)[0];
  const cx = rect.x + rect.width / 2, cz = rect.z + rect.length / 2;
  assert.ok(!pointInPolygon(design.outline, cx, cz));
  const ox = data.x * SPAN + bounds.x, oz = data.z * SPAN + bounds.z;
  const chunks = new Map([[`${data.x},${data.z}`, data]]);
  const { position } = await walk(data, [ox + cx, oz + cz], [ox + cx, oz + cz]);
  assert.ok(Math.abs(position.y - 1.66) < 0.05, `stands on the notch deck: ${position.y}`);
  assert.equal(footstepSurfaceAt(chunks, { x: position.x, y: position.y - 1.66, z: position.z }), "hard");
  // And the water beside it is still a swimmable, splashing basin.
  const [wx, wz] = design.outline.reduce(([sx, sz], [px, pz]) => [sx + px / design.outline.length, sz + pz / design.outline.length], [0, 0]);
  const inWater = pointInPolygon(design.outline, wx, wz) ? [wx, wz] : [design.width * 0.25, design.length * 0.75];
  assert.equal(footstepSurfaceAt(chunks, { x: ox + inWater[0], y: -1.4, z: oz + inWater[1] }), "water");
});
