import assert from "node:assert/strict";
import test from "node:test";
import { soundPath } from "../src/lib/game/sound-path";
import { CELL, CHUNK, E, S, W, N, generateChunk, type ChunkData } from "../src/lib/game/maze";
import { transmission, wallsBetween } from "../src/lib/game/acoustics";

const point = (x: number, z: number) => ({ x: (x + 0.5) * CELL, y: 1.66, z: (z + 0.5) * CELL });
function route() {
  const chunk = generateChunk(0, 0, 1);
  chunk.cells.fill(0);
  // U-shaped open route around a partition: (1,1) -> (1,2) -> (2,2) -> (2,1).
  chunk.cells[CHUNK + 1] = S;
  chunk.cells[2 * CHUNK + 1] = N | E;
  chunk.cells[2 * CHUNK + 2] = W | N;
  chunk.cells[CHUNK + 2] = S;
  return new Map([["0,0", chunk]]);
}

test("a nearby open doorway reveals a muffled source from the opening", () => {
  const chunks = route(), from = point(1, 1), to = point(2, 1);
  const sound = soundPath(chunks, from, to);
  const destination = point(2, 2);
  const corner = soundPath(chunks, from, destination);
  assert.ok(corner.gain > transmission(wallsBetween(chunks, from, destination), CELL * Math.SQRT2).gain);
  assert.equal(corner.position.x, from.x);
  assert.equal(corner.position.z, 2 * CELL);
  assert.ok(corner.distance > CELL * Math.SQRT2);
  assert.ok(corner.cutoff < 7200 && corner.cutoff > 1100);
  assert.ok(sound.gain > 0 && sound.gain <= 1);
  const reverse = soundPath(chunks, to, from);
  assert.equal(reverse.gain, sound.gain);
  assert.equal(reverse.distance, sound.distance);
});

test("closing either side of a gate seals the indirect route", () => {
  for (const closeSourceSide of [false, true]) {
    const chunks = route(), chunk = chunks.get("0,0")!;
    chunk.cells[closeSourceSide ? 2 * CHUNK + 1 : CHUNK + 1] &= ~(closeSourceSide ? N : S);
    const sound = soundPath(chunks, point(1, 1), point(2, 2));
    assert.deepEqual(sound.position, point(2, 2));
    assert.equal(sound.gain, transmission(wallsBetween(chunks, point(1, 1), point(2, 2)), CELL * Math.SQRT2).gain);
  }
});

test("open sightlines stay anchored, distant and unloaded sources remain silent", () => {
  const chunks = route();
  const source = point(1, 2);
  assert.equal(soundPath(chunks, point(1, 1), source).gain, 1);
  assert.deepEqual(soundPath(chunks, point(1, 1), source).position, source);
  assert.equal(soundPath(new Map(), point(1, 1), source).gain, 0);
  assert.equal(soundPath(chunks, point(1, 1), point(10, 1)).gain, 0);
});

test("doorway routes cross negative-coordinate seams only through matching resident gates", () => {
  const left = generateChunk(-1, 0, 1), right = generateChunk(0, 0, 1);
  left.cells.fill(0); right.cells.fill(0);
  left.cells[CHUNK + CHUNK - 1] = S;
  left.cells[2 * CHUNK + CHUNK - 1] = N | E;
  right.cells[2 * CHUNK] = W | N;
  right.cells[CHUNK] = S;
  const chunks = new Map<string, ChunkData>([["-1,0", left], ["0,0", right]]);
  const from = point(-1, 1), to = point(0, 2);
  assert.notDeepEqual(soundPath(chunks, from, to).position, to);
  assert.deepEqual(soundPath(chunks, from, to), soundPath(new Map([...chunks].reverse()), from, to));
  chunks.delete("0,0");
  assert.equal(soundPath(chunks, from, to).gain, 0);
});

test("indirect search never follows a route longer than six gates", () => {
  const chunks = route(), chunk = chunks.get("0,0")!;
  chunk.cells.fill(0);
  for (let z = 1; z < 5; z++) {
    for (const x of [1, 2]) {
      chunk.cells[z * CHUNK + x] |= S;
      chunk.cells[(z + 1) * CHUNK + x] |= N;
    }
  }
  chunk.cells[5 * CHUNK + 1] |= E;
  chunk.cells[5 * CHUNK + 2] |= W;
  const sound = soundPath(chunks, point(1, 1), point(2, 1));
  assert.deepEqual(sound.position, point(2, 1));
  assert.equal(sound.gain, transmission(1, CELL).gain);
});
