import assert from "node:assert/strict";
import test from "node:test";
import {
  CELL,
  CHUNK,
  HEIGHT,
  SPAN,
  N,
  E,
  S,
  W,
  canStand,
  ceilingAt,
  directions,
  generateChunk,
  inLandmark,
} from "../src/lib/game/maze";
import { cutClearance, stairBlocks } from "../src/lib/game/room-shapes";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { Vector3 } from "three";
import { headlessMaterials } from "./helpers/materials";

const samples = () => {
  const out: ReturnType<typeof generateChunk>[] = [];
  for (const seed of [0, 48, 199307])
    for (let x = -4; x <= 4; x++)
      for (let z = -3; z <= 3; z++) out.push(generateChunk(x, z, seed, 0, 2));
  return out;
};

test("generation 1 never gains shape data", () => {
  for (const [x, z] of [[0, 0], [3, 1], [-2, 4]]) {
    const data = generateChunk(x, z, 48, 0, 1);
    assert.equal(data.ceilings, undefined);
    assert.equal(data.cuts, undefined);
    assert.equal(data.stairs, undefined);
    assert.equal(ceilingAt(data, 5, 5), inLandmark(data.landmark, 5, 5) ? data.landmark.height : HEIGHT);
  }
});

test("generation 2 varies ceilings, corners, and stairs deterministically", () => {
  const heights = new Set<number>();
  let low = 0, tall = 0, shafts = 0, cuts = 0, skewed = 0, stairs = 0;
  for (const data of samples()) {
    assert.deepEqual(generateChunk(data.x, data.z, 48, 0, 2).cells.length, CHUNK * CHUNK);
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const h = data.ceilings![i];
      heights.add(h);
      if (h < 2.8) low++;
      else if (h > 4) tall++;
      if (h > 10) shafts++;
      // Low ceilings still clear the tallest player posture.
      assert.ok(h >= 2.45);
    }
    // Section borders stay standard so both sides build matching walls.
    for (let i = 0; i < CHUNK; i++)
      for (const at of [i, (CHUNK - 1) * CHUNK + i, i * CHUNK, i * CHUNK + CHUNK - 1])
        assert.equal(data.ceilings![at], HEIGHT);
    cuts += data.cuts!.length;
    skewed += data.cuts!.filter((cut) => Math.max(cut.a, cut.b) / Math.min(cut.a, cut.b) > 2).length;
    stairs += data.stairs!.length;
  }
  assert.ok(heights.size > 40, `distinct heights: ${heights.size}`);
  assert.ok(low > 100 && tall > 100 && shafts > 10, `${low} low, ${tall} tall, ${shafts} shafts`);
  assert.ok(cuts > 500 && skewed > 50, `${cuts} cuts, ${skewed} skewed`);
  assert.ok(stairs > 40, `${stairs} stairs`);
  const again = generateChunk(2, -1, 48, 0, 2);
  assert.deepEqual(again, generateChunk(2, -1, 48, 0, 2));
});

test("angled corners and stairs keep every passage walkable", () => {
  for (const data of samples()) {
    const chunks = new Map([[`${data.x},${data.z}`, data]]);
    const ox = data.x * SPAN, oz = data.z * SPAN;
    for (const cut of data.cuts!) {
      const bits = data.cells[cut.cell];
      const cx = cut.cell % CHUNK, cz = Math.floor(cut.cell / CHUNK);
      assert.ok(!inLandmark(data.landmark, cx, cz));
      // Both walls the cut joins are closed; the cut only seals a dead corner.
      const closed = [[N, W], [N, E], [S, E], [S, W]][cut.corner];
      assert.ok(!(bits & closed[0]) && !(bits & closed[1]));
      assert.ok(cutClearance(cut, CELL / 2, CELL / 2) > 0.9);
      const probes: [number, number][] = [[CELL / 2, CELL / 2]];
      if (bits & N) probes.push([CELL / 2, 0.4]);
      if (bits & S) probes.push([CELL / 2, CELL - 0.4]);
      if (bits & W) probes.push([0.4, CELL / 2]);
      if (bits & E) probes.push([CELL - 0.4, CELL / 2]);
      for (const [lx, lz] of probes)
        assert.ok(canStand(chunks, ox + cx * CELL + lx, oz + cz * CELL + lz), `cut ${cut.cell} blocks ${lx},${lz}`);
    }
    for (const run of data.stairs!) {
      assert.ok(!data.cuts!.some((cut) => cut.cell === run.cell));
      assert.ok(!(data.cells[run.cell] & run.wall), "stairs back onto a closed wall");
      const cx = run.cell % CHUNK, cz = Math.floor(run.cell / CHUNK);
      // The sealed door above the landing fits under the ceiling.
      assert.ok(ceilingAt(data, cx, cz) > run.rise + 2.2);
      for (const [x0, z0, x1, z1] of stairBlocks(run)) {
        assert.ok(x0 >= 0 && z0 >= 0 && x1 <= CELL && z1 <= CELL);
        // The cell center and every doorway lane stay free.
        const c = CELL / 2;
        const overlaps = (a0: number, b0: number, a1: number, b1: number) =>
          x1 > a0 && x0 < a1 && z1 > b0 && z0 < b1;
        assert.ok(!overlaps(c - 0.9, c - 0.9, c + 0.9, c + 0.9));
      }
      const steps = stairBlocks(run).map((block) => block[4]);
      for (let i = 1; i < steps.length; i++) assert.ok(steps[i] - steps[i - 1] <= 0.2 + 1e-9);
    }
  }
});

