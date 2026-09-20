import assert from "node:assert/strict";
import test from "node:test";
import {
  CELL,
  CHUNK,
  SPAN,
  N,
  E,
  S,
  W,
  generateChunk,
  landmarkKind,
  type ChunkData,
} from "../src/lib/game/maze";
import { EntityNavigation } from "../src/lib/game/entity-navigation";
import { HOUSE_DEPTH, houseLots } from "../src/lib/game/neighborhood";
import { hardFloorAt } from "../src/lib/game/acoustics";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

function streets(seed: number, reach = 12) {
  const found: ChunkData[] = [];
  for (let z = -reach; z < reach; z++)
    for (let x = -reach; x < reach; x++)
      if (landmarkKind(x, z, seed) === "neighborhood")
        found.push(generateChunk(x, z, seed));
  return found;
}

test("streets are sporadic, skip the opening section, and keep shared gates", () => {
  for (const seed of [0, 1, 42, 199307, 882731]) {
    assert.notEqual(landmarkKind(0, 0, seed), "neighborhood");
    const found = streets(seed);
    assert.ok(found.length > 0, `tape ${seed} has a street within 12 sections`);
    for (let bz = -2; bz < 2; bz++)
      for (let bx = -2; bx < 2; bx++)
        assert.ok(
          found.filter(
            (d) => Math.floor(d.x / 6) === bx && Math.floor(d.z / 6) === bz,
          ).length <= 1,
          "at most one street per 36 sections",
        );
    for (const data of found) {
      const { x, z } = data;
      assert.deepEqual(data.landmark, generateChunk(x, z, seed, 11).landmark);
      assert.deepEqual(data.landmark, {
        kind: "neighborhood",
        x: 3,
        z: 1,
        width: 6,
        length: 10,
        height: 9.6,
      });
      const east = generateChunk(x + 1, z, seed, 8),
        south = generateChunk(x, z + 1, seed, 9);
      for (let c = 0; c < CHUNK; c++) {
        assert.equal(
          !!(data.cells[c * CHUNK + CHUNK - 1] & E),
          !!(east.cells[c * CHUNK] & W),
        );
        assert.equal(
          !!(data.cells[(CHUNK - 1) * CHUNK + c] & S),
          !!(south.cells[c] & N),
        );
      }
      // The familiar room it replaced still recurs three sections either way.
      assert.equal(
        landmarkKind(x - 3, z, seed),
        landmarkKind(x + 3, z, seed),
      );
    }
  }
});

test("houses line only closed wall, vary, and never cover a side entrance", () => {
  const sizes = new Set<number>(),
    styles = new Set<number>();
  for (const seed of [0, 42, 199307])
    for (const data of streets(seed)) {
      const room = data.landmark;
      const lots = houseLots(data);
      assert.ok(lots.length >= 4, "both sides of the street are built up");
      assert.deepEqual(lots, houseLots(generateChunk(data.x, data.z, seed)));
      const taken = new Set<string>();
      for (const lot of lots) {
        sizes.add(lot.rows);
        styles.add(lot.style % 5);
        const column = lot.side < 0 ? room.x : room.x + room.width - 1;
        for (let row = lot.row; row < lot.row + lot.rows; row++) {
          assert.ok(row < room.length);
          assert.ok(!taken.has(`${lot.side},${row}`), "lots never overlap");
          taken.add(`${lot.side},${row}`);
          assert.equal(
            data.cells[(room.z + row) * CHUNK + column] &
              (lot.side < 0 ? W : E),
            0,
            "no house stands in front of a maze opening",
          );
        }
      }
    }
  assert.deepEqual(sizes, new Set([1, 2]));
  assert.ok(styles.size >= 4, "siding colors vary down the street");
});

test("every gate reaches the street around the actual house fronts", () => {
  const seed = 199307;
  for (const data of streets(seed, 8).slice(0, 3)) {
    const mats = headlessMaterials(),
      section = buildSection(data, mats, 0);
    const navigation = new EntityNavigation();
    navigation.addSection(`${data.x},${data.z}`, data, section.colliders);
    const ox = data.x * SPAN,
      oz = data.z * SPAN;
    try {
      const size = CHUNK * 8,
        step = CELL / 8;
      const free = new Uint8Array(size * size);
      for (let iz = 0; iz < size; iz++)
        for (let ix = 0; ix < size; ix++)
          free[iz * size + ix] = Number(
            navigation.canOccupy({
              x: ox + (ix + 0.5) * step,
              z: oz + (iz + 0.5) * step,
            }),
          );
      const at = (x: number, z: number) =>
        Math.floor(z / step) * size + Math.floor(x / step);
      // Furniture may sit on a cell's center; any standing room in it counts.
      const reaches = (cx: number, cz: number) => {
        for (let iz = cz * 8; iz < cz * 8 + 8; iz++)
          for (let ix = cx * 8; ix < cx * 8 + 8; ix++)
            if (seen.has(iz * size + ix)) return true;
        return false;
      };
      const gates: [number, number][] = [];
      for (let c = 0; c < CHUNK; c++) {
        if (data.cells[c] & N) gates.push([c, 0]);
        if (data.cells[(CHUNK - 1) * CHUNK + c] & S) gates.push([c, CHUNK - 1]);
        if (data.cells[c * CHUNK] & W) gates.push([0, c]);
        if (data.cells[c * CHUNK + CHUNK - 1] & E) gates.push([CHUNK - 1, c]);
      }
      const room = data.landmark;
      const road = at(
        (room.x + room.width / 2) * CELL,
        (room.z + room.length / 2) * CELL,
      );
      const queue = [road],
        seen = new Set(queue);
      for (const current of queue)
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = (current % size) + dx,
            z = Math.floor(current / size) + dz,
            next = z * size + x;
          if (x < 0 || z < 0 || x >= size || z >= size) continue;
          if (!free[next] || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      assert.equal(gates.length, 4);
      for (const [cx, cz] of gates)
        assert.ok(reaches(cx, cz), "each section gate walks to the road");
      // Every perimeter opening is a usable way in, not a blocked alley.
      for (let cz = room.z; cz < room.z + room.length; cz++)
        for (const [cx, bit, dx] of [
          [room.x, W, -1],
          [room.x + room.width - 1, E, 1],
        ])
          if (data.cells[cz * CHUNK + cx] & bit)
            assert.ok(reaches(cx + Math.sign(dx), cz), "alleys stay open");
      // House bodies are sealed solids against the long walls.
      for (const lot of houseLots(data)) {
        const x =
          lot.side < 0
            ? room.x * CELL + HOUSE_DEPTH / 2
            : (room.x + room.width) * CELL - HOUSE_DEPTH / 2;
        const z = (room.z + lot.row + lot.rows / 2) * CELL;
        assert.equal(navigation.canOccupy({ x: ox + x, z: oz + z }), false);
      }
      assert.ok(section.group.getObjectByName("street-roofs"));
      assert.ok(section.group.getObjectByName("street-gables"));
      const chunks = new Map([[`${data.x},${data.z}`, data]]);
      assert.ok(
        hardFloorAt(chunks, {
          x: ox + (room.x + room.width / 2) * CELL,
          y: 0,
          z: oz + (room.z + 2) * CELL,
        }),
      );
    } finally {
      section.dispose?.();
      mats.dispose();
    }
  }
});
