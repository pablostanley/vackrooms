import assert from "node:assert/strict";
import test from "node:test";
import {
  ComputerDialup,
  DIALUP_SECONDS,
  dialupSamples,
} from "../src/lib/game/computer-dialup";

test("the modem handshake is deterministic, bounded, and fades to silence within five seconds", () => {
  for (const rate of [44100, 48000]) {
    const samples = dialupSamples(rate);
    assert.equal(samples.length, rate * DIALUP_SECONDS);
    assert.deepEqual(samples, dialupSamples(rate));
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0);
    assert.ok(
      samples.every(
        (sample) => Number.isFinite(sample) && Math.abs(sample) < 0.6,
      ),
    );
    const rms = (start: number, end: number) => {
      const part = samples.subarray(start * rate, end * rate);
      return Math.sqrt(
        part.reduce((sum, value) => sum + value * value, 0) / part.length,
      );
    };
    assert.ok(rms(0.05, 0.25) > 0.04, "audible dial tone");
    assert.ok(rms(1.8, 2.1) > 0.08, "answering carrier");
    assert.ok(rms(3.5, 3.9) > 0.02, "negotiation chatter");
    assert.ok(
      rms(4.8, 5) < rms(3.5, 3.9) * 0.05,
      "final fade includes the ending",
    );
  }
});

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

test("re-entering replaces the voice and early exit fades then releases its nodes", () => {
  const audio = audioDouble();
  const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
  sound.play();
  sound.play();
  assert.equal(audio.sources.length, 2);
  assert.equal(audio.sources[0].starts, 1);
  assert.deepEqual(audio.sources[0].stops, [undefined]);
  assert.ok(audio.sources[0].disconnected && audio.levels[0].disconnected);
  assert.equal(audio.sources[0].onended, null);
  assert.equal(audio.buffers(), 1, "reuse the single bounded PCM buffer");
  sound.stop();
  assert.deepEqual(audio.levels[1].held, [10]);
  assert.deepEqual(audio.levels[1].ramp, [0, 10.06]);
  assert.deepEqual(audio.sources[1].stops, [10.06]);
  audio.sources[1].onended!();
  assert.ok(audio.sources[1].disconnected && audio.levels[1].disconnected);
  sound.dispose();
});

test("natural completion and disposal both disconnect the modem source and gain", () => {
  const audio = audioDouble();
  const sound = new ComputerDialup(audio.ctx, {} as AudioNode);
  sound.play();
  audio.sources[0].onended!();
  assert.ok(audio.sources[0].disconnected && audio.levels[0].disconnected);
  sound.play();
  sound.dispose();
  assert.ok(audio.sources[1].disconnected && audio.levels[1].disconnected);
  assert.deepEqual(audio.sources[1].stops, [undefined]);
  assert.equal(audio.sources[1].onended, null);
});