test("irregular rooms only open walls: every cell stays reachable", () => {
  for (const data of samples()) {
    const queue = [0], seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      for (const d of directions) {
        const cx = (cell % CHUNK) + d.dx, cz = Math.floor(cell / CHUNK) + d.dz;
        if (cx < 0 || cz < 0 || cx >= CHUNK || cz >= CHUNK || !(data.cells[cell] & d.bit)) continue;
        const next = cz * CHUNK + cx;
        assert.ok(data.cells[next] & d.opposite);
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    assert.equal(seen.size, CHUNK * CHUNK);
  }
});

test("shaped sections build with solid angled walls and stairs", () => {
  const mats = headlessMaterials();
  try {
    let built = 0;
    for (const data of samples().filter((d) => d.stairs!.length && d.cuts!.length).slice(0, 12)) {
      const section = buildSection(data, mats, 0);
      const hulls = section.shapedColliders.filter((obstacle) => !obstacle.movable && obstacle.parts[0].length === 18);
      assert.ok(hulls.length >= data.cuts!.length);
      // No loose furniture sits inside an angled or stair cell.
      for (const prop of section.group.userData.furniture as { bounds: { min: { x: number; z: number }; max: { x: number; z: number } } }[]) {
        const cx = Math.floor(((prop.bounds.min.x + prop.bounds.max.x) / 2) / CELL);
        const cz = Math.floor(((prop.bounds.min.z + prop.bounds.max.z) / 2) / CELL);
        if (cx < 0 || cz < 0 || cx >= CHUNK || cz >= CHUNK) continue;
        assert.ok(!data.stairs!.some((run) => run.cell === cz * CHUNK + cx));
      }
      section.dispose();
      built++;
    }
    assert.ok(built >= 6);
  } finally {
    mats.dispose();
  }
});

test("inflatable play areas stay connected, clear, and bouncy", () => {
  const mats = headlessMaterials();
  try {
    let rooms = 0;
    for (const data of samples()) {
      const room = data.playroom;
      if (!room) continue;
      rooms++;
      assert.ok(room.cells.length >= 3);
      const cells = new Set(room.cells);
      for (const cell of room.cells) {
        const cx = cell % CHUNK, cz = Math.floor(cell / CHUNK);
        assert.ok(!inLandmark(data.landmark, cx, cz));
        assert.ok(ceilingAt(data, cx, cz) >= 4.8);
        assert.ok(!data.cuts!.some((cut) => cut.cell === cell));
        assert.ok(!data.stairs!.some((run) => run.cell === cell));
        // Every play cell joins another through an open wall.
        assert.ok(directions.some(({ bit, dx, dz }) =>
          data.cells[cell] & bit && cells.has((cz + dz) * CHUNK + cx + dx)));
      }
      if (rooms > 8) continue;
      const section = buildSection(data, mats, 0);
      const balls = section.shapedColliders.filter((obstacle) => obstacle.movable?.material === "plastic" &&
        obstacle.movable.mass === 2.5);
      assert.ok(balls.length >= 1);
      const ox = data.x * SPAN, oz = data.z * SPAN;
      for (const cell of room.cells) {
        const cx = cell % CHUNK, cz = Math.floor(cell / CHUNK), bits = data.cells[cell];
        const x = ox + (cx + 0.5) * CELL, z = oz + (cz + 0.5) * CELL;
        const lanes: [number, number, number, number][] = [[x - 0.7, z - 0.7, x + 0.7, z + 0.7]];
        if (bits & N) lanes.push([x - 0.7, z - CELL / 2, x + 0.7, z]);
        if (bits & S) lanes.push([x - 0.7, z, x + 0.7, z + CELL / 2]);
        if (bits & W) lanes.push([x - CELL / 2, z - 0.7, x, z + 0.7]);
        if (bits & E) lanes.push([x, z - 0.7, x + CELL / 2, z + 0.7]);
        for (const box of section.colliders) {
          if (balls.some((ball) => ball.bounds === box) || box.min.y > 1.85) continue;
          for (const [x0, z0, x1, z1] of lanes)
            assert.ok(!(box.max.x > x0 && box.min.x < x1 && box.max.z > z0 && box.min.z < z1),
              `play cell ${cell} lane blocked`);
        }
      }
      section.dispose();
    }
    assert.ok(rooms >= 20, `${rooms} play areas`);
  } finally {
    mats.dispose();
  }
});

test("play floors bounce higher than office carpet", async () => {
  const peak = async (bouncy: boolean) => {
    const data = generateChunk(0, 0, 1, 0, 2);
    data.cells.fill(15);
    data.landmark = { kind: "lobby", x: 0, z: 0, width: 1, length: 1, height: HEIGHT };
    data.ceilings = new Float64Array(CHUNK * CHUNK).fill(8);
    data.playroom = bouncy ? { cells: [5 * CHUNK + 5, 5 * CHUNK + 6], palette: 0 } : undefined;
    const position = new Vector3(5.5 * CELL, 1.66, 5.5 * CELL);
    const motor = await CharacterMotor.create(position);
    try {
      motor.addSection("0,0", data, []);
      for (let i = 0; i < 5; i++) motor.move(0, 0, 1 / 60, position);
      const floor = position.y;
      motor.jump();
      let top = floor;
      for (let i = 0; i < 120; i++) {
        motor.move(0, 0, 1 / 60, position);
        top = Math.max(top, position.y);
      }
      return top - floor;
    } finally {
      motor.dispose();
    }
  };
  const office = await peak(false),
    play = await peak(true);
  assert.ok(office > 0.8 && office < 0.95, `office ${office}`);
  assert.ok(play > 2, `play ${play}`);
});
