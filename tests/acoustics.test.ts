import assert from "node:assert/strict";
import test from "node:test";
import {
  BuildingSoundSchedule,
  hardFloorAt,
  footstepSurfaceAt,
  POOL_WATER_Y,
  ROOM_SOUNDS,
  roomSoundAt,
  transmission,
  wallsBetween,
} from "../src/lib/game/acoustics";
import {
  CELL,
  CHUNK,
  SPAN,
  E,
  W,
  N,
  S,
  canStand,
  generateChunk,
  poolBounds,
  type ChunkData,
} from "../src/lib/game/maze";

const point = (x: number, z: number, y = 1.66) => ({
  x: x * CELL,
  y,
  z: z * CELL,
});
function openChunk(x = 0, z = 0): ChunkData {
  const chunk = generateChunk(x, z, 1);
  chunk.cells.fill(15);
  chunk.theme = "offices";
  chunk.landmark = {
    kind: "lobby",
    x: 8,
    z: 8,
    width: 3,
    length: 3,
    height: 8.4,
  };
  return chunk;
}

test("wall transmission distinguishes open gates, partitions, and multiple walls", () => {
  const chunk = openChunk(),
    chunks = new Map([["0,0", chunk]]);
  const a = point(0.5, 1.5),
    b = point(3.5, 1.5);
  assert.equal(wallsBetween(chunks, a, b), 0);
  for (let x = 0; x < 3; x++) {
    chunk.cells[CHUNK + x] &= ~E;
    chunk.cells[CHUNK + x + 1] &= ~W;
    assert.equal(wallsBetween(chunks, a, b), x + 1);
    assert.equal(wallsBetween(chunks, b, a), x + 1);
  }
  const clear = transmission(0, 12),
    blocked = transmission(1, 12),
    distant = transmission(2, 20);
  assert.ok(clear.gain > blocked.gain && blocked.gain > distant.gain);
  assert.ok(clear.cutoff > blocked.cutoff && blocked.cutoff > distant.cutoff);
  assert.ok(blocked.cutoff < 1000);
});

test("negative section seams use both gates and unloaded sections are inaudible", () => {
  const left = openChunk(-1),
    right = openChunk();
  const chunks = new Map([
    ["-1,0", left],
    ["0,0", right],
  ]);
  const a = point(-0.5, 1.5),
    b = point(0.5, 1.5);
  assert.equal(wallsBetween(chunks, a, b), 0);
  right.cells[CHUNK] &= ~W;
  assert.equal(wallsBetween(chunks, a, b), 1);
  assert.equal(wallsBetween(chunks, b, a), 1);
  chunks.delete("-1,0");
  assert.equal(wallsBetween(chunks, a, b), 3);
});

test("tracing handles axis-aligned and diagonal rays without missing thin walls", () => {
  const chunk = openChunk(),
    chunks = new Map([["0,0", chunk]]);
  const a = point(1.2, 1.7);
  chunk.cells[2 * CHUNK + 1] &= ~S;
  chunk.cells[3 * CHUNK + 1] &= ~N;
  assert.equal(wallsBetween(chunks, a, point(1.2, 4.5)), 1);
  assert.equal(wallsBetween(chunks, point(1.2, 4.5), a), 1);
  assert.equal(wallsBetween(chunks, a, a), 0);
  assert.equal(wallsBetween(chunks, point(1.5, 1.5), point(4.5, 4.5)), 0);
  for (const x of [1.1, 1.5, 2.7, 6.5])
    for (const z of [1.2, 1.5, 4.1, 6.5]) {
      const b = point(x, z);
      assert.equal(wallsBetween(chunks, a, b), wallsBetween(chunks, b, a));
    }
});

test("corner transmission is reciprocal across every pair of seeded room centers", () => {
  const chunks = new Map([["0,0", generateChunk(0, 0, 199307)]]);
  for (let a = 0; a < CHUNK * CHUNK; a++)
    for (let b = a + 1; b < CHUNK * CHUNK; b++) {
      const from = point((a % CHUNK) + 0.5, Math.floor(a / CHUNK) + 0.5);
      const to = point((b % CHUNK) + 0.5, Math.floor(b / CHUNK) + 0.5);
      assert.equal(
        wallsBetween(chunks, from, to),
        wallsBetween(chunks, to, from),
      );
    }
});

