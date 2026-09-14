import assert from "node:assert/strict";
import test from "node:test";
import { Box3, Vector3 } from "three";
import { CharacterMotor } from "../src/lib/game/physics";
import { CHUNK, generateChunk, poolBounds } from "../src/lib/game/maze";
import { buildSection } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";

const DT = 1 / 60;
function openRoom(height = 6.8) {
  const data = generateChunk(0, 0, 1);
  data.cells.fill(15);
  data.landmark = { kind: "lobby", x: 0, z: 0, width: CHUNK, length: CHUNK, height };
  return data;
}
async function setup(height = 6.8, obstacles: Box3[] = []) {
  const position = new Vector3(12, 1.66, 12);
  const motor = await CharacterMotor.create(position);
  motor.addSection("0,0", openRoom(height), obstacles);
  for (let i = 0; i < 5; i++) motor.move(0, 0, DT, position);
  return { motor, position };
}

test("Space jumps immediately; a second press boosts once and landing rearms it", async () => {
  const { motor, position } = await setup();
  try {
    const floor = position.y;
    motor.jump();
    motor.move(0, 0, DT, position);
    assert.ok(position.y > floor + 0.07);
    assert.equal(motor.grounded, false);
    let singlePeak = position.y;
    for (let i = 0; i < 90; i++) {
      motor.move(0, 0, DT, position);
      singlePeak = Math.max(singlePeak, position.y);
    }
    assert.ok(singlePeak - floor > 0.8 && singlePeak - floor < 0.95);
    assert.ok(motor.grounded && Math.abs(position.y - floor) < 0.01);
    motor.jump();
    motor.move(0, 0, DT, position);
    motor.jump();
    let doublePeak = position.y;
    for (let i = 0; i < 100; i++) {
      if (i === 10) motor.jump(); // An extra press must not create a third jump.
      motor.move(0, 0, DT, position);
      doublePeak = Math.max(doublePeak, position.y);
    }
    assert.ok(doublePeak - floor > 2 && doublePeak - floor < 2.4);
    assert.ok(motor.grounded && Math.abs(position.y - floor) < 0.01);
  } finally { motor.dispose(); }
});

test("two taps in one frame survive, with consistent height at 30/60/144Hz", async () => {
  const peaks: number[] = [];
  for (const hz of [30, 60, 144]) {
    const { motor, position } = await setup();
    try {
      const floor = position.y;
      motor.jump();
      motor.jump();
      let peak = floor;
      for (let i = 0; i < hz * 2; i++) {
        motor.move(0, 0, 1 / hz, position);
        peak = Math.max(peak, position.y);
      }
      peaks.push(peak - floor);
      assert.ok(peak - floor > 2);
      assert.ok(motor.grounded);
    } finally { motor.dispose(); }
  }
  assert.ok(Math.max(...peaks) - Math.min(...peaks) < 0.02);
});

test("ceiling contact ends ascent and walls still block airborne movement", async () => {
  const wall = new Box3(new Vector3(13, 0, 9), new Vector3(13.2, 3.15, 15));
  const { motor, position } = await setup(3.15, [wall]);
  try {
    motor.jump(); motor.jump();
    let peak = position.y;
    for (let i = 0; i < 60; i++) {
      motor.move(0.04, 0, DT, position);
      peak = Math.max(peak, position.y);
    }
    assert.ok(peak < 3.05, `head stays below ceiling: ${peak}`);
    assert.ok(position.x < 12.8, `wall still blocks jump: ${position.x}`);
    assert.ok(motor.grounded, "head bump falls back without hovering");
  } finally { motor.dispose(); }
});

test("landing buffers a late press and clearing input cancels it", async () => {
  for (const cancel of [false, true]) {
    const { motor, position } = await setup();
    try {
      const floor = position.y;
      motor.jump(); motor.jump();
      let previous = floor;
      for (let i = 0; i < 120; i++) {
        motor.move(0, 0, DT, position);
        if (position.y < previous && position.y < floor + 0.15) break;
        previous = position.y;
      }
      assert.equal(motor.grounded, false);
      motor.jump();
      if (cancel) motor.clearJumpInput();
      for (let i = 0; i < 10; i++) motor.move(0, 0, DT, position);
      assert.equal(position.y > floor + 0.3, !cancel);
    } finally { motor.dispose(); }
  }
});

