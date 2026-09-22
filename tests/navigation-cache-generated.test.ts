import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { EntityNavigation } from "../src/lib/game/entity-navigation";
import { generateChunk } from "../src/lib/game/maze";
import { buildSection, type Section } from "../src/lib/game/world";
import { headlessMaterials } from "./helpers/materials";
import { Stalker } from "../src/lib/game/stalker";

test("real tape preserves pursuing behavior while only the first identical failure searches", () => {
  const materials = headlessMaterials();
  const navigation = new EntityNavigation();
  const sections: Section[] = [];
  try {
    for (let z = -1; z <= 1; z++) {
      for (let x = -1; x <= 1; x++) {
        const data = generateChunk(x, z, 48);
        const section = buildSection(data, materials, 0);
        sections.push(section);
        navigation.addSection(`${x},${z}`, data, section.colliders);
      }
    }
    const player = { x: -2.4, y: 1.66, z: 60 };
    const input = {
      view: {
        position: player,
        forward: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
        fov: 68,
        aspect: 16 / 9,
      },
      playerSpeed: 4,
      canGrab: false,
    };
    const stalker = new Stalker(48, navigation);
    stalker.stage({ x: 2.4, z: 55.2 }, player, true);
    const originalRoute = navigation.route.bind(navigation);
    const originalClearSegment = navigation.clearSegment.bind(navigation);
    let requests = 0, segmentChecks = 0, searches = 0, footsteps = 0;
    navigation.clearSegment = (from, to) => {
      segmentChecks++;
      return originalClearSegment(from, to);
    };
    navigation.route = (from, to) => {
      const previousChecks = segmentChecks;
      const path = originalRoute(from, to);
      if (segmentChecks > previousChecks) searches++;
      requests++;
      return path;
    };
    const trace = createHash("sha256");
    for (let frame = 0; frame < 900; frame++) {
      stalker.update(1 / 30, input, () => footsteps++);
      trace.update(JSON.stringify([
        stalker.phase,
        stalker.position.toArray(),
        stalker.gait,
        stalker.heading,
        stalker.speed,
      ]));
    }
    assert.equal(requests, 33);
    assert.equal(searches, 1);
    assert.equal(footsteps, 0);
    // Captured from the same real tape simulation before failure caching.
    assert.equal(
      trace.digest("hex"),
      "066a8605f2e5e816597f77edd7b4858a4c4b0ec413979d0f5675768786c08a66",
    );
  } finally {
    for (const section of sections) section.dispose();
    navigation.clear();
    materials.dispose();
  }
});
