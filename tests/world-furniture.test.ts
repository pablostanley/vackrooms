import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildSection, type Section } from "../src/lib/game/world";
import {
  CELL,
  CHUNK,
  N,
  E,
  S,
  W,
  generateChunk,
  type ChunkData,
} from "../src/lib/game/maze";
import { headlessMaterials } from "./helpers/materials";
import type { FurnitureKind } from "../src/lib/game/furniture-models";
import { isComputerKind } from "../src/lib/game/computer-models";

interface Placement {
  kind: FurnitureKind;
  attachment: "floor" | "chair" | "wall" | "ceiling";
  bounds: THREE.Box3;
}

function placements(section: Section): Placement[] {
  return section.group.userData.furniture;
}

/** The walking network is checked independently of the placement predicate. */
function passageZones(data: ChunkData) {
  const zones: { cell: string; bounds: THREE.Box3 }[] = [];
  for (let cz = 0; cz < CHUNK; cz++) {
    for (let cx = 0; cx < CHUNK; cx++) {
      const x = (cx + 0.5) * CELL;
      const z = (cz + 0.5) * CELL;
      const bits = data.cells[cz * CHUNK + cx];
      const add = (x0: number, z0: number, x1: number, z1: number) =>
        zones.push({
          cell: `${cx},${cz}`,
          bounds: new THREE.Box3(
            new THREE.Vector3(x0, 0.02, z0),
            new THREE.Vector3(x1, 1.85, z1),
          ),
        });
      add(x - 0.68, z - 0.68, x + 0.68, z + 0.68);
      if (bits & N) add(x - 0.68, cz * CELL, x + 0.68, z);
      if (bits & E) add(x, z - 0.68, (cx + 1) * CELL, z + 0.68);
      if (bits & S) add(x - 0.68, z, x + 0.68, (cz + 1) * CELL);
      if (bits & W) add(cx * CELL, z - 0.68, x, z + 0.68);
    }
  }
  return zones;
}

test("origin rooms vary a small furniture selection across tape seeds", () => {
  const mats = headlessMaterials();
  const expected: FurnitureKind[] = [
    "sofa",
    "table",
    "lamp",
    "slide",
    "springHorse",
    "blocks",
  ];
  const seenKinds = new Set<FurnitureKind>();
  const selections = new Set<string>();
  try {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 199307, 882731]) {
      for (const depth of [0, 1, 4]) {
        const section = buildSection(
          generateChunk(0, 0, seed, depth),
          mats,
          depth,
        );
        try {
          const present = new Set(
            placements(section)
              .map((placement) => placement.kind)
              .filter((kind) => kind !== "chair" && !isComputerKind(kind)),
          );
          assert.ok(
            present.size >= 2 && present.size <= 3,
            `tape ${seed}, depth ${depth} has two or three new furniture kinds`,
          );
          present.forEach((kind) => seenKinds.add(kind));
          selections.add([...present].sort().join(","));
        } finally {
          section.dispose();
        }
      }
    }
    assert.ok(
      selections.size >= 5,
      "different tapes have distinct opening furniture selections",
    );
    for (const kind of expected)
      assert.ok(
        seenKinds.has(kind),
        `${kind} appears across the sampled tapes`,
      );
  } finally {
    mats.dispose();
  }
});

test("the same tape reproduces furniture kinds and poses, while other tapes vary", () => {
  const mats = headlessMaterials();
  const snapshot = (seed: number) => {
    const section = buildSection(generateChunk(0, 0, seed), mats, 0);
    try {
      return placements(section).map((placement) => ({
        kind: placement.kind,
        attachment: placement.attachment,
        min: placement.bounds.min.toArray(),
        max: placement.bounds.max.toArray(),
      }));
    } finally {
      section.dispose();
    }
  };
  try {
    const first = snapshot(199307);
    assert.deepEqual(
      snapshot(199307),
      first,
      "shared tape furniture is reproducible",
    );
    for (const seed of [1, 882731]) {
      const next = snapshot(seed);
      assert.notDeepEqual(
        next,
        first,
        `tape ${seed} changes the furniture arrangement`,
      );
      assert.notDeepEqual(
        next.map((prop) => prop.min),
        first.map((prop) => prop.min),
        "positions vary with the tape",
      );
    }
  } finally {
    mats.dispose();
  }
});