test("room echoes follow footprint and ceilings, not the entire section theme", () => {
  const chunk = openChunk(),
    chunks = new Map([["0,0", chunk]]);
  chunk.landmark.kind = "poolroom";
  assert.equal(roomSoundAt(chunks, point(1.5, 1.5)), "office");
  assert.equal(roomSoundAt(chunks, point(9.5, 9.5)), "pool");
  assert.equal(hardFloorAt(chunks, point(9.5, 9.5)), true);
  chunk.theme = "service";
  assert.equal(roomSoundAt(chunks, point(1.5, 1.5)), "office");
  assert.equal(hardFloorAt(chunks, point(1.5, 1.5)), false);
  for (const kind of ["lobby", "corridor", "foodCourt"] as const) {
    chunk.landmark.kind = kind;
    assert.equal(hardFloorAt(chunks, point(9.5, 9.5)), kind === "foodCourt");
  }
  assert.ok(ROOM_SOUNDS.pool.decay > ROOM_SOUNDS.hall.decay);
  assert.ok(ROOM_SOUNDS.hall.decay > ROOM_SOUNDS.office.decay);
  assert.ok(ROOM_SOUNDS.pool.wet > ROOM_SOUNDS.office.wet);
  const office = point(7.5, 9.5),
    tallLight = point(8.5, 9.5, 8.2);
  assert.equal(wallsBetween(chunks, office, point(8.5, 9.5)), 0);
  assert.equal(wallsBetween(chunks, office, tallLight), 1);
});

test("water footsteps require submerged feet inside the basin, including negative sections", () => {
  for (const [cx, cz] of [[0, 0], [-1, -2]]) {
    const chunk = { ...generateChunk(0, 0, 2), x: cx, z: cz };
    const chunks = new Map([[`${cx},${cz}`, chunk]]);
    const basin = poolBounds(chunk.landmark)!;
    assert.ok(basin);
    const x = cx * SPAN + basin.x,
      z = cz * SPAN + basin.z;
    const center = { x: x + basin.width / 2, y: -1.4, z: z + basin.length / 2 };
    assert.equal(footstepSurfaceAt(chunks, center), "water");
    assert.equal(footstepSurfaceAt(chunks, { ...center, y: POOL_WATER_Y }), "water");
    assert.equal(footstepSurfaceAt(chunks, { ...center, y: 0.44 }), "hard");
    for (const edge of [
      { ...center, x: x + 0.1 },
      { ...center, x: x + basin.width - 0.1 },
      { ...center, z: z + 0.1 },
      { ...center, z: z + basin.length - 0.1 },
    ]) {
      assert.equal(footstepSurfaceAt(chunks, edge), "hard", "coping stays dry");
    }
    assert.equal(footstepSurfaceAt(chunks, { ...center, x: x - 1, y: 0 }), "hard");
    assert.equal(footstepSurfaceAt(chunks, { x: cx * SPAN + 1, y: 0, z: cz * SPAN + 1 }), "carpet");
    chunks.clear();
    assert.equal(footstepSurfaceAt(chunks, center), "carpet");
  }
});

test("dry footsteps follow actual flooring across landmark and theme changes", () => {
  const chunk = openChunk(), chunks = new Map([["0,0", chunk]]);
  for (const theme of ["offices", "service", "archive", "pool"] as const) {
    chunk.theme = theme;
    assert.equal(footstepSurfaceAt(chunks, point(1.5, 1.5, 0)), "carpet");
    for (const kind of ["lobby", "corridor", "foodCourt", "poolroom"] as const) {
      chunk.landmark.kind = kind;
      assert.equal(
        footstepSurfaceAt(chunks, point(9.5, 9.5, 0)),
        kind === "foodCourt" || kind === "poolroom" ? "hard" : "carpet",
      );
    }
  }
});

test("building events are seeded, sparse, occluded, and stay on resident walkable routes", () => {
  const chunks = new Map<string, ChunkData>();
  for (let z = -1; z <= 1; z++)
    for (let x = -1; x <= 1; x++)
      chunks.set(`${x},${z}`, generateChunk(x, z, 199307));
  const reversed = new Map([...chunks].reverse());
  const a = new BuildingSoundSchedule(199307),
    b = new BuildingSoundSchedule(199307);
  const listener = point(2.5, 4.5);
  let last = 0,
    events = 0,
    steps = 0;
  for (let t = 0; t <= 1800; t += 0.25) {
    const event = a.poll(t, chunks, listener);
    assert.deepEqual(event, b.poll(t, reversed, listener));
    if (!event) continue;
    assert.ok(t >= 40 && t - last >= 52);
    last = t;
    events++;
    const origin = event.positions[0];
    const walls = wallsBetween(chunks, listener, origin);
    assert.ok(walls === 1 || walls === 2);
    assert.ok(Math.hypot(origin.x - listener.x, origin.z - listener.z) >= 9);
    for (const position of event.positions) {
      assert.equal(canStand(chunks, position.x, position.z, 0.25), true);
      assert.equal(wallsBetween(chunks, origin, position), 0);
    }
    if (event.kind === "steps") {
      steps++;
      assert.ok(event.positions.length >= 3 && event.positions.length <= 5);
    }
  }
  assert.ok(events >= 8 && events <= 30, `unexpected event count: ${events}`);
  assert.ok(steps > 0);
  const empty = new BuildingSoundSchedule(1);
  assert.equal(empty.poll(200, new Map(), listener), null);
  a.defer(1800);
  assert.equal(a.poll(1851, chunks, listener), null);
  assert.ok(SPAN > 24);
});
