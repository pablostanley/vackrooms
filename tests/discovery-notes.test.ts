import assert from "node:assert/strict";
import test from "node:test";
import { createDiscoveryNotes } from "../src/lib/game/discovery-notes";

test("note lettering waits for Geist Mono and late font completion cannot revive disposed resources", async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const styleDescriptor = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  const lettering: { font: string; text: string }[] = [];
  let resolveFont!: (faces: unknown[]) => void;
  let fontPromise = new Promise<unknown[]>((resolve) => { resolveFont = resolve; });
  const fontRequests: string[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body: {},
    createElement: () => {
      const ctx = {
        font: "",
        fillStyle: "",
        fillRect() {},
        fillText(text: string) { lettering.push({ font: this.font, text }); },
      };
      return { width: 0, height: 0, getContext: () => ctx };
    },
    fonts: { load: (font: string) => { fontRequests.push(font); return fontPromise; } },
  } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => '"Geist Mono", "Geist Mono Fallback"' }) });
  try {
    const first = createDiscoveryNotes();
    assert.equal(lettering.length, 0);
    assert.deepEqual(fontRequests, ['24px "Geist Mono"']);
    resolveFont([{}]);
    await fontPromise;
    assert.equal(lettering.length, 15);
    assert.ok(lettering.every(({ font }) => font.endsWith('"Geist Mono"')));
    first.dispose();

    fontPromise = new Promise<unknown[]>((resolve) => { resolveFont = resolve; });
    const second = createDiscoveryNotes();
    const versions = second.materials.map((material) => material.map!.version);
    let disposed = 0;
    second.materials.forEach((material) => {
      material.addEventListener("dispose", () => disposed++);
      material.map!.addEventListener("dispose", () => disposed++);
    });
    second.dispose();
    assert.equal(disposed, 6, "all shared textures and materials released");
    resolveFont([{}]);
    await fontPromise;
    assert.equal(lettering.length, 15, "late completion draws nothing");
    assert.deepEqual(second.materials.map((material) => material.map!.version), versions);
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
    if (styleDescriptor) Object.defineProperty(globalThis, "getComputedStyle", styleDescriptor);
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  }
});
