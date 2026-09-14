import assert from "node:assert/strict";
import test from "node:test";
import {
  CELL,
  CHUNK,
  SPAN,
  N,
  S,
  E,
  W,
  canStand,
  directions,
  generateChunk,
} from "../src/lib/game/maze";
test("every room is reachable across varied seeds and negative coordinates", () => {
  for (const seed of [0, 1, 199307, 882731])
    for (const [x, z] of [
      [0, 0],
      [-3, 2],
      [2, -4],
    ])
      for (const depth of [0, 1, 4]) {
        const data = generateChunk(x, z, seed, depth),
          seen = new Set([0]),
          queue = [0];
        for (let i = 0; i < queue.length; i++) {
          const at = queue[i],
            cx = at % CHUNK,
            cz = Math.floor(at / CHUNK);
          for (const d of directions) {
            const nx = cx + d.dx,
              nz = cz + d.dz;
            if (nx < 0 || nz < 0 || nx >= CHUNK || nz >= CHUNK) continue;
            if (data.cells[at] & d.bit) {
              const next = nz * CHUNK + nx;
              assert.ok(data.cells[next] & d.opposite);
              if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
              }
            }
          }
        }
        assert.equal(seen.size, CHUNK * CHUNK);
      }
});
test("chunk gates match adjacent and regenerated sections", () => {
  for (const x of [-4, -1, 0, 3])
    for (const z of [-2, 0, 5]) {
      const a = generateChunk(x, z, 199307, 0),
        east = generateChunk(x + 1, z, 199307, 22),
        south = generateChunk(x, z + 1, 199307, 33);
      for (let i = 0; i < CHUNK; i++) {
        assert.equal(
          !!(a.cells[i * CHUNK + CHUNK - 1] & E),
          !!(east.cells[i * CHUNK] & W),
        );
        assert.equal(
          !!(a.cells[(CHUNK - 1) * CHUNK + i] & S),
          !!(south.cells[i] & N),
        );
      }
    }
});
test("shared tapes reproduce geometry while deeper sections change", () => {
  const a = generateChunk(2, -1, 12345),
    b = generateChunk(2, -1, 12345),
    c = generateChunk(2, -1, 12345, 1);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.cells, c.cells);
});
test("collision permits open gates and blocks every closed wall", () => {
  const chunks = new Map();
  for (let z = -1; z <= 1; z++)
    for (let x = -1; x <= 1; x++)
      chunks.set(`${x},${z}`, generateChunk(x, z, 199307));
  for (const data of chunks.values())
    for (let cz = 0; cz < CHUNK; cz++)
      for (let cx = 0; cx < CHUNK; cx++) {
        const x = data.x * SPAN + (cx + 0.5) * CELL,
          z = data.z * SPAN + (cz + 0.5) * CELL;
        assert.ok(canStand(chunks, x, z));
        for (const d of directions) {
          const px = x + d.dx * (CELL / 2 - 0.1),
            pz = z + d.dz * (CELL / 2 - 0.1);
          if (!(data.cells[cz * CHUNK + cx] & d.bit))
            assert.equal(canStand(chunks, px, pz), false);
        }
      }
  assert.equal(canStand(chunks, CELL * 2.5, CELL * 4.5), true);
  assert.equal(canStand(chunks, 99999, 99999), false);
});
