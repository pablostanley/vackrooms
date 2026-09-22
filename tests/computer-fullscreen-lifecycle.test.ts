import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import * as THREE from "three";
import type { BackroomsEngine as Engine } from "../src/lib/game/engine";

// The engine methods under test are real. Only GPU module loading is stubbed:
// Node cannot load the browser's bundled WGSL imports, and no renderer is built.
const require = createRequire(import.meta.url);
const gpuModules = ["../src/lib/game/renderer.ts", "../src/lib/game/computer-crt.ts"];
const previous = gpuModules.map((path) => {
  const id = require.resolve(path);
  const cached = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: {} } as NodeModule;
  return { id, cached };
});
let BackroomsEngine: typeof Engine;
try {
  ({ BackroomsEngine } = require("../src/lib/game/engine.ts"));
} finally {
  for (const { id, cached } of previous) {
    if (cached) require.cache[id] = cached;
    else delete require.cache[id];
  }
}

async function scenario(
  outcome: "resolve" | "reject",
  action: "none" | "dispose" | "leave" | "replace",
) {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const events: string[] = [];
  const station = {};
  const surface = { requestFullscreen: () => pending };
  const documentStub = {
    fullscreenElement: null as unknown,
    pointerLockElement: null,
    exitFullscreen: async () => {
      events.push("exit-fullscreen");
      documentStub.fullscreenElement = null;
    },
  };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: () => {} });
  const noop = () => {};
  const engine = Object.assign(Object.create(BackroomsEngine.prototype), {
    alive: true, active: true, focusedComputer: null, encounters: { attacking: false },
    camera: new THREE.PerspectiveCamera(), container: { parentElement: surface },
    computerScreens: {
      nearest: station, isPowered: () => false,
      focus: () => events.push("focus"), useButtonToExit: () => events.push("fallback"),
      dispose: () => events.push("dispose-ui"), leave: () => events.push("leave-ui"),
    },
    keys: new Set(), gamepad: { suspend: noop }, listeners: { abort: noop },
    resizeObserver: { disconnect: noop }, audio: { dispose: noop, stopComputer: noop },
    sections: new Map(), entities: [], lights: [],
    entityMaterial: { dispose: noop }, materials: { dispose: noop },
  }) as Engine;
  try {
    engine.useComputer();
    if (action === "dispose") engine.dispose();
    if (action === "leave") engine.leaveComputer(false);
    if (action === "replace") Object.assign(engine, { focusedComputer: {} });
    if (outcome === "resolve") {
      documentStub.fullscreenElement = surface;
      resolve();
    } else reject(new Error("Fullscreen denied"));
    await pending.catch(noop);
    await Promise.resolve();
    return events;
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (oldCancel) Object.defineProperty(globalThis, "cancelAnimationFrame", oldCancel);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  }
}

test("pending fullscreen success after real engine disposal exits without reviving UI", async () => {
  assert.deepEqual(await scenario("resolve", "dispose"), ["dispose-ui", "exit-fullscreen"]);
});
test("pending fullscreen rejection after disposal does not focus or show fallback UI", async () => {
  assert.deepEqual(await scenario("reject", "dispose"), ["dispose-ui"]);
});
test("live fullscreen success and denied-fullscreen fallback retain normal focus", async () => {
  assert.deepEqual(await scenario("resolve", "none"), ["focus"]);
  assert.deepEqual(await scenario("reject", "none"), ["focus", "fallback"]);
});
test("leaving before settlement cleans late fullscreen without reopening the station", async () => {
  assert.deepEqual(await scenario("resolve", "leave"), ["leave-ui", "exit-fullscreen"]);
  assert.deepEqual(await scenario("reject", "leave"), ["leave-ui"]);
});
test("a superseded station cannot receive either fullscreen continuation", async () => {
  assert.deepEqual(await scenario("resolve", "replace"), []);
  assert.deepEqual(await scenario("reject", "replace"), []);
});
