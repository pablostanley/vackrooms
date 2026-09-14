import assert from "node:assert/strict";
import test from "node:test";
import { GamepadInput, PAD, stick } from "../src/lib/game/gamepad";

function pad(buttons: number[] = [], axes = [0, 0, 0, 0], index = 0) {
  return {
    index, id: `Controller ${index}`, connected: true, mapping: "standard" as GamepadMappingType, axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index), value: buttons.includes(index) ? 1 : 0, touched: false })),
  };
}

test("radial dead zone rejects drift and preserves bounded analog speed and direction", () => {
  assert.deepEqual(stick(0.1, -0.1), { x: 0, y: 0 });
  assert.deepEqual(stick(NaN, Infinity), { x: 0, y: 0 });
  const half = stick(0.59, 0);
  assert.ok(Math.abs(half.x - 0.5) < 1e-10);
  const diagonal = stick(1, -1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
  assert.equal(diagonal.x, -diagonal.y);
});

test("button actions fire once per press while run and interact remain held", () => {
  const input = new GamepadInput();
  input.read([pad()]);
  const buttons = [PAD.menu, PAD.light, PAD.interact, PAD.run];
  assert.deepEqual([...input.read([pad(buttons)]).pressed], buttons.toSorted((a, b) => a - b));
  const held = input.read([pad(buttons)]);
  assert.equal(held.pressed.size, 0);
  assert.equal(held.held.size, 4);
  input.read([pad()]);
  assert.ok(input.read([pad([PAD.menu])]).pressed.has(PAD.menu));
});

test("connection, pause and focus loss require neutral controls before resuming input", () => {
  const input = new GamepadInput();
  assert.equal(input.read([pad([PAD.menu])]).pressed.size, 0);
  input.read([pad()]);
  assert.ok(input.read([pad([PAD.menu])]).pressed.has(PAD.menu));
  input.suspend();
  assert.equal(input.read([pad([PAD.menu])]).pressed.size, 0);
  assert.deepEqual(input.read([pad([], [0, -1, 1, 0])]).move, { x: 0, y: 0 });
  input.read([pad()]);
  assert.equal(input.read([pad([], [0, -1, 1, 0])]).move.y, -1);
  assert.equal(input.read([pad([PAD.light])], false).pressed.size, 0);
  assert.equal(input.read([pad([PAD.light])]).pressed.size, 0);
  input.read([pad()]);
  assert.ok(input.read([pad([PAD.light])]).pressed.has(PAD.light));
});

test("D-pad repeats after a delay without repeating flashlight or pause", () => {
  const input = new GamepadInput();
  input.read([pad()], true, 0);
  const held = pad([PAD.right, PAD.menu, PAD.light]);
  assert.equal(input.read([held], true, 10).pressed.size, 3);
  assert.equal(input.read([held], true, 409).pressed.size, 0);
  assert.deepEqual([...input.read([held], true, 410).pressed], [PAD.right]);
  assert.deepEqual([...input.read([held], true, 500).pressed], [PAD.right]);
  input.read([pad()], true, 510);
  assert.ok(input.read([held], true, 520).pressed.has(PAD.right));
});

test("disconnect clears held input immediately and reconnection cannot replay an action", () => {
  const input = new GamepadInput();
  input.read([pad()]);
  input.read([pad([PAD.run, PAD.interact], [0, -1, 0, 0])]);
  const disconnected = input.read([null]);
  assert.equal(disconnected.disconnected, true);
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.held.size, 0);
  assert.deepEqual(disconnected.move, { x: 0, y: 0 });
  assert.equal(input.read([]).disconnected, false);
  assert.equal(input.read([pad([PAD.interact])]).pressed.size, 0);
});

test("sparse slots and multiple controllers keep one owner; unknown mappings are ignored", () => {
  const input = new GamepadInput();
  assert.equal(input.read([null, pad([], undefined, 1)]).connected, true);
  const frame = input.read([pad([PAD.light]), pad([PAD.interact], undefined, 1)]);
  assert.ok(frame.pressed.has(PAD.interact));
  assert.ok(!frame.pressed.has(PAD.light));
  assert.equal(input.read([pad([PAD.light])]).disconnected, true);
  assert.equal(input.read([{ ...pad(), mapping: "" }]).connected, false);
});
