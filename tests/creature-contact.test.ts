import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { CharacterMotor } from "../src/lib/game/physics";
import { EntityNavigation, ENTITY_RADIUS, type GroundPoint } from "../src/lib/game/entity-navigation";
import { Stalker } from "../src/lib/game/stalker";
import { CELL, CHUNK, N, W, PLAYER_RADIUS, generateChunk } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { createFurniture } from "../src/lib/game/furniture-models";
import { headlessMaterials } from "./helpers/materials";

function contact(nav: EntityNavigation, player: Vector3, start: GroundPoint) {
  const stalker = new Stalker(1, nav);
  stalker.stage(start, player, true);
  stalker.update(1 / 30, {
    view: {
      position: player, forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 }, fov: 68, aspect: 16 / 9,
    },
    playerSpeed: 0,
  }, () => {});
  return stalker;
}

function verifyCloseContact(nav: EntityNavigation, player: Vector3, start: GroundPoint) {
  assert.ok(nav.canOccupy(start), "creature starts in a legal position");
  assert.equal(nav.canOccupy(player), false, "player center cannot hold the larger creature");
  assert.equal(nav.clearSegment(start, player), false, "movement retains creature clearance");
  assert.equal(nav.clearSegment(start, player, ENTITY_RADIUS), false);
  assert.ok(nav.sight({ ...start, y: 1.45 }, player));
  assert.ok(nav.clearSegment(start, player, PLAYER_RADIUS), "reach fits the actual player capsule");
  const stalker = contact(nav, player, start);
  assert.equal(stalker.phase, "grabbing");
  assert.ok(nav.canOccupy(stalker.position), "grabbing never moves the creature into the player/wall");
}

test("a real Rapier player pressed against a generated wall can still be grabbed", async () => {
  const mats = headlessMaterials();
  const data = generateChunk(0, 0, 1), section = buildSection(data, mats, 0);
  const nav = new EntityNavigation(), position = new Vector3();
  const motor = await CharacterMotor.create({ x: 16.8, z: 5.7 });
  try {
    nav.addSection("0,0", data, section.colliders);
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    assert.equal(data.cells[CHUNK + 3] & N, 0);
    for (let i = 0; i < 120; i++) motor.move(0, -0.025, 1 / 60, position);
    assert.ok(motor.grounded);
    assert.ok(Math.abs(position.z - 5.125) < 0.001);
    verifyCloseContact(nav, position, { x: position.x, z: position.z + 0.8 });
  } finally {
    motor.dispose(); nav.clear(); section.dispose(); mats.dispose();
  }
});

test("real Rapier corner contact does not require a creature-sized player center", async () => {
  const mats = headlessMaterials();
  const data = generateChunk(0, 0, 1), section = buildSection(data, mats, 0);
  const nav = new EntityNavigation();
  nav.addSection("0,0", data, section.colliders);
  let corner: GroundPoint | undefined;
  for (let z = 1; z < CHUNK - 1 && !corner; z++)
    for (let x = 1; x < CHUNK - 1; x++) {
      if (data.cells[z * CHUNK + x] & (N | W)) continue;
      const point = { x: x * CELL + 1, z: z * CELL + 1 };
      if (nav.canOccupy(point)) { corner = point; break; }
    }
  assert.ok(corner, "fixture contains a clear closed corner");
  const motor = await CharacterMotor.create(corner), position = new Vector3();
  try {
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    for (let i = 0; i < 120; i++) motor.move(-0.025, -0.025, 1 / 60, position);
    assert.ok(motor.grounded);
    verifyCloseContact(nav, position, { x: position.x + 0.65, z: position.z + 0.65 });
  } finally {
    motor.dispose(); nav.clear(); section.dispose(); mats.dispose();
  }
});

function openRoom() {
  const data = generateChunk(0, 0, 1);
  data.cells.fill(15);
  data.landmark = { kind: "lobby", x: 0, z: 0, width: CHUNK, length: CHUNK, height: 3.15 };
  return data;
}

test("standing flush beside a solid filing cabinet remains reachable", async () => {
  const mats = headlessMaterials(), cabinet = createFurniture("filingCabinet", mats);
  const bounds = cabinet.bounds.clone().translate(new Vector3(20, 0, 20));
  const data = openRoom(), nav = new EntityNavigation(), position = new Vector3();
  const z = (bounds.min.z + bounds.max.z) / 2;
  const motor = await CharacterMotor.create({ x: bounds.max.x + 0.9, z });
  try {
    nav.addSection("0,0", data, [bounds]);
    motor.addSection("0,0", data, [bounds]);
    for (let i = 0; i < 120; i++) motor.move(-0.025, 0, 1 / 60, position);
    assert.ok(motor.grounded);
    assert.ok(Math.abs(position.x - bounds.max.x - 0.235) < 0.001);
    verifyCloseContact(nav, position, { x: position.x + 0.8, z });
  } finally {
    motor.dispose(); nav.clear(); cabinet.parts.forEach(({ geometry }) => geometry.dispose()); mats.dispose();
  }
});

test("reach still rejects walls, low desks, solid props, corner obstructions and elevation", () => {
  const fixtures = [
    { name: "thin wall", box: new Box3(new Vector3(10, 0, 12), new Vector3(14, 3.15, 12.025)), start: { x: 12, z: 11.6 }, player: new Vector3(12, 1.66, 12.5), bodyVisible: false },
    { name: "low desk", box: new Box3(new Vector3(10, 0, 12), new Vector3(14, 1.1, 12.025)), start: { x: 12, z: 11.6 }, player: new Vector3(12, 1.66, 12.5), bodyVisible: true },
    { name: "solid prop", box: new Box3(new Vector3(11.5, 0, 12), new Vector3(12.5, 2, 12.15)), start: { x: 12, z: 11.6 }, player: new Vector3(12, 1.66, 12.6), bodyVisible: false },
    { name: "diagonal corner", box: new Box3(new Vector3(12, 0, 12), new Vector3(13, 3.15, 13)), start: { x: 11.5, z: 12.1 }, player: new Vector3(12.1, 1.66, 11.7), bodyVisible: true },
  ];
  for (const fixture of fixtures) {
    const nav = new EntityNavigation();
    try {
      nav.addSection("0,0", openRoom(), [fixture.box]);
      assert.ok(nav.canOccupy(fixture.start), fixture.name);
      assert.equal(nav.sight({ ...fixture.start, y: 1.45 }, fixture.player), fixture.bodyVisible, fixture.name);
      assert.equal(nav.clearSegment(fixture.start, fixture.player, PLAYER_RADIUS), false, fixture.name);
      assert.equal(contact(nav, fixture.player, fixture.start).attacking, false, fixture.name);
    } finally { nav.clear(); }
  }
  const nav = new EntityNavigation();
  try {
    nav.addSection("0,0", openRoom(), []);
    for (const y of [0.2, 0.4, 2.7, 3.4])
      assert.equal(contact(nav, new Vector3(12, y, 12), { x: 12, z: 11.2 }).attacking, false, `eye height ${y}`);
  } finally { nav.clear(); }
});
