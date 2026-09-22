import assert from "node:assert/strict";
import test from "node:test";
import { PropSoundGate, propSoundSamples } from "../src/lib/game/prop-sounds";

test("prop foley ignores spawn settling, resting jitter, and airborne movement", () => {
  const gate = new PropSoundGate();
  assert.equal(gate.sample(0.1, 1, 1, true), null);
  for (let i = 0; i < 120; i++) assert.equal(gate.sample(1 / 60, 0.05, 0.1, true), null);
  for (let i = 0; i < 120; i++) assert.equal(gate.sample(1 / 60, 2, 0, false), null);
  assert.equal(gate.sample(1 / 60, 0, 1.5, true)?.kind, "impact", "landing contact sounds even without sliding");
});

test("scraping and repeated impact contacts have bounded cadence and strength", () => {
  const gate = new PropSoundGate(); gate.sample(0.5, 0, 0, false);
  let scrapes = 0, impacts = 0;
  for (let i = 0; i < 120; i++) {
    const event = gate.sample(1 / 120, 2, 0, true);
    if (event) { scrapes++; assert.ok(event.strength <= 1); }
  }
  assert.ok(scrapes >= 4 && scrapes <= 6);
  for (let i = 0; i < 120; i++) {
    const event = gate.sample(1 / 120, 0, 20, true);
    if (event) { impacts++; assert.equal(event.kind, "impact"); assert.equal(event.strength, 1); }
  }
  assert.ok(impacts >= 4 && impacts <= 5);
});

test("all material foley is short, finite, repeatable, and fades to silence", () => {
  for (const kind of ["scrape", "impact"] as const)
    for (const material of ["wood", "metal", "plastic", "cardboard"] as const)
      for (const sampleRate of [44100, 48000]) {
        const samples = propSoundSamples(kind, material, sampleRate);
        assert.deepEqual(samples, propSoundSamples(kind, material, sampleRate));
        assert.ok(samples.length <= sampleRate * 0.25);
        assert.ok(samples.every(x => Number.isFinite(x) && Math.abs(x) < 0.9));
        assert.ok(Math.abs(samples[0]) < 0.000001 && Math.abs(samples.at(-1)!) < 0.000001);
        const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        assert.ok(rms > 0.01 && rms < 0.2);
      }
});
