import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FOOTSTEP_RECORDINGS, RPG_RECORDINGS, WATER_RECORDINGS, footstepRecording, nextWaterRecording, RpgRecordings } from "../src/lib/game/rpg-recordings";
import { random } from "../src/lib/game/maze";

const recordingCount = Object.keys(RPG_RECORDINGS).length;

test("recorded footsteps follow surfaces, with water taking precedence over running", () => {
  assert.equal(FOOTSTEP_RECORDINGS[footstepRecording("carpet", false)].src, "/audio/kenney-rpg/footstep00.ogg");
  assert.equal(FOOTSTEP_RECORDINGS[footstepRecording("hard", false)].src, "/audio/kenney-rpg/footstep04.ogg");
  for (const running of [false, true])
    for (const [index, recording] of WATER_RECORDINGS.entries())
      assert.equal(footstepRecording("water", running, false, index), recording);
  for (const surface of ["carpet", "hard"] as const) {
    assert.equal(FOOTSTEP_RECORDINGS[footstepRecording(surface, true)].src, "/audio/kenney-rpg/footstep08.ogg");
    assert.equal(footstepRecording(surface, false, true), "heavy");
  }
});

test("water steps vary without consecutive repeats and remain seeded", () => {
  const sequence = () => {
    const rng = random(42), result: number[] = [];
    let previous = -1;
    for (let i = 0; i < 60; i++) {
      const next = nextWaterRecording(previous, rng);
      assert.notEqual(next, previous);
      assert.ok(next >= 0 && next < WATER_RECORDINGS.length);
      result.push(next);
      previous = next;
    }
    return result;
  };
  const steps = sequence();
  assert.equal(new Set(steps).size, 6);
  assert.deepEqual(sequence(), steps);
});

test("every selected recording ships as a real Ogg asset", () => {
  for (const { src } of Object.values(RPG_RECORDINGS)) {
    const bytes = readFileSync(new URL(`../public${src}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), "OggS");
    assert.ok(bytes.length > 1000 && bytes.length < 50000);
  }
});

test("simultaneous preloads share requests and keep decoded recordings cached", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(new ArrayBuffer(8)));
  let decodes = 0;
  const ctx = { decodeAudioData: async () => ({ duration: 0.3, index: decodes++ }) };
  const recordings = new RpgRecordings(ctx as unknown as BaseAudioContext);
  assert.equal(recordings.get("normal"), undefined);
  await Promise.all([recordings.preload(), recordings.preload()]);
  const normal = recordings.get("normal");
  assert.ok(normal);
  await recordings.preload();
  assert.equal(recordings.get("normal"), normal);
  assert.equal(fetch.mock.callCount(), recordingCount);
  assert.equal(decodes, recordingCount);
  assert.ok(recordings.get("flashlight") && recordings.get("creak1"));
  recordings.dispose();
  assert.equal(recordings.get("normal"), undefined);
});

test("failed recordings stay silent and can retry without reloading successful files", async (t) => {
  let fail = true;
  const fetch = t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) =>
    new Response(new ArrayBuffer(8), { status: fail && String(url).includes("water/step01") ? 503 : 200 }),
  );
  const ctx = { decodeAudioData: async () => ({ duration: 0.3 }) };
  const recordings = new RpgRecordings(ctx as unknown as BaseAudioContext);
  await recordings.preload();
  assert.equal(recordings.get("water"), undefined);
  assert.ok(recordings.get("normal"));
  fail = false;
  await recordings.preload();
  assert.ok(recordings.get("water"));
  assert.equal(fetch.mock.callCount(), recordingCount + 1);
  recordings.dispose();
});

test("disposal aborts loading and late decoding never repopulates the cache", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init!.signal!);
    return new Response(new ArrayBuffer(8));
  });
  let finish!: (buffer: AudioBuffer) => void;
  const decoding = new Promise<AudioBuffer>((resolve) => { finish = resolve; });
  const ctx = { decodeAudioData: () => decoding };
  const recordings = new RpgRecordings(ctx as unknown as BaseAudioContext);
  const loading = recordings.preload();
  recordings.dispose();
  finish({ duration: 0.3 } as AudioBuffer);
  await loading;
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(recordings.get("normal"), undefined);
  await recordings.preload();
  assert.equal(signals.length, recordingCount);
});
