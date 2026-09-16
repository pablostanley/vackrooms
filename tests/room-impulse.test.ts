import assert from "node:assert/strict";
import test from "node:test";
import { roomImpulse } from "../src/lib/game/room-impulse";
import { ROOM_SOUNDS, type RoomSound } from "../src/lib/game/acoustics";

test("room responses are seeded, stereo, finite, and have no direct impulse", () => {
  for (const room of Object.keys(ROOM_SOUNDS) as RoomSound[]) {
    const channels = roomImpulse(room, 24000, 42);
    assert.deepEqual(channels, roomImpulse(room, 24000, 42));
    assert.notDeepEqual(channels[0], channels[1]);
    assert.notDeepEqual(channels, roomImpulse(room, 24000, 43));
    for (const channel of channels) {
      assert.equal(channel.length, Math.ceil(24000 * ROOM_SOUNDS[room].decay));
      assert.ok(channel.every(Number.isFinite));
      assert.ok(channel.slice(0, 240).every((sample) => sample === 0));
      const energy = (from: number, to: number) => channel.slice(from, to).reduce((sum, v) => sum + v * v, 0);
      assert.ok(energy(240, 2400) > energy(channel.length - 2400, channel.length));
    }
  }
});

test("pool and hall reflections arrive later than the small carpeted office", () => {
  const onset = (room: RoomSound) => roomImpulse(room, 48000, 42)[0].findIndex((sample) => sample !== 0) / 48000;
  assert.ok(onset("hall") > onset("office"));
  assert.ok(onset("pool") > onset("office"));
});

test("late reflections lose high-frequency energy as the room absorbs sound", () => {
  const sampleRate = 24000;
  for (const room of ["hall", "pool", "corridor"] as const) {
    const samples = roomImpulse(room, sampleRate, 42)[0];
    const brightness = (from: number, to: number) => {
      let difference = 0, energy = 0;
      for (let i = Math.floor(from * sampleRate); i < Math.floor(to * sampleRate); i++) {
        energy += samples[i] ** 2;
        difference += (samples[i] - samples[i - 1]) ** 2;
      }
      return difference / energy;
    };
    assert.ok(brightness(0.04, 0.12) > brightness(0.35, 0.55));
  }
});
