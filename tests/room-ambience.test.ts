import assert from "node:assert/strict";
import test from "node:test";
import { RoomAmbience, roomAirSamples } from "../src/lib/game/room-ambience";

function audioDouble() {
  const params: Array<{ value: number; targets: number[]; immediate: number[]; cancelled: number }> = [];
  const nodes: Array<{ disconnected: boolean }> = [];
  const sources: Array<{ starts: number; stops: number }> = [];
  const param = () => {
    const state = { value: 0, targets: [] as number[], immediate: [] as number[], cancelled: 0 };
    params.push(state);
    return Object.assign(state, {
      cancelScheduledValues: () => { state.cancelled++; },
      setValueAtTime: (value: number) => { state.value = value; state.immediate.push(value); },
      setTargetAtTime: (value: number) => { state.value = value; state.targets.push(value); },
    });
  };
  const node = () => {
    const state = { disconnected: false, connect: (to: unknown) => to, disconnect: () => { state.disconnected = true; } };
    nodes.push(state);
    return state;
  };
  const source = () => {
    const state = { ...node(), starts: 0, stops: 0, start: () => { state.starts++; }, stop: () => { state.stops++; } };
    sources.push(state);
    return state;
  };
  const ctx = {
    sampleRate: 8000, currentTime: 4,
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ ...source(), playbackRate: param() }),
    createOscillator: () => ({ ...source(), frequency: param() }),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param() }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, params, nodes, sources };
}

test("room air is repeatable, finite, quiet, and has no discontinuous loop seam", () => {
  for (const sampleRate of [44100, 48000]) {
    const first = roomAirSamples(sampleRate, 17);
    assert.deepEqual(first, roomAirSamples(sampleRate, 17));
    assert.notDeepEqual(first, roomAirSamples(sampleRate, 18));
    assert.equal(first.length, sampleRate * 6);
    assert.ok(first.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 1));
    assert.ok(Math.abs(first[0] - first.at(-1)!) < 0.1);
    const rms = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0) / first.length);
    assert.ok(rms > 0.1 && rms < 0.3);
  }
});

test("thousands of room transitions reuse three voices and dispose all nodes once", () => {
  const audio = audioDouble();
  const ambience = new RoomAmbience(audio.ctx, {} as AudioNode, 17);
  const nodeCount = audio.nodes.length;
  for (let i = 0; i < 1000; i++) {
    ambience.update("pool"); ambience.update("corridor"); ambience.update("hall"); ambience.update("office");
  }
  assert.equal(audio.nodes.length, nodeCount);
  assert.equal(audio.sources.length, 3);
  assert.ok(audio.sources.every((source) => source.starts === 1));
  ambience.dispose(); ambience.dispose();
  assert.ok(audio.sources.every((source) => source.stops === 1));
  assert.ok(audio.nodes.every((node) => node.disconnected));
});

test("unchanged rooms do not enqueue automation, and tape reset clears the previous room", () => {
  const audio = audioDouble();
  const ambience = new RoomAmbience(audio.ctx, {} as AudioNode, 17);
  const officeValues = audio.params.map((param) => param.value);
  ambience.update("pool");
  const targets = audio.params.reduce((sum, param) => sum + param.targets.length, 0);
  for (let i = 0; i < 100; i++) ambience.update("pool");
  assert.equal(audio.params.reduce((sum, param) => sum + param.targets.length, 0), targets);
  assert.notDeepEqual(audio.params.map((param) => param.value), officeValues);
  ambience.reset();
  assert.deepEqual(audio.params.map((param) => param.value), officeValues);
  ambience.dispose();
  ambience.update("pool");
  assert.deepEqual(audio.params.map((param) => param.value), officeValues);
});
