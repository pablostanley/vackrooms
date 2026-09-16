import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CELL,
  CHUNK,
  HEIGHT,
  SPAN,
  N,
  E,
  S,
  W,
  type ChunkData,
} from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

function wallRun(
  x: number,
  z: number,
  vertical: boolean,
  soffit = false,
): ChunkData {
  const cells = new Uint8Array(CHUNK * CHUNK).fill(15);
  for (let i = 0; !soffit && i < CHUNK; i++) {
    if (vertical) {
      cells[i * CHUNK + 5] &= ~W;
      cells[i * CHUNK + 4] &= ~E;
    } else {
      cells[5 * CHUNK + i] &= ~N;
      cells[4 * CHUNK + i] &= ~S;
    }
  }
  return {
    x,
    z,
    cells,
    seed: 199307,
    theme: "offices",
    landmark: soffit
      ? {
          kind: "corridor",
          x: vertical ? 5 : 0,
          z: vertical ? 0 : 5,
          width: vertical ? 1 : CHUNK,
          length: vertical ? CHUNK : 1,
          height: 5.5,
        }
      : {
          kind: "corridor",
          x: 100,
          z: 100,
          width: 1,
          length: 1,
          height: HEIGHT,
        },
  };
}

for (const soffit of [false, true])
  test(`${soffit ? "soffits" : "walls and trims"} expose one surface on both sides of section seams`, () => {
    const mats = headlessMaterials();
    mats.wall.name = "seam-wall";
    mats.trim.name = "seam-trim";
    try {
      for (const vertical of [false, true]) {
        for (const boundary of [-1, 0, 1]) {
          const a = wallRun(
            vertical ? 1 : boundary - 1,
            vertical ? boundary - 1 : 1,
            vertical,
            soffit,
          );
          const b = wallRun(
            vertical ? 1 : boundary,
            vertical ? boundary : 1,
            vertical,
            soffit,
          );
          const sections = [a, b].map((data) => buildSection(data, mats, 0));
          const surfaces = sections
            .flatMap((section) => section.occluders)
            .filter((mesh) =>
              ["seam-wall", "seam-trim"].includes(
                (mesh.material as THREE.Material).name,
              ),
            );
          try {
            for (const side of [-1, 1]) {
              for (const offset of [-0.08, -0.01, 0.01, 0.08]) {
                for (const y of soffit ? [4.17] : [0.06, 1.47, HEIGHT - 0.03]) {
                  const along = boundary * SPAN + offset;
                  const across = SPAN + 5 * CELL + side;
                  const ray = new THREE.Raycaster(
                    new THREE.Vector3(
                      vertical ? across : along,
                      y,
                      vertical ? along : across,
                    ),
                    new THREE.Vector3(
                      vertical ? -side : 0,
                      0,
                      vertical ? 0 : -side,
                    ),
                    0,
                    2,
                  );
                  const hits = ray.intersectObjects(surfaces, false);
                  assert.ok(hits.length, "the seam must stay closed");
                  const front = hits.filter(
                    (hit) =>
                      Math.abs(hit.distance - hits[0].distance) < 0.00001,
                  );
                  assert.equal(
                    front.length,
                    1,
                    `one visible face: vertical=${vertical}, boundary=${boundary}, side=${side}, offset=${offset}, y=${y}`,
                  );
                }
              }
            }
          } finally {
            sections.forEach((section) => section.dispose());
          }
        }
      }
    } finally {
      mats.dispose();
    }
  });

test("L, T, and cross junctions stay closed after removing the segment overhang", () => {
  const mats = headlessMaterials();
  mats.wall.name = "seam-wall";
  try {
    for (const arms of [
      [N, E],
      [E, S],
      [S, W],
      [W, N],
      [N, E, S],
      [E, S, W],
      [S, W, N],
      [W, N, E],
      [N, E, S, W],
    ]) {
      const data = wallRun(1, 1, false);
      data.cells.fill(15);
      for (const arm of arms) {
        if (arm === E || arm === W) {
          const cx = arm === E ? 5 : 4;
          data.cells[5 * CHUNK + cx] &= ~N;
          data.cells[4 * CHUNK + cx] &= ~S;
        } else {
          const cz = arm === S ? 5 : 4;
          data.cells[cz * CHUNK + 5] &= ~W;
          data.cells[cz * CHUNK + 4] &= ~E;
        }
      }
      const section = buildSection(data, mats, 0);
      try {
        const surfaces = section.occluders.filter(
          (mesh) => (mesh.material as THREE.Material).name === "seam-wall",
        );
        const center = new THREE.Vector3(
          SPAN + 5 * CELL,
          1.47,
          SPAN + 5 * CELL,
        );
        for (let i = 0; i < 24; i++) {
          const angle = ((i + 0.5) * Math.PI) / 12;
          const outward = new THREE.Vector3(
            Math.cos(angle),
            0,
            Math.sin(angle),
          );
          const ray = new THREE.Raycaster(
            center.clone().add(outward),
            outward.negate(),
            0,
            1.2,
          );
          assert.ok(
            ray.intersectObjects(surfaces, false).length,
            `junction ${arms.join(",")} has no gap from angle ${angle}`,
          );
        }
      } finally {
        section.dispose();
      }
    }
  } finally {
    mats.dispose();
  }
});
