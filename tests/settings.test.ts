import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings, loadSettings, saveSettings, setVolume, toggleMute, SETTINGS_KEY } from "../src/lib/game/settings";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return () => ({
    getItem(key: string) { assert.equal(key, SETTINGS_KEY); return value; },
    setItem(key: string, next: string) { assert.equal(key, SETTINGS_KEY); value = next; },
  });
}

test("all preferences and the previous audible level survive a muted reload", () => {
  const storage = memoryStorage();
  const chosen = { ...setVolume(defaultSettings, 0.27), sensitivity: 1.8, tape: 0.12, reducedMotion: true };
  saveSettings(toggleMute(chosen), storage);
  const restored = loadSettings(false, storage);
  assert.deepEqual(restored, { ...chosen, volume: 0 });
  assert.deepEqual(toggleMute(restored), chosen);
  assert.deepEqual(toggleMute(toggleMute(chosen)), chosen);
});

test("setting the slider to zero remembers the last nonzero volume", () => {
  const chosen = setVolume(defaultSettings, 0.09);
  assert.equal(toggleMute(setVolume(chosen, 0)).volume, 0.09);
  const muted = toggleMute(chosen);
  assert.equal(toggleMute(toggleMute(setVolume(muted, 0.42))).volume, 0.42);
});

test("system comfort preference is the default, while an explicit saved false wins", () => {
  assert.equal(loadSettings(true, memoryStorage()).reducedMotion, true);
  assert.equal(loadSettings(true, memoryStorage('{"reducedMotion":false}')).reducedMotion, false);
  assert.equal(loadSettings(true, memoryStorage('{"reducedMotion":"false"}')).reducedMotion, true);
});

test("malformed storage, unavailable storage and quota failures never stop the game", () => {
  for (const value of ["{", "null", "false", "[]", "3", '"text"'])
    assert.deepEqual(loadSettings(false, memoryStorage(value)), defaultSettings);
  const blocked = () => { throw new Error("Storage blocked"); };
  assert.deepEqual(loadSettings(false, blocked), defaultSettings);
  assert.doesNotThrow(() => saveSettings(defaultSettings, blocked));
  assert.doesNotThrow(() => saveSettings(defaultSettings, () => ({ setItem() { throw new Error("Quota exceeded"); } })));
});

test("saved values are type checked and clamped without accepting unrelated fields", () => {
  assert.deepEqual(loadSettings(false, memoryStorage(JSON.stringify({
    volume: 3, lastVolume: "loud", tape: -1, sensitivity: 200, reducedMotion: true, seed: 123,
  }))), { volume: 1, lastVolume: 1, tape: 0, sensitivity: 2.5, reducedMotion: true });
  const invalid = loadSettings(false, memoryStorage('{"volume":"1","sensitivity":null,"tape":1e400}'));
  assert.deepEqual(invalid, defaultSettings);
});