test("furniture leaves connected walking lanes clear and floor pieces grounded", () => {
  const mats = headlessMaterials();
  const attachments = new Set<string>();
  const obstructions: string[] = [];
  try {
    for (const seed of [1, 199307, 882731]) {
      for (const [x, z, depth] of [
        [0, 0, 0],
        [-2, 1, 1],
        [3, -2, 4],
      ]) {
        const data = generateChunk(x, z, seed, depth);
        const section = buildSection(data, mats, depth);
        try {
          const zones = passageZones(data);
          for (const placement of placements(section)) {
            attachments.add(placement.attachment);
            const label = `${placement.kind}/${placement.attachment} tape ${seed}, section ${x},${z}, depth ${depth}`;
            if (placement.attachment === "floor") {
              assert.ok(
                Math.abs(placement.bounds.min.y) < 0.00001,
                `${label} floats above or sinks below the floor`,
              );
            }
            for (const zone of zones) {
              if (placement.bounds.intersectsBox(zone.bounds))
                obstructions.push(
                  `${label} obstructs the walking lane in cell ${zone.cell}`,
                );
            }
          }
        } finally {
          section.dispose();
        }
      }
    }
    for (const attachment of ["floor", "chair", "wall", "ceiling"])
      assert.ok(
        attachments.has(attachment),
        `fixture seeds exercise ${attachment} placement`,
      );
    assert.deepEqual(
      obstructions,
      [],
      "all reserved walking lanes remain clear",
    );
  } finally {
    mats.dispose();
  }
});

test("furniture batches merge valid indexed geometry and release it after use", (t) => {
  const disposed = new Set<string>();
  const originalClone = THREE.BufferGeometry.prototype.clone;
  const originalDispose = THREE.BufferGeometry.prototype.dispose;
  t.mock.method(
    THREE.BufferGeometry.prototype,
    "clone",
    function (this: THREE.BufferGeometry) {
      assert.equal(
        disposed.has(this.uuid),
        false,
        "a source mesh was disposed before its last placement",
      );
      return originalClone.call(this);
    },
  );
  t.mock.method(
    THREE.BufferGeometry.prototype,
    "dispose",
    function (this: THREE.BufferGeometry) {
      disposed.add(this.uuid);
      originalDispose.call(this);
    },
  );
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  const mats = headlessMaterials();
  const section = buildSection(generateChunk(0, 0, 199307, 2), mats, 2);
  const liveGeometry: THREE.BufferGeometry[] = [];
  try {
    assert.deepEqual(
      errors,
      [],
      "merged model batches must not report attribute/index mismatches",
    );
    section.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      liveGeometry.push(geometry);
      assert.equal(
        disposed.has(geometry.uuid),
        false,
        "live merged geometry was disposed",
      );
      assert.ok(
        geometry.index && geometry.index.count > 0,
        "each merged mesh has indexed triangles",
      );
      for (const name of ["position", "normal", "uv"]) {
        const attribute = geometry.getAttribute(name);
        assert.ok(attribute, `merged mesh retains ${name}`);
        assert.ok(
          Array.from(attribute.array).every(Number.isFinite),
          `merged ${name} contains only finite values`,
        );
      }
    });
    assert.ok(
      liveGeometry.length > 8,
      "furnishings form real material batches",
    );
    assert.ok(
      disposed.size > liveGeometry.length,
      "temporary source and placement geometry is released",
    );
  } finally {
    section.dispose();
    mats.dispose();
  }
  for (const geometry of liveGeometry)
    assert.ok(
      disposed.has(geometry.uuid),
      "section disposal releases each visible mesh",
    );
});
