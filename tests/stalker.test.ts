import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3, MeshBasicMaterial } from "three";
import {
  EntityNavigation,
  groundDistance,
  type EntityView,
} from "../src/lib/game/entity-navigation";
import { EntityModel } from "../src/lib/game/entity-model";
import {
  LEG_LENGTH,
  solveEntityLeg,
  stepLength,
} from "../src/lib/game/entity-gait";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";
import { EncounterSchedule, Stalker } from "../src/lib/game/stalker";
import {
  CELL,
  CHUNK,
  E,
  W,
  generateChunk,
  type ChunkData,
} from "../src/lib/game/maze";

function openChunk(x = 0, z = 0): ChunkData {
  const chunk = generateChunk(x, z, 1);
  chunk.cells.fill(15);
  chunk.landmark = {
    kind: "lobby",
    x: 0,
    z: 0,
    width: CHUNK,
    length: CHUNK,
    height: 3.15,
  };
  return chunk;
}
function openWorld() {
  const nav = new EntityNavigation();
  for (let z = -1; z <= 1; z++)
    for (let x = -1; x <= 1; x++)
      nav.addSection(`${x},${z}`, openChunk(x, z), []);
  return nav;
}
const box = (
  x: number,
  z: number,
  width: number,
  depth: number,
  height = 2.9,
) => new Box3(new Vector3(x, 0, z), new Vector3(x + width, height, z + depth));
const view = (x = 22, z = 22): EntityView => ({
  position: { x, y: 1.66, z },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
  fov: 68,
  aspect: 16 / 9,
});

test("routes around furniture within one room, including a thin partition", () => {
  const nav = new EntityNavigation();
  nav.addSection("0,0", openChunk(), [box(2.37, 0, 0.03, 3.2)]);
  const from = { x: 1.2, z: 1.2 },
    to = { x: 3.6, z: 1.2 };
  assert.equal(nav.clearSegment(from, to), false);
  const route = nav.route(from, to);
  assert.ok(route.length > 1);
  let previous = from;
  for (const point of route) {
    assert.ok(
      nav.clearSegment(previous, point),
      "every smoothed segment clears furniture",
    );
    previous = point;
  }
  assert.ok(groundDistance(previous, to) < 0.1);
  assert.ok(
    route.some((p) => p.z > 3.55),
    "walks around the end, not through it",
  );
  assert.equal(
    nav.route(from, { x: 1.8, z: 1.2 }).length,
    1,
    "same-cell target remains the actual destination",
  );
});

test("seams require matching gates, resident data, and invalidate cached paths", () => {
  const nav = new EntityNavigation(),
    left = openChunk(-1),
    right = openChunk();
  nav.addSection("-1,0", left, []);
  nav.addSection("0,0", right, []);
  const a = { x: -1.2, z: CELL * 2.5 },
    b = { x: 1.2, z: CELL * 2.5 };
  assert.ok(nav.route(a, b).length);
  for (let z = 0; z < CHUNK; z++) {
    left.cells[z * CHUNK + CHUNK - 1] &= ~E;
    right.cells[z * CHUNK] &= ~W;
  }
  nav.addSection("-1,0", left, []);
  nav.addSection("0,0", right, []);
  assert.equal(nav.sight({ ...a, y: 1.7 }, { ...b, y: 1.7 }), false);
  assert.equal(nav.route(a, b).length, 0);
  nav.removeSection("0,0");
  assert.equal(nav.canOccupy(b), false);
  assert.equal(nav.route(a, b).length, 0);
});

