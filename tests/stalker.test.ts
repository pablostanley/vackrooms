import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3, MeshBasicMaterial } from "three";
import {
  EntityNavigation,
  groundDistance,
  type EntityView,
} from "../src/lib/game/entity-navigation";
import { Encounters } from "../src/lib/game/encounters";
import { EntityModel } from "../src/lib/game/entity-model";
import {
  LEG_LENGTH,
  solveEntityLeg,
  stepLength,
} from "../src/lib/game/entity-gait";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";
import { EncounterSchedule, Stalker } from "../src/lib/game/stalker";
import { CRUSH_DURATION, crushEnvelope, nextLifeSeed } from "../src/lib/game/encounter-effects";
import {
  CELL,
  CHUNK,
  E,
  SPAN,
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

test("encounters have an early seeded opening, short retries and bounded rests", () => {
  const a = new EncounterSchedule(199307),
    b = new EncounterSchedule(199307);
  assert.ok(a.next >= 18 && a.next <= 30);
  assert.equal(a.next, b.next);
  for (let time = 0; time < 18; time++) assert.equal(a.poll(time), false);
  for (let time = 18; time < 900; time++)
    assert.equal(a.poll(time), b.poll(time));
  a.rest(900);
  assert.ok(a.next >= 945 && a.next <= 975);
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
  while (!stalker.present && time < 35) {
    stalker.update(0.1, input, () =>
      assert.fail("no footsteps during isolation"),
    );
    time += 0.1;
  }
  assert.ok(stalker.present);
  assert.ok(time >= 18 && time <= 30.1);
  assert.equal(
    nav.visible(stalker.position, input.view),
    false,
    "never pops into the camera frustum",
  );
  assert.ok(groundDistance(stalker.position, input.view.position) >= 10);
  return { nav, stalker, input };
}

test("contact grabs, holds still through the squeeze, and emits death exactly once at every frame rate", () => {
  for (const fps of [30, 60, 144]) {
    const stalker = new Stalker(1, openWorld());
    const input = { view: view(), playerSpeed: 0 };
    stalker.stage({ x: 22, z: 21.05 }, input.view.position, true);
    for (let i = 0; i < Math.ceil(fps / 15); i++) stalker.update(1 / fps, input, () => {});
    assert.equal(stalker.phase, "grabbing");
    const contact = stalker.position.clone();
    let deaths = 0;
    for (let i = 0; i < fps * 3; i++) deaths += Number(stalker.update(1 / fps, input, () => assert.fail("footfall while held")));
    assert.equal(deaths, 0, "contact does not instantly kill");
    for (let i = 0; i < fps * 2; i++) deaths += Number(stalker.update(1 / fps, input, () => assert.fail("footfall while dead")));
    assert.equal(deaths, 1);
    assert.equal(stalker.phase, "dead");
    assert.deepEqual(stalker.position, contact);
    assert.equal(stalker.attackTime, CRUSH_DURATION);
    stalker.reset();
    assert.equal(stalker.attacking, false);
    assert.equal(stalker.attackTime, 0);
  }
});

test("nearby walls, desks, and a player above reach prevent a grab", () => {
  for (const barrier of [box(21, 21.5, 2, 0.025), box(21, 21.5, 2, 0.025, 1.1), null]) {
    const nav = openWorld();
    nav.addSection("0,0", openChunk(), barrier ? [barrier] : []);
    const stalker = new Stalker(1, nav);
    const input = { view: view(), playerSpeed: 0 };
    if (!barrier) input.view.position.y = 3.4;
    stalker.stage({ x: 22, z: 21.05 }, input.view.position, true);
    for (let i = 0; i < 3; i++) stalker.update(1 / 30, input, () => {});
    assert.equal(stalker.attacking, false);
  }
});

test("jump escape cancels death and gives two seconds without an immediate regrab", () => {
  for (const heldFor of [0.2, 2, 3.6]) {
    const stalker = new Stalker(1, openWorld());
    const input = { view: view(), playerSpeed: 0 };
    assert.equal(stalker.escape(), false);
    stalker.stage({ x: 22, z: 21.05 }, input.view.position, true);
    stalker.update(1 / 30, input, () => {});
    for (let i = 0; i < heldFor * 30; i++) stalker.update(1 / 30, input, () => {});
    assert.equal(stalker.escape(), true);
    assert.equal(stalker.phase, "staggered");
    assert.equal(stalker.attacking, false);
    assert.equal(stalker.attackTime, 0);
    const contact = stalker.position.clone();
    for (let i = 0; i < 59; i++) {
      assert.equal(stalker.update(1 / 30, input, () => assert.fail("staggered footstep")), false);
      assert.equal(stalker.phase, "staggered");
    }
    assert.deepEqual(stalker.position, contact);
    input.view.position = { x: 22, y: 1.66, z: 30 };
    for (let i = 0; i < 10; i++) stalker.update(1 / 30, input, () => {});
    assert.equal(stalker.phase, "pursuing");
  }
});

test("crushing feedback is bounded and steady mode removes pulses and shake", () => {
  for (let t = 0; t <= CRUSH_DURATION; t += 1 / 144) {
    const effect = crushEnvelope(t), steady = crushEnvelope(t, true);
    assert.ok(effect.shake >= 0 && effect.shake <= 0.65);
    assert.ok(effect.red >= 0 && effect.red <= 0.46);
    assert.equal(steady.shake, 0);
    assert.ok(effect.blackout >= 0 && effect.blackout <= 1);
  }
  assert.equal(crushEnvelope(CRUSH_DURATION).blackout, 1);
  assert.equal(crushEnvelope(2.9, true).red, crushEnvelope(3.1, true).red);
  for (const seed of [0, 1, 199307, 999999999]) {
    assert.notEqual(nextLifeSeed(seed), seed);
    assert.equal(nextLifeSeed(seed), nextLifeSeed(seed));
    assert.ok(nextLifeSeed(seed) >= 100000 && nextLifeSeed(seed) < 1000000);
  }
});

test("arms extend ahead, then forearms fold inward around the player", () => {
  const material = new MeshBasicMaterial(), model = new EntityModel(material);
  const hands = () => ["left", "right"].map(side => model.getObjectByName(`${side}-hand`)!.getWorldPosition(new Vector3()));
  model.animate(0, false, 0, 1, 1, 0);
  model.updateMatrixWorld(true);
  const open = hands();
  assert.ok(open.every(hand => hand.z > 0.9));
  assert.ok(open[1].x - open[0].x > 1);
  model.animate(0, false, 0, 1, 1, 1);
  model.updateMatrixWorld(true);
  const closed = hands();
  assert.ok(closed[1].x - closed[0].x < (open[1].x - open[0].x) * 0.55);
  model.traverse(n => { if ("geometry" in n) (n.geometry as { dispose(): void }).dispose(); });
  material.dispose();
});

test("watching holds for a minute and erodes through sparse steps even after pursuit starts", () => {
  const stalker = new Stalker(1, openWorld());
  const input = { view: view(22, 22), playerSpeed: 4.1 };
  stalker.stage({ x: 22, z: 10 }, input.view.position);
  const start = stalker.position.clone();
  let steps = 0;
  for (let i = 0; i < 540; i++) stalker.update(0.1, input, () => steps++);
  assert.deepEqual(stalker.position, start);
  assert.equal(steps, 0);
  let movingTicks = 0, frozenTicks = 0;
  for (let i = 0; i < 330; i++) {
    stalker.update(0.1, input, () => steps++);
    if (stalker.speed > 0) movingTicks++;
    else frozenTicks++;
    assert.ok(stalker.speed <= 0.42, "phase changes cannot bypass the gaze limit");
  }
  assert.equal(stalker.phase, "pursuing");
  assert.ok(movingTicks > 0 && frozenTicks > movingTicks * 5, "small steps separated by long holds");
  assert.ok(stalker.position.distanceTo(start) < 1.5);
  for (let i = 0; i < 1300 && !stalker.attacking; i++) stalker.update(0.1, input, () => steps++);
  assert.ok(stalker.attacking, "gaze eventually loses protection");
  assert.ok(steps > 0);
});

test("losing sight and going quiet sends it to the last known position, then into isolation", () => {
  const nav = openWorld(), stalker = new Stalker(2, nav);
  const input = { view: view(), playerSpeed: 4.1 };
  stalker.stage({ x: 22, z: 10 }, input.view.position, true);
  stalker.update(0.1, input, () => {});
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

test("walking away starts a chase instead of leaving a slow glimpse behind", () => {
  const stalker = new Stalker(1, openWorld());
  const input = { view: view(), playerSpeed: 2.35, canGrab: false };
  input.view.forward.z = 1;
  stalker.stage({ x: 22, z: 10 }, input.view.position);
  for (let i = 0; i < 30 * 20; i++) {
    input.view.position.z += 2.35 / 30;
    stalker.update(1 / 30, input, () => {});
    assert.ok(stalker.present, "walking away cannot remove a creature tracking you");
  }
  assert.equal(stalker.phase, "pursuing");
  assert.ok(stalker.position.z > 50, "keeps pace through the section boundary");
  assert.ok(groundDistance(stalker.position, input.view.position) < 18);
});

test("a sensed player keeps an old pursuit alive even when the camera turns away", () => {
  const stalker = new Stalker(2, openWorld());
  const input = { view: view(), playerSpeed: 2.35, canGrab: false };
  stalker.stage({ x: 22, z: 10 }, input.view.position, true);
  for (let i = 0; i < 3000; i++) {
    if (i === 1490) input.view.forward.z = 1;
    stalker.update(0.1, input, () => {});
    assert.equal(stalker.phase, "pursuing", "neither chase nor lifetime timers may retire a sensed target");
  }
});

test("a chase survives resident sections loading and unloading without teleporting", () => {
  const nav = openWorld(), stalker = new Stalker(1, nav);
  const input = { view: view(), playerSpeed: 2.35, canGrab: false };
  input.view.forward.z = 1;
  stalker.stage({ x: 22, z: 10 }, input.view.position, true);
  let sectionZ = 0;
  for (let i = 0; i < 30 * 90; i++) {
    input.view.position.z += 2.35 / 30;
    const nextSectionZ = Math.floor(input.view.position.z / SPAN);
    if (nextSectionZ !== sectionZ) {
      for (let x = -1; x <= 1; x++) {
        nav.removeSection(`${x},${sectionZ - 1}`);
        nav.addSection(`${x},${nextSectionZ + 1}`, openChunk(x, nextSectionZ + 1), []);
      }
      sectionZ = nextSectionZ;
    }
    const previous = stalker.position.clone();
    stalker.update(1 / 30, input, () => {});
    assert.equal(stalker.phase, "pursuing");
    assert.ok(stalker.position.distanceTo(previous) <= 2.85 / 30 + 1e-6);
    assert.ok(nav.canOccupy(stalker.position));
    assert.equal(nav.chunks.size, 9);
  }
  assert.ok(sectionZ >= 4);
});

test("regaining contact during retreat resumes pursuit", () => {
  const nav = openWorld(), stalker = new Stalker(2, nav);
  const input = { view: view(), playerSpeed: 0, canGrab: false };
  stalker.stage({ x: 22, z: 10 }, input.view.position, true);
  stalker.update(0.1, input, () => {});
  const sight = nav.sight.bind(nav);
  nav.sight = () => false;
  input.view.position.x += 24;
  for (let i = 0; i < 245; i++) stalker.update(0.1, input, () => {});
  assert.equal(stalker.phase, "retreating");
  nav.sight = sight;
  for (let i = 0; i < 5; i++) stalker.update(0.1, input, () => {});
  assert.equal(stalker.phase, "pursuing");
});

test("an unavailable spawn retries promptly without skipping another encounter", () => {
  const nav = openWorld(), stalker = new Stalker(199307, nav);
  const input = { view: view(), playerSpeed: 0 };
  const route = nav.route.bind(nav);
  nav.route = () => [];
  for (let i = 0; i < 350; i++) stalker.update(0.1, input, () => {});
  assert.equal(stalker.present, false);
  nav.route = route;
  for (let i = 0; i < 51 && !stalker.present; i++) stalker.update(0.1, input, () => {});
  assert.ok(stalker.present);
  assert.equal(nav.visible(stalker.position, input.view), false);
});

test("exploration mode releases an active grab and cannot spawn or kill while disabled", () => {
  const encounters = new Encounters(1, openWorld());
  const input = { view: view(), playerSpeed: 0 };
  encounters.stalkers[0].stage({ x: 22, z: 21.05 }, input.view.position, true);
  encounters.update(0.1, input, () => {});
  assert.equal(encounters.attacking, true);
  encounters.setEnabled(false);
  assert.equal(encounters.present, false);
  assert.equal(encounters.attacking, false);
  assert.equal(encounters.attackTime, 0);
  for (let i = 0; i < 6000; i++) {
    assert.equal(encounters.update(0.1, input, () => assert.fail("exploration footstep")), false);
    assert.equal(encounters.present, false);
  }
  encounters.reset();
  encounters.update(0.1, input, () => assert.fail("reset must preserve exploration mode"));
  assert.equal(encounters.present, false);
});

test("re-enabling encounters grants breathing room and keeps the schedule seeded", () => {
  const arrivals = (explorationDuration: number) => {
    const encounters = new Encounters(199307, openWorld());
    const input = { view: view(), playerSpeed: 0 };
    encounters.setEnabled(false);
    for (let i = 0; i < explorationDuration; i++) encounters.update(0.1, input, () => {});
    encounters.setEnabled(true);
    for (let i = 1; i <= 800; i++) {
      encounters.setEnabled(true); // unrelated settings must not restart the schedule
      encounters.update(0.1, input, () => {});
      if (encounters.present) return i / 10;
    }
    assert.fail("encounters should resume");
  };
  const arrival = arrivals(0);
  assert.ok(arrival >= 45 && arrival <= 75.1);
  assert.equal(arrivals(6000), arrival, "exploration time cannot advance the encounter RNG");
});

test("two seeded creatures arrive at separate times without spawning on each other", () => {
  const nav = openWorld(), encounters = new Encounters(199307, nav);
  const input = { view: view(), playerSpeed: 0 };
  const arrivals = [0, 0];
  for (let i = 1; i <= 760; i++) {
    encounters.update(0.1, input, () => {});
    encounters.stalkers.forEach((stalker, index) => {
      if (!arrivals[index] && stalker.present) {
        arrivals[index] = i / 10;
        assert.equal(nav.visible(stalker.position, input.view), false);
        if (index === 1) assert.ok(groundDistance(stalker.position, encounters.stalkers[0].position) >= 6);
      }
    });
  }
  assert.ok(arrivals[0] >= 18 && arrivals[0] <= 30.1);
  assert.ok(arrivals[1] >= 63 && arrivals[1] <= 75.1);
  assert.equal(encounters.stalkers.length, 2);
});

test("either creature can hold you, with one death and shared protection after escape", () => {
  for (const holder of [0, 1]) {
    for (const fps of [30, 60, 144]) {
      const encounters = new Encounters(1, openWorld());
      const input = { view: view(), playerSpeed: 0 };
      encounters.stalkers[holder].stage({ x: 22, z: 21.05 }, input.view.position, true);
      for (let i = 0; i < fps / 10; i++) encounters.update(1 / fps, input, () => {});
      assert.equal(encounters.attacker, encounters.stalkers[holder]);
      encounters.stalkers[1 - holder].stage({ x: 22.95, z: 22 }, input.view.position, true);
      for (let i = 0; i < fps; i++) encounters.update(1 / fps, input, () => {});
      assert.equal(encounters.stalkers.filter((stalker) => stalker.attacking).length, 1);
      assert.equal(encounters.escape(), true);
      for (let i = 0; i < fps * 2.8; i++) {
        encounters.update(1 / fps, input, () => {});
        assert.equal(encounters.attacking, false, "both creatures honor the escape window");
      }
      let deaths = 0;
      for (let i = 0; i < fps * 8; i++) deaths += Number(encounters.update(1 / fps, input, () => {}));
      assert.equal(deaths, 1);
      assert.equal(encounters.attacker?.phase, "dead");
      encounters.reset();
      assert.equal(encounters.present, false);
      assert.equal(encounters.attackTime, 0);
    }
  }
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
  assert.equal(a.stalker.heading, b.stalker.heading);
  assert.ok(Math.abs(a.stalker.renderHeading - b.stalker.renderHeading) < 1e-8);
  assert.equal(stepsA, stepsB);
  a.stalker.reset();
  for (let i = 0; i < 440; i++)
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
  for (const seed of [199307, 42069, 7, 1, 2, 42]) {
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
        if (!arrived) assert.ok(i / 10 <= 35, `tape ${seed} gets its first arrival within 35 seconds`);
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


test("rendered creature turns interpolate between fixed steps and stage without a spin", () => {
  const stalker = new Stalker(1, openWorld());
  const input = { view: view(28, 20), playerSpeed: 0, canGrab: false };
  stalker.stage({ x: 20, z: 20 }, { x: 20, z: 28 }, true);
  assert.equal(stalker.renderHeading, stalker.heading, "staging snaps to the new intended heading");
  // The new player bearing forces a real navigation turn on the next simulation tick.
  stalker.update(1 / 30, input, () => {});
  const before = stalker.renderHeading;
  const next = stalker.heading;
  assert.ok(Math.abs(next - before) > 0.01, "fixture exercises an actual turn");
  stalker.update(1 / 120, input, () => {});
  const quarter = stalker.renderHeading;
  stalker.update(1 / 120, input, () => {});
  const halfway = stalker.renderHeading;
  assert.equal(stalker.heading, next, "render samples do not change simulation state");
  assert.ok(Math.abs(quarter - (before + (next - before) * 0.25)) < 1e-8);
  assert.ok(Math.abs(halfway - (before + (next - before) * 0.5)) < 1e-8);
  assert.notEqual(quarter, halfway, "high-refresh frames get distinct visible headings");
  stalker.stage({ x: 20, z: 20 }, { x: 20, z: 10 }, true);
  assert.equal(stalker.renderHeading, stalker.heading, "new encounter does not interpolate from the old one");
  // Headings on either side of the signed-angle seam represent nearby bearings.
  const seam = new Stalker(1, openWorld());
  seam.stage({ x: 20, z: 20 }, { x: 20.001, z: 10 }, true);
  seam.heading = -Math.PI + 0.0001;
  seam.update(1 / 60, input, () => {});
  assert.ok(Math.abs(seam.renderHeading - Math.PI) < 0.001, "turn crosses the angle seam without a full spin");
});
