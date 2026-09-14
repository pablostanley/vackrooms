import assert from "node:assert/strict";
import test from "node:test";
import { splashSamples } from "../src/lib/game/footstep-splash";

test("splashes are seeded, short, finite, and fade to silence without clipping", () => {
  for (const rate of [44100, 48000]) {
    const samples = splashSamples(rate, 2);
    assert.deepEqual(samples, splashSamples(rate, 2));
    assert.notDeepEqual(samples, splashSamples(rate, 3));
    assert.ok(samples.length <= rate * 0.45);
    assert.equal(Math.abs(samples[0]), 0);
    assert.equal(Math.abs(samples.at(-1)!), 0);
    assert.ok(samples.every((value) => Number.isFinite(value) && Math.abs(value) < 1));
    assert.ok(samples.some((value) => Math.abs(value) > 0.1));
    const rms = (a: number, b: number) => {
      const range = samples.slice(Math.floor(a * rate), Math.floor(b * rate));
      return Math.sqrt(range.reduce((sum, n) => sum + n * n, 0) / range.length);
    };
    assert.ok(rms(0.02, 0.2) > rms(0.35, 0.44) * 10);
  }
});
