import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CHUNK, E, W, generateChunk, landmarkKind } from "../src/lib/game/maze";

test("optimized classification preserves established tapes across negative district and band seams", () => {
  // Captured from ce5e024 before replacing the 24-slot candidate arrays.
  // This freezes room identity only, allowing intentional room-interior refinements.
  const digest = createHash("sha256");
  for (const seed of [0, 1, 48, 60, 199307, 882731, 2147483647, -17])
    for (let z = -30; z <= 30; z++)
      for (let x = -30; x <= 30; x++)
        digest.update(landmarkKind(x, z, seed) + ",");
  assert.equal(digest.digest("hex"), "bd293b3cf3ed13f99107ec5a995f8a167cedae0f35349bab2611afc77851c29f");
});

test("direct corridor gate classification matches both neighbors at district boundaries", () => {
  for (const seed of [0, 1, 48, 199307, -17])
    for (const x of [-25, -24, -7, -6, -1, 0, 5, 6, 23, 24])
      for (const z of [-6, 0, 5]) {
        const left = generateChunk(x, z, seed, 0), right = generateChunk(x + 1, z, seed, 13);
        const continuous = left.landmark.kind === "corridor" && right.landmark.kind === "corridor";
        let gates = 0;
        for (let row = 0; row < CHUNK; row++) {
          const a = Boolean(left.cells[row * CHUNK + CHUNK - 1] & E);
          const b = Boolean(right.cells[row * CHUNK] & W);
          assert.equal(a, b);
          if (a) { gates++; if (continuous) assert.equal(row, 6); }
        }
        assert.equal(gates, 1);
      }
});