test("visibility uses furniture height, wall thickness, camera pitch and aspect", () => {
  const nav = new EntityNavigation(),
    chunk = openChunk();
  const camera = view(2.4, 10),
    entity = { x: 2.4, z: 2.4 };
  nav.addSection("0,0", chunk, [box(0, 5, 4.8, 0.025, 1.1)]);
  assert.ok(nav.visible(entity, camera), "a low desk does not hide the head");
  nav.addSection("0,0", chunk, [box(0, 5, 4.8, 0.025)]);
  assert.equal(
    nav.visible(entity, camera),
    false,
    "a tall cabinet hides the whole body",
  );
  nav.addSection("0,0", chunk, []);
  assert.ok(nav.visible({ x: 7.5, z: 2.4 }, camera));
  assert.equal(
    nav.visible({ x: 7.5, z: 2.4 }, { ...camera, aspect: 0.5 }),
    false,
  );
  assert.equal(
    nav.visible(entity, {
      ...camera,
      forward: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
    }),
    false,
  );
  chunk.cells[CHUNK] &= ~E;
  chunk.cells[CHUNK + 1] &= ~W;
  nav.addSection("0,0", chunk, []);
  assert.equal(
    nav.sight(
      { x: CELL - 0.05, y: 1.7, z: 5 },
      { x: CELL - 0.05, y: 1.7, z: 8 },
    ),
    false,
    "grazing ray catches wall thickness",
  );
});

test("pools block feet but allow sight across the water", () => {
  const nav = new EntityNavigation(),
    chunk = openChunk();
  chunk.landmark = {
    kind: "poolroom",
    x: 2,
    z: 2,
    width: 8,
    length: 8,
    height: 6.8,
  };
  nav.addSection("0,0", chunk, []);
  assert.equal(nav.canOccupy({ x: 28.8, z: 28.8 }), false);
  assert.ok(nav.sight({ x: 15, y: 1.7, z: 28.8 }, { x: 42, y: 2.5, z: 28.8 }));
});

test("encounters have a seeded opening, skipped opportunities and long rests", () => {
  const a = new EncounterSchedule(199307),
    b = new EncounterSchedule(199307);
  assert.ok(a.next >= 75 && a.next <= 135);
  assert.equal(a.next, b.next);
  for (let time = 0; time < 74; time++) assert.equal(a.poll(time), false);
  for (let time = 75; time < 900; time++)
    assert.equal(a.poll(time), b.poll(time));
  a.rest(900);
  assert.ok(a.next >= 1005 && a.next <= 1110);
  const arrivals = new Set(
    Array.from({ length: 8 }, (_, seed) => new EncounterSchedule(seed).next),
  );
  assert.equal(arrivals.size, 8);
});

function encounter(seed: number) {
  const nav = openWorld(),
    stalker = new Stalker(seed, nav),
    input = { view: view(), playerSpeed: 0 };
  let time = 0;
  while (!stalker.present && time < 450) {
    stalker.update(0.1, input, () =>
      assert.fail("no footsteps during isolation"),
    );
    time += 0.1;
  }
  assert.ok(stalker.present);
  assert.ok(time >= 75);
  assert.equal(
    nav.visible(stalker.position, input.view),
    false,
    "never pops into the camera frustum",
  );
  assert.ok(groundDistance(stalker.position, input.view.position) >= 14);
  return { nav, stalker, input };
}

test("watching freezes the early stalk, then stops protecting against movement and pursuit", () => {
  let pursuits = 0;
  for (const seed of [1, 2, 3, 4]) {
    const { stalker, input } = encounter(seed);
    const start = stalker.position.clone();
    let steps = 0,
      pursuedAt = 0,
      maxSpeed = 0;
    input.playerSpeed = 4.1;
    input.view.forward = new Vector3()
      .subVectors(stalker.position.clone().setY(1.66), input.view.position)
      .normalize();
    for (let i = 0; i < 150; i++) stalker.update(0.1, input, () => steps++);
    assert.deepEqual(
      stalker.position,
      start,
      "looking at it stops all movement during the opening",
    );
    assert.equal(steps, 0, "a frozen creature makes no footsteps");
    for (let time = 15; time < 57; time += 0.1) {
      input.view.forward = new Vector3()
        .subVectors(stalker.position.clone().setY(1.66), input.view.position)
        .normalize();
      const caught = stalker.update(0.1, input, () => steps++);
      if (stalker.phase === "pursuing") {
        if (!pursuedAt) pursuedAt = time;
        maxSpeed = Math.max(maxSpeed, stalker.speed);
      }
      if (caught) break;
    }
    assert.ok(
      stalker.position.distanceTo(start) > 1,
      "moves even while observed",
    );
    assert.ok(steps > 0, "actual movement produces spatial footfalls");
    if (pursuedAt) {
      pursuits++;
      assert.ok(
        pursuedAt >= 17.9,
        `first stalking interval lasted ${pursuedAt}`,
      );
      assert.ok(
        maxSpeed > 4.1,
        "sustained running eventually draws a faster pursuit",
      );
    }
  }
  assert.ok(pursuits > 0 && pursuits < 4, "some encounters stay sightings");
});

