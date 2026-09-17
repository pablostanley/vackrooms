import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CELL,
  CHUNK,
  HEIGHT,
  SPAN,
  directions,
  generateChunk,
  inLandmark,
  landmarkKind,
} from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { CharacterMotor } from "../src/lib/game/physics";
import { footstepSurfaceAt, roomSoundAt } from "../src/lib/game/acoustics";
import { headlessMaterials } from "./helpers/materials";

test("the Rapier capsule can enter and leave every framed party-room doorway", async () => {
  const data = generateChunk(0, 0, 42),
    room = data.landmark;
  const mats = headlessMaterials(),
    section = buildSection(data, mats, 0);
  const position = new THREE.Vector3(0, 1.66, 0);
  const motor = await CharacterMotor.create(position);
  let crossed = 0;
  try {
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    for (let z = room.z; z < room.z + room.length; z++)
      for (let x = room.x; x < room.x + room.width; x++)
        for (const { bit, dx, dz } of directions) {
          if (
            inLandmark(room, x + dx, z + dz) ||
            !(data.cells[z * CHUNK + x] & bit)
          )
            continue;
          const doorX = (x + 0.5 + dx * 0.5) * CELL;
          const doorZ = (z + 0.5 + dz * 0.5) * CELL;
          for (const side of [-1, 1]) {
            position.set(doorX + dx * side, 1.66, doorZ + dz * side);
            motor.teleport(position);
            for (let frame = 0; frame < 50; frame++)
              motor.move(
                -dx * side * 0.04,
                -dz * side * 0.04,
                1 / 60,
                position,
              );
            assert.ok(
              ((position.x - doorX) * dx + (position.z - doorZ) * dz) * side <
                -0.7,
              "door jambs leave a usable central passage in both directions",
            );
            assert.ok(
              Math.abs(position.y - 1.66) < 0.1,
              "the carpet threshold stays flush",
            );
          }
          crossed++;
        }
    assert.ok(crossed >= 2, "retain separate ways into and out of the room");
  } finally {
    motor.dispose();
    section.dispose();
    mats.dispose();
  }
});

test("Level Fun stays rare, recurring, and stable as unseen sections regenerate", () => {
  for (const seed of [0, 42, 199307, 882731])
    for (const z of [-4, 0, 5])
      for (const band of [-2, -1, 0, 1]) {
        const rooms = Array.from(
          { length: 24 },
          (_, i) => band * 24 + i,
        ).filter((x) => landmarkKind(x, z, seed) === "levelFun");
        assert.equal(
          rooms.length,
          1,
          "one surprise per 24 sections, including negative bands",
        );
        const data = generateChunk(rooms[0], z, seed);
        assert.deepEqual(
          data.landmark,
          generateChunk(rooms[0], z, seed, 33).landmark,
        );
        assert.equal(data.landmark.height, HEIGHT);
        assert.ok(data.landmark.width * data.landmark.length <= 9);
        const seen = new Set([0]),
          queue = [0];
        for (const at of queue)
          for (const d of directions) {
            const x = (at % CHUNK) + d.dx,
              z = Math.floor(at / CHUNK) + d.dz;
            if (
              x < 0 ||
              z < 0 ||
              x >= CHUNK ||
              z >= CHUNK ||
              !(data.cells[at] & d.bit)
            )
              continue;
            const next = z * CHUNK + x;
            assert.ok(data.cells[next] & d.opposite);
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        assert.equal(seen.size, CHUNK * CHUNK, "every cell remains connected");
        for (const d of directions) {
          const neighbor = generateChunk(
            data.x + d.dx,
            data.z + d.dz,
            seed,
            17,
          );
          for (let i = 0; i < CHUNK; i++) {
            const a = d.dx
              ? i * CHUNK + (d.dx > 0 ? CHUNK - 1 : 0)
              : (d.dz > 0 ? CHUNK - 1 : 0) * CHUNK + i;
            const b = d.dx
              ? i * CHUNK + (d.dx > 0 ? 0 : CHUNK - 1)
              : (d.dz > 0 ? 0 : CHUNK - 1) * CHUNK + i;
            assert.equal(
              !!(data.cells[a] & d.bit),
              !!(neighbor.cells[b] & d.opposite),
            );
          }
        }
      }
});

test("party rooms keep carpet acoustics, bright fixtures, and one floor surface", () => {
  const mats = headlessMaterials();
  mats.funCarpet.name = "party-carpet";
  try {
    for (const [x, z, seed] of [
      [0, 0, 42],
      [-24, -4, 0],
    ]) {
      const rx = Array.from({ length: 24 }, (_, i) => x + i).find(
        (cx) => landmarkKind(cx, z, seed) === "levelFun",
      )!;
      const data = generateChunk(rx, z, seed),
        room = data.landmark;
      const section = buildSection(data, mats, 0);
      const ox = rx * SPAN,
        oz = z * SPAN;
      try {
        const chunks = new Map([[`${rx},${z}`, data]]);
        const p = {
          x: ox + (room.x + 1.5) * CELL,
          y: 0,
          z: oz + (room.z + 1.5) * CELL,
        };
        assert.equal(footstepSurfaceAt(chunks, p), "carpet");
        assert.equal(roomSoundAt(chunks, p), "office");
        const roomLights = section.lights.filter((light) =>
          inLandmark(
            room,
            Math.floor((light.x - ox) / CELL),
            Math.floor((light.z - oz) / CELL),
          ),
        );
        assert.equal(roomLights.length, room.width * room.length);
        for (let cz = room.z; cz < room.z + room.length; cz++)
          for (let cx = room.x; cx < room.x + room.width; cx++) {
            const ray = new THREE.Raycaster(
              new THREE.Vector3(
                ox + (cx + 0.43) * CELL,
                0.2,
                oz + (cz + 0.43) * CELL,
              ),
              new THREE.Vector3(0, -1, 0),
              0,
              0.3,
            );
            const hits = ray.intersectObjects(section.occluders, false);
            assert.equal(
              hits.length,
              1,
              "no ordinary carpet underneath to flicker through",
            );
            assert.equal(
              (
                hits[0].object as THREE.Mesh<
                  THREE.BufferGeometry,
                  THREE.Material
                >
              ).material.name,
              "party-carpet",
            );
          }
        assert.ok(
          section.group.children.length < 40,
          "static details stay batched",
        );
      } finally {
        section.dispose();
      }
    }
  } finally {
    mats.dispose();
  }
});
