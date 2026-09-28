import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { buildSection, type Section } from "../src/lib/game/world";
import {
  CELL,
  CHUNK,
  HEIGHT,
  N,
  E,
  S,
  W,
  generateChunk,
  type ChunkData,
} from "../src/lib/game/maze";
import { headlessMaterials } from "./helpers/materials";
import {
  chairKinds,
  isChairKind,
  type FurnitureKind,
} from "../src/lib/game/furniture-models";
import { isComputerKind } from "../src/lib/game/computer-models";
import { partSolids, solidsOverlap } from "../src/lib/game/furniture-layout";
import { OBB } from "three/addons/math/OBB.js";

interface Placement {
  kind: FurnitureKind;
  attachment: "floor" | "chair" | "wall" | "ceiling";
  bounds: THREE.Box3;
}

function placements(section: Section): Placement[] {
  return section.group.userData.furniture;
}

test("all chair silhouettes appear as singles, pairs, and occasional clipped pieces or stacks", () => {
  const mats = headlessMaterials();
  const kinds = new Set<FurnitureKind>();
  const arrangements = new Set<string>();
  let small = 0,
    stacks = 0;
  try {
    for (const seed of [1, 2, 3, 8, 199307, 882731]) {
      const section = buildSection(generateChunk(-1, 0, seed, 2), mats, 2);
      try {
        const cells = new Map<string, Placement[]>();
        for (const prop of placements(section).filter((p) =>
          isChairKind(p.kind),
        )) {
          kinds.add(prop.kind);
          arrangements.add(prop.attachment);
          const center = prop.bounds.getCenter(new THREE.Vector3());
          const key = `${Math.floor(center.x / CELL)},${Math.floor(center.z / CELL)}`;
          const group = cells.get(key) ?? [];
          group.push(prop);
          cells.set(key, group);
        }
        for (const group of cells.values()) {
          if (group.some((p) => p.attachment === "chair")) stacks++;
          else if (group.every((p) => p.attachment === "floor")) {
            if (group.length === 1) arrangements.add("single");
            if (group.length === 2) arrangements.add("pair");
            small++;
          }
        }
      } finally {
        section.dispose();
      }
    }
    assert.deepEqual(kinds, new Set(chairKinds));
    for (const arrangement of ["single", "pair", "chair", "wall", "ceiling"])
      assert.ok(arrangements.has(arrangement), arrangement);
    assert.ok(small > stacks * 2, "singles and pairs dominate stacks");
  } finally {
    mats.dispose();
  }
});

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
    "filingCabinet",
    "bookcase",
    "bench",
    "sideTable",
    "utilityCart",
    "waterCooler",
    "photocopier",
    "archiveCartons",
  ];
  const seenKinds = new Set<FurnitureKind>();
  const selections = new Set<string>();
  try {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 199307, 882731]) {
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
              .filter((kind) => !isChairKind(kind) && !isComputerKind(kind)),
          );
          assert.ok(
            present.size >= 2 &&
              present.size <= (section.lampLights.length ? 4 : 3),
            `tape ${seed}, depth ${depth} has a small prop selection plus an occasional room lamp`,
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

test("placed furniture never passes through other furniture, pillars or shelving", () => {
  const mats = headlessMaterials();
  let checked = 0, tableChairs = 0;
  const designs = new Map<FurnitureKind, Set<number>>();
  try {
    for (const [x, z, seed, depth, generation] of [
      [0, 0, 48, 0, 2], [-1, 0, 2, 2, 2], [2, -3, 199307, 5, 2], [-4, 2, 882731, 3, 1],
      [3, 1, 14, 1, 2], [-2, -2, 91, 4, 2], [1, 5, 7, 0, 1], [5, -1, 3301, 2, 2],
    ] as const) {
      const section = buildSection(generateChunk(x, z, seed, depth, generation), mats, depth);
      try {
        const props = section.group.userData.furniture as (Placement & {
          variant: number; pose: THREE.Matrix4;
        })[];
        const solids = props.map((prop) =>
          partSolids(mats.furniture.get(prop.kind, false, prop.variant), prop.pose));
        const offset = new THREE.Vector3(-x * CELL * CHUNK, 0, -z * CELL * CHUNK);
        // Pillars and wall shelving are authored boxes, not furniture records.
        const fixtures = section.colliders
          .map((bounds) => bounds.clone().translate(offset))
          .filter((bounds) => {
            const size = bounds.getSize(new THREE.Vector3());
            return (Math.abs(size.x - 0.57) < 0.01 && Math.abs(size.z - 0.57) < 0.01 &&
                Math.abs(size.y - HEIGHT) < 0.01) ||
              (Math.abs(size.x - 1.14) < 0.01 && Math.abs(size.y - 1.3) < 0.01 &&
                Math.abs(size.z - 0.55) < 0.01);
          })
          .map((bounds) => new OBB().fromBox3(bounds));
        props.forEach((prop, i) => {
          if (!designs.has(prop.kind)) designs.set(prop.kind, new Set());
          designs.get(prop.kind)!.add(prop.variant);
          assert.ok(!solidsOverlap(solids[i], fixtures), `${prop.kind} clips a fixture`);
          for (let j = i + 1; j < props.length; j++) {
            if (!prop.bounds.intersectsBox(props[j].bounds)) continue;
            assert.ok(
              !solidsOverlap(solids[i], solids[j]),
              `${prop.kind}:${prop.attachment} passes through ${props[j].kind}:${props[j].attachment}`,
            );
          }
          checked++;
        });
        for (const table of props.filter((prop) => prop.kind === "table" && prop.attachment === "floor"))
          tableChairs += props.filter((prop) => isChairKind(prop.kind) &&
            prop.bounds.distanceToPoint(table.bounds.getCenter(new THREE.Vector3())) < 1.2).length;
      } finally {
        section.dispose();
      }
    }
    assert.ok(checked > 150, `checked ${checked} placements`);
    assert.ok(tableChairs > 0, "free-standing tables gather chairs");
    const varied = [...designs].filter(([kind, set]) => !isComputerKind(kind) && set.size > 1);
    assert.ok(varied.length >= 8, "repeated kinds appear in several generated designs");
  } finally {
    mats.dispose();
  }
});