test("losing sight and going quiet sends it to the last known position, then into isolation", () => {
  const chase = [1, 2, 3, 4]
    .map((seed) => {
      const result = encounter(seed);
      result.input.playerSpeed = 4.1;
      for (let i = 0; i < 400 && result.stalker.phase !== "pursuing"; i++)
        result.stalker.update(0.1, result.input, () => {});
      return result;
    })
    .find((result) => result.stalker.phase === "pursuing");
  assert.ok(chase);
  const { nav, stalker, input } = chase;
  // Visibility geometry is tested above; here isolate the loss-of-contact behavior.
  nav.sight = () => false;
  const lastKnown = { ...input.view.position };
  input.playerSpeed = 0;
  input.view.position = { ...lastKnown, x: lastKnown.x + 24 };
  let searched = false,
    closestToMemory = Infinity;
  for (let i = 0; i < 320; i++) {
    assert.equal(
      stalker.update(0.1, input, () => {}),
      false,
    );
    searched ||= stalker.phase === "searching";
    closestToMemory = Math.min(
      closestToMemory,
      groundDistance(stalker.position, lastKnown),
    );
  }
  assert.ok(searched);
  assert.ok(
    closestToMemory < 1.5,
    "searched the place it last perceived the player",
  );
  assert.ok(
    groundDistance(stalker.position, input.view.position) > 15,
    "did not track the silent hidden player",
  );
  assert.equal(stalker.phase, "isolated");
});

test("an unreachable retreat still ends once hidden, with no phantom footfalls", () => {
  const { nav, stalker, input } = encounter(1);
  nav.sight = () => false;
  nav.route = () => [];
  let steps = 0;
  for (let i = 0; i < 350; i++) stalker.update(0.1, input, () => steps++);
  assert.equal(stalker.phase, "isolated");
  assert.equal(steps, 0);
});

test("fixed-step playback repeats across render rates and resets grant isolation", () => {
  const a = encounter(2),
    b = encounter(2);
  let stepsA = 0,
    stepsB = 0;
  for (let i = 0; i < 300; i++)
    a.stalker.update(1 / 30, a.input, () => stepsA++);
  for (let i = 0; i < 600; i++)
    b.stalker.update(1 / 60, b.input, () => stepsB++);
  assert.deepEqual(a.stalker.position, b.stalker.position);
  assert.equal(a.stalker.gait, b.stalker.gait);
  assert.equal(stepsA, stepsB);
  a.stalker.reset();
  for (let i = 0; i < 1000; i++)
    a.stalker.update(0.1, a.input, () => assert.fail("reset footstep"));
  assert.equal(a.stalker.present, false);
});

test("jointed knees and arms change pose with traveled gait and settle when stopped", () => {
  const material = new MeshBasicMaterial(),
    model = new EntityModel(material);
  const pose = () => {
    const result: number[] = [];
    model.traverse((n) => result.push(n.rotation.x));
    return result;
  };
  model.animate(0, true, 1.2, 1);
  const before = pose();
  model.animate(Math.PI / 2, true, 1.2, 1);
  assert.notDeepEqual(pose(), before);
  model.animate(Math.PI / 2, false, 0, 1);
  const stopped = pose();
  model.animate(Math.PI / 2, false, 0, 1);
  assert.deepEqual(pose(), stopped);
  model.traverse((n) => {
    if ("geometry" in n) (n.geometry as { dispose(): void }).dispose();
  });
  material.dispose();
});

