import assert from "node:assert/strict";
import test from "node:test";
import { dropletSamples, lappingSamples } from "../src/lib/game/pool-audio";
import { RIPPLE_LIFETIME, WATER_RIPPLES, WaterRipples } from "../src/lib/game/water-ripples";

test("ripples reuse expired slots first and never grow past the shader's slot count", () => {
  const ripples = new WaterRipples();
  ripples.update(10);
  for (let i = 0; i < WATER_RIPPLES * 5; i++) ripples.add(i, -i, 1);
  assert.equal(ripples.slots.length, WATER_RIPPLES);
  // The newest wake survives a burst; the oldest rings are overwritten.
  assert.ok(ripples.slots.some((slot) => slot.x === WATER_RIPPLES * 5 - 1));
  assert.ok(!ripples.slots.some((slot) => slot.x === 0));
  ripples.update(10 + RIPPLE_LIFETIME + 1);
  ripples.add(99, 99, 0.5);
  // The slot the round-robin would pick next is expired, but so is every
  // slot; the first expired one is reused, stamped with the current time.
  const fresh = ripples.slots.find((slot) => slot.x === 99)!;
  assert.equal(fresh.z, 10 + RIPPLE_LIFETIME + 1);
  assert.equal(fresh.w, 0.5);
});

test("ripples ignore silent or invalid drops and clear when the clock rewinds", () => {
  const ripples = new WaterRipples();
  ripples.update(4);
  ripples.add(1, 1, 0);
  ripples.add(Number.NaN, 1, 1);
  ripples.add(1, 1, -2);
  assert.ok(ripples.slots.every((slot) => slot.w === 0));
  ripples.add(2, 3, 9);
  assert.equal(ripples.slots.find((slot) => slot.w > 0)!.w, 3);
  ripples.update(1);
  assert.ok(ripples.slots.every((slot) => slot.w === 0));
});

test("droplets are short, bounded, repeatable plinks with rising pitch", () => {
  for (const radius of [0.0014, 0.003, 0.0042]) {
    const samples = dropletSamples(48000, radius, 7);
    assert.deepEqual(samples, dropletSamples(48000, radius, 7));
    assert.ok(samples.length > 48000 * 0.01 && samples.length <= 48000 * 0.4);
    assert.ok(samples.every((s) => Number.isFinite(s) && Math.abs(s) <= 1));
    const peak = Math.max(...samples.map(Math.abs));
    assert.ok(Math.abs(samples.at(-1)!) < peak * 0.01, "decays to silence");
    // Zero crossings per sample rise from the first to the second quarter.
    const crossings = (from: number, to: number) => {
      let count = 0;
      for (let i = from + 1; i < to; i++) if (Math.sign(samples[i]) !== Math.sign(samples[i - 1])) count++;
      return count / (to - from);
    };
    const quarter = Math.floor(samples.length / 4);
    assert.ok(crossings(quarter, quarter * 2) > crossings(64, quarter));
  }
  // Smaller bubbles ring higher.
  const small = dropletSamples(48000, 0.0014, 1), large = dropletSamples(48000, 0.0042, 1);
  assert.ok(small.length < large.length);
});

test("lapping loops seamlessly with audible swells and a stable level", () => {
  for (const sampleRate of [44100, 48000]) {
    const samples = lappingSamples(sampleRate, 17);
    assert.deepEqual(samples, lappingSamples(sampleRate, 17));
    assert.notDeepEqual(samples, lappingSamples(sampleRate, 18));
    assert.equal(samples.length, sampleRate * 8);
    assert.ok(samples.every((s) => Number.isFinite(s) && Math.abs(s) < 4));
    assert.ok(Math.abs(samples[0] - samples.at(-1)!) < 0.1);
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    assert.ok(Math.abs(rms - 0.22) < 0.01);
    // Quarter-second windows vary strongly: laps, then quiet gaps.
    const window = Math.round(sampleRate / 4), levels: number[] = [];
    for (let start = 0; start + window <= samples.length; start += window) {
      let sum = 0;
      for (let i = start; i < start + window; i++) sum += samples[i] * samples[i];
      levels.push(Math.sqrt(sum / window));
    }
    assert.ok(Math.max(...levels) > Math.min(...levels) * 3);
  }
});
