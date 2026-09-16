import assert from "node:assert/strict";
import test from "node:test";
import { fixturePhase, fixtureStrength } from "../src/lib/game/fixture-lighting";
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

test("contact shading stays within its pixel budget on retina, 4K, and mobile screens", () => {
  for (const [w, h] of [[1280, 720], [3840, 2160], [780, 1688], [5120, 1440], [1, 1]]) {
    const scale = contactShadowScale(w, h);
    assert.ok(scale > 0 && scale <= 0.5);
    assert.ok(w * h * scale ** 2 <= 960 * 540 + 0.001);
  }
});