test("knees bend forward and planted feet stay on the floor through walking and running", () => {
  for (const speed of [0.38, 1.2, 2.85, 4.65]) {
    const material = new MeshBasicMaterial();
    const model = new EntityModel(material);
    for (let i = 0; i < 120; i++) {
      const gait = (i / 120) * Math.PI * 2;
      model.animate(gait, true, speed, 1);
      model.updateMatrixWorld(true);
      for (const side of ["left", "right"]) {
        const hip = model.getObjectByName(`${side}-hip`)!,
          knee = model.getObjectByName(`${side}-knee`)!,
          ankle = model.getObjectByName(`${side}-ankle`)!;
        const h = hip.getWorldPosition(new Vector3()),
          k = knee.getWorldPosition(new Vector3()),
          a = ankle.getWorldPosition(new Vector3());
        assert.ok(
          knee.rotation.x >= 0 && knee.rotation.x < Math.PI,
          "anatomical knee bend",
        );
        assert.ok(
          k.z > (h.z + a.z) / 2,
          "knee stays forward of the hip-to-ankle line",
        );
        assert.ok(a.y >= 0.049, `foot clears the floor at ${speed}m/s`);
        assert.ok(Math.abs(h.distanceTo(k) - LEG_LENGTH) < 1e-6);
        assert.ok(Math.abs(k.distanceTo(a) - LEG_LENGTH) < 1e-6);
      }
    }
    model.animate(0, true, speed, 1);
    assert.ok(
      model.getObjectByName("left-knee")!.rotation.x < 0.3,
      "the supporting leg straightens at mid-stance",
    );
    const hipHeight = 1.2;
    const first = solveEntityLeg(-Math.PI / 2, speed, 1, hipHeight);
    const later = solveEntityLeg(-Math.PI / 2 + 0.1, speed, 1, hipHeight);
    assert.ok(
      Math.abs(
        first.footZ - later.footZ - (stepLength(speed) * 0.1) / Math.PI,
      ) < 1e-6,
      "stance cancels forward travel instead of skating",
    );
    model.traverse((n) => {
      if ("geometry" in n) (n.geometry as { dispose(): void }).dispose();
    });
    material.dispose();
  }
});

test("real furnished tapes produce hidden arrivals and traversable stalking routes", () => {
  const materials = headlessMaterials();
  for (const seed of [199307, 42069, 7]) {
    const nav = new EntityNavigation();
    const sections = [];
    for (let z = -1; z <= 1; z++)
      for (let x = -1; x <= 1; x++) {
        const data = generateChunk(x, z, seed),
          section = buildSection(data, materials, 0);
        sections.push(section);
        nav.addSection(`${x},${z}`, data, section.colliders);
      }
    const stalker = new Stalker(seed, nav),
      input = { view: view(12, 21.6), playerSpeed: 0 };
    let arrived = false,
      traveled = 0;
    for (let i = 0; i < 1800; i++) {
      const previous = stalker.position.clone(),
        present = stalker.present;
      stalker.update(0.1, input, () => {});
      if (!present && stalker.present) {
        arrived = true;
        assert.equal(nav.visible(stalker.position, input.view), false);
      }
      if (present && stalker.present) {
        assert.ok(
          nav.clearSegment(previous, stalker.position),
          `tape ${seed} keeps body clearance`,
        );
        traveled += groundDistance(previous, stalker.position);
      }
    }
    assert.ok(arrived, `tape ${seed} has an arrival`);
    assert.ok(traveled > 3, `tape ${seed} walks through its furniture layout`);
    for (const section of sections) section.dispose();
    nav.clear();
    assert.equal(nav.chunks.size, 0);
  }
  materials.dispose();
});