test("a brief step off a ledge retains the normal jump; teleport clears airborne state", async () => {
  const platform = new Box3(new Vector3(11, 0, 11), new Vector3(13, 0.55, 13));
  const { motor, position } = await setup();
  try {
    motor.jump();
    for (let i = 0; i < 15; i++) motor.move(0, 0, DT, position);
    motor.addSection("0,0", openRoom(), [platform]);
    for (let i = 0; i < 60; i++) motor.move(0, 0, DT, position);
    assert.ok(motor.grounded && position.y > 2.1);
    for (let i = 0; i < 40 && motor.grounded; i++) motor.move(0.06, 0, DT, position);
    assert.equal(motor.grounded, false);
    const ledge = position.y;
    motor.jump();
    motor.move(0, 0, DT, position);
    assert.ok(position.y > ledge + 0.06 && position.y < ledge + 0.11);
    motor.jump();
    motor.teleport({ x: 16, z: 12 });
    for (let i = 0; i < 10; i++) motor.move(0, 0, DT, position);
    assert.ok(motor.grounded && position.y < 1.7);
  } finally { motor.dispose(); }
});

test("the opening chair supports its seat and allows walking off", async () => {
  const data = generateChunk(0, 0, 199307);
  const mats = headlessMaterials();
  const section = buildSection(data, mats, 0);
  // The deliberately placed opening chair faces slightly left of -Z.
  // Leave room for the capsule's shoulders in front of the solid backrest.
  const x = 4.8 * 3.5 + 1.4 - Math.sin(0.5) * 0.13;
  const z = 4.8 * 2.5 + 1.4 - Math.cos(0.5) * 0.13;
  const position = new Vector3(x - 0.48, 1.66, z - 0.88);
  const motor = await CharacterMotor.create(position);
  try {
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    for (let i = 0; i < 5; i++) motor.move(0, 0, DT, position);
    motor.jump();
    for (let i = 0; i < 22; i++) motor.move(0.48 / 22, 0.88 / 22, DT, position);
    for (let i = 0; i < 60; i++) motor.move(0, 0, DT, position);
    assert.ok(motor.grounded, "seat is stable");
    assert.ok(position.y > 2.15 && position.y < 2.25, `stood on cushion, not air: ${position.y}`);
    for (let i = 0; i < 60; i++) motor.move(-0.02, -0.036, DT, position);
    assert.ok(motor.grounded && position.y < 1.7);
  } finally { motor.dispose(); section.dispose(); mats.dispose(); }
});

test("jump onto pool coping, enter the basin, then double jump back to the dry deck", async () => {
  const data = generateChunk(0, 0, 2), basin = poolBounds(data.landmark)!;
  const mats = headlessMaterials(), section = buildSection(data, mats, 0);
  const position = new Vector3(basin.x - 0.8, 1.66, basin.z + basin.length / 2);
  const motor = await CharacterMotor.create(position);
  try {
    motor.addSection("0,0", data, section.colliders, section.shapedColliders);
    for (let i = 0; i < 5; i++) motor.move(0, 0, DT, position);
    motor.jump();
    for (let i = 0; i < 22; i++) motor.move(0.8 / 22, 0, DT, position);
    for (let i = 0; i < 60; i++) motor.move(0, 0, DT, position);
    assert.ok(motor.grounded && position.y > 2.05 && position.y < 2.15, `on coping: ${position.y}`);
    for (let i = 0; i < 35; i++) motor.move(0.035, 0, DT, position);
    for (let i = 0; i < 60; i++) motor.move(0, 0, DT, position);
    assert.ok(motor.grounded && position.y < 0.3, "landed in the basin");
    motor.jump(); motor.jump();
    for (let i = 0; i < 85; i++) motor.move(-0.04, 0, DT, position);
    assert.ok(position.x < basin.x - 0.4, "escaped the raised rim");
    assert.ok(motor.grounded && position.y > 1.6 && position.y < 1.7);
  } finally { motor.dispose(); section.dispose(); mats.dispose(); }
});
