import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_CHANNELS,
  fixtureLevel,
  fixturePhase,
  fixtureStrength,
  pickFixtureChannel,
} from "../src/lib/game/fixture-lighting";
import { contactShadowScale } from "../src/lib/game/contact-shadows";

test("fixtures reach zero before exchanging a shadow slot without brightness rank steps", () => {
  for (const edge of [5, 9, 12, 16, 25]) {
    assert.equal(fixtureStrength(0, edge), 1);
    assert.equal(fixtureStrength(edge, edge), 0);
    let previous = 1;
    for (let distance = 0; distance <= edge + 1; distance += 0.01) {
      const strength = fixtureStrength(distance, edge);
      assert.ok(strength >= 0 && strength <= previous);
      assert.ok(previous - strength < 0.01, "walking does not switch brightness tiers");
      previous = strength;
    }
  }
  assert.ok(fixtureStrength(11.99, 12) < 0.0001);
  assert.equal(fixtureStrength(12, 11.99), 0);
  assert.equal(fixtureStrength(17, Infinity), 0, "never illuminate beyond the actual light range");
});

test("ballast phases follow world fixtures independently of array rank", () => {
  const fixtures = [[12, 18], [-60, 20], [2.4, -2.4]];
  const original = fixtures.map(([x, z]) => fixturePhase(x, z));
  assert.deepEqual(fixtures.toReversed().map(([x, z]) => fixturePhase(x, z)).toReversed(), original);
  assert.equal(new Set(original).size, fixtures.length);
});

test("tube channels stay mostly bright, with rare dim and failing fixtures", () => {
  const counts = new Array(FIXTURE_CHANNELS.length).fill(0);
  const samples = 20000;
  for (let i = 0; i < samples; i++)
    counts[pickFixtureChannel((i * 0.618034) % 1, (i * 0.414214) % 1, false)]++;
  assert.ok(counts[0] / samples > 0.7, "most tubes keep the oppressive full brightness");
  const failing = counts.slice(3).reduce((a, b) => a + b, 0) / samples;
  assert.ok(failing > 0.08 && failing < 0.16);
  assert.ok(counts.every((count) => count > 0), "every channel appears");
  assert.ok(pickFixtureChannel(0.1, 0.5, true) >= 3, "a lone outage light often fails");
});

test("failing tubes go dark and strike back; reduced motion holds them steady", () => {
  for (let channel = 0; channel < FIXTURE_CHANNELS.length; channel++) {
    const { behavior, level } = FIXTURE_CHANNELS[channel];
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < 120; t += 1 / 60) {
      const value = fixtureLevel(channel, t);
      assert.ok(value >= 0 && value <= 1);
      assert.equal(fixtureLevel(channel, t), value, "deterministic in time");
      assert.equal(fixtureLevel(channel, t, true), level);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    if (behavior === "steady") assert.equal(min, max);
    else {
      assert.ok(min < 0.15, `${behavior} drops out`);
      assert.ok(max >= level * 0.95, `${behavior} returns to its level`);
    }
  }
});

test("contact shading stays within its pixel budget on retina, 4K, and mobile screens", () => {
  for (const [w, h] of [[1280, 720], [3840, 2160], [780, 1688], [5120, 1440], [1, 1]]) {
    const scale = contactShadowScale(w, h);
    assert.ok(scale > 0 && scale <= 0.5);
    assert.ok(w * h * scale ** 2 <= 960 * 540 + 0.001);
  }
});
