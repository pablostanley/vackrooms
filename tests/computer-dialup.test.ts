import assert from "node:assert/strict";
import test from "node:test";
import { ComputerDialup, DIALUP_URL } from "../src/lib/game/computer-dialup";
import { InterfaceAudio, interfaceSamples } from "../src/lib/game/interface-audio";

function audioDouble() {
  const sources: Array<{
    onended: (() => void) | null;
    starts: number;
    stops: Array<number | undefined>;
    disconnected: boolean;
    buffer: unknown;
    connect: (node: unknown) => unknown;
    disconnect: () => void;
    start: () => void;
    stop: (when?: number) => void;
  }> = [];
  const levels: Array<{
    disconnected: boolean;
    ramp: number[];
    held: number[];
  }> = [];
  let buffers = 0;
  const ctx = {
    sampleRate: 44100,
    currentTime: 10,
    decodeAudioData: async () => {
      buffers++;
      return { duration: 8 } as AudioBuffer;
    },
    createBuffer: (_channels: number, length: number) => {
      buffers++;
      return { getChannelData: () => new Float32Array(length) };
    },
    createBufferSource: () => {
      const source = {
        onended: null as (() => void) | null,
        buffer: null as unknown,
        starts: 0,
        stops: [] as Array<number | undefined>,
        disconnected: false,
        connect: (node: unknown) => node,
        disconnect() {
          this.disconnected = true;
        },
        start() {
          this.starts++;
        },
        stop(when?: number) {
          this.stops.push(when);
        },
      };
      sources.push(source);
      return source;
    },
    createGain: () => {
      const state = {
        disconnected: false,
        ramp: [] as number[],
        held: [] as number[],
      };
      levels.push(state);
      return {
        gain: {
          cancelAndHoldAtTime: (time: number) => state.held.push(time),
          linearRampToValueAtTime: (value: number, time: number) => {
            state.ramp = [value, time];
          },
        },
        connect: (node: unknown) => node,
        disconnect: () => {
          state.disconnected = true;
        },
      };
    },
  };
  return {
    ctx: ctx as unknown as BaseAudioContext,
    sources,
    levels,
    buffers: () => buffers,
  };
}

test("re-entering replaces the voice and early exit fades then releases its nodes", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(new ArrayBuffer(8)));
  const audio = audioDouble();
  const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
  await sound.play();
  await sound.play();
  assert.equal(audio.sources.length, 2);
  assert.equal(audio.sources[0].starts, 1);
  assert.deepEqual(audio.sources[0].stops, [undefined]);
  assert.ok(audio.sources[0].disconnected && audio.levels[0].disconnected);
  assert.equal(audio.sources[0].onended, null);
  assert.equal(audio.buffers(), 1, "decode and reuse one recording buffer");
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[0], DIALUP_URL);
  sound.stop();
  assert.deepEqual(audio.levels[1].held, [10]);
  assert.deepEqual(audio.levels[1].ramp, [0, 10.06]);
  assert.deepEqual(audio.sources[1].stops, [10.06]);
  audio.sources[1].onended!();
  assert.ok(audio.sources[1].disconnected && audio.levels[1].disconnected);
  sound.dispose();
});

test("natural completion and disposal both disconnect the modem source and gain", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ArrayBuffer(8)));
  const audio = audioDouble();
  const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
  await sound.play();
  audio.sources[0].onended!();
  assert.ok(audio.sources[0].disconnected && audio.levels[0].disconnected);
  await sound.play();
  sound.dispose();
  assert.ok(audio.sources[1].disconnected && audio.levels[1].disconnected);
  assert.deepEqual(audio.sources[1].stops, [undefined]);
  assert.equal(audio.sources[1].onended, null);
});

test("leaving or disposing while the recording loads prevents late playback", async (t) => {
  for (const dispose of [false, true]) {
    let finish!: (value: Response) => void;
    t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
    const audio = audioDouble();
    const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
    const playing = sound.play();
    if (dispose) sound.dispose();
    else sound.stop();
    finish(new Response(new ArrayBuffer(8)));
    await playing;
    assert.equal(audio.sources.length, 0);
    sound.dispose();
    t.mock.restoreAll();
  }
});

test("rapid re-entry while loading starts only the newest request", async (t) => {
  let finish!: (value: Response) => void;
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { finish = resolve; }));
  const audio = audioDouble();
  const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
  const first = sound.play();
  const second = sound.play();
  finish(new Response(new ArrayBuffer(8)));
  await Promise.all([first, second]);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(audio.sources.length, 1);
  sound.dispose();
});

test("a failed recording load is silent and can retry on the next entry", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  const audio = audioDouble();
  const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
  await sound.play();
  assert.equal(audio.sources.length, 0);
  fetch.mock.mockImplementation(async () => new Response(new ArrayBuffer(8)));
  await sound.play();
  assert.equal(audio.sources.length, 1);
  sound.dispose();
});

test("interface effects remain finite with silent edges at supported sample rates", () => {
  for (const rate of [44100, 48000]) {
    for (const kind of ["click", "power-on", "power-off"] as const) {
      const samples = interfaceSamples(kind, rate);
      assert.ok(samples.length <= rate * 0.23);
      assert.equal(samples[0], 0);
      assert.equal(samples.at(-1), 0);
      assert.ok(samples.every((value) => Number.isFinite(value) && Math.abs(value) < 1));
      assert.ok(samples.some((value) => Math.abs(value) > 0.1));
    }
  }
});

test("rapid interface clicks cap voices, reuse their buffer, and clean up", () => {
  const audio = audioDouble();
  const sounds = new InterfaceAudio(audio.ctx, {} as AudioNode);
  for (let i = 0; i < 12; i++) sounds.play("click");
  assert.equal(audio.buffers(), 1);
  assert.equal(audio.sources.filter((source) => !source.disconnected).length, 8);
  sounds.dispose();
  assert.ok(audio.sources.every((source) => source.disconnected && !source.onended));
});
