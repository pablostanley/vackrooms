import type { RoomSound } from "./acoustics";
import { random } from "./maze";

// Deliberately below the localized fluorescent fixtures. The room's machinery
// gives the space a character without pretending to be an approaching entity.
export const ROOM_AIR: Record<RoomSound, {
  air: number; cutoff: number; water: number; motor: number; frequency: number;
}> = {
  office: { air: 0.035, cutoff: 380, water: 0, motor: 0, frequency: 58 },
  hall: { air: 0.044, cutoff: 530, water: 0, motor: 0.003, frequency: 54 },
  corridor: { air: 0.029, cutoff: 240, water: 0, motor: 0.007, frequency: 73 },
  pool: { air: 0.024, cutoff: 320, water: 0.018, motor: 0.005, frequency: 48 },
};

/** A seeded, seamless noise loop; the raised-cosine overlap avoids a loop click. */
export function roomAirSamples(sampleRate: number, seed: number) {
  const length = Math.round(sampleRate * 6), overlap = Math.round(sampleRate * 0.15);
  const rng = random(seed ^ 0x5f356495);
  const raw = new Float32Array(length + overlap);
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    brown = (brown + (rng() * 2 - 1) * 0.025) / 1.025;
    raw[i] = brown * 3.5;
  }
  const samples = raw.slice(overlap);
  for (let i = 0; i < overlap; i++) {
    const blend = 0.5 - 0.5 * Math.cos(Math.PI * i / overlap);
    samples[length - overlap + i] = raw[length + i] * (1 - blend) + raw[i] * blend;
  }
  return samples;
}

/** Three shared sources, independent of streamed room count, through the master bus. */
export class RoomAmbience {
  private air: GainNode;
  private water: GainNode;
  private motor: GainNode;
  private filter: BiquadFilterNode;
  private tone: OscillatorNode;
  private sources: AudioScheduledSourceNode[];
  private nodes: AudioNode[];
  private room: RoomSound | null = null;
  private disposed = false;

  constructor(private ctx: BaseAudioContext, destination: AudioNode, seed: number) {
    const samples = roomAirSamples(ctx.sampleRate, seed);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const air = ctx.createBufferSource(), water = ctx.createBufferSource();
    air.buffer = water.buffer = buffer;
    air.loop = water.loop = true;
    water.playbackRate.value = 1.7;
    this.air = ctx.createGain();
    this.water = ctx.createGain();
    this.motor = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.5;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = "bandpass";
    waterFilter.frequency.value = 1250;
    waterFilter.Q.value = 0.45;
    this.tone = ctx.createOscillator();
    this.tone.type = "sine";
    air.connect(this.filter).connect(this.air).connect(destination);
    water.connect(waterFilter).connect(this.water).connect(destination);
    this.tone.connect(this.motor).connect(destination);
    this.sources = [air, water, this.tone];
    this.nodes = [this.filter, waterFilter, this.air, this.water, this.motor];
    this.reset();
    for (const source of this.sources) source.start();
  }

  update(room: RoomSound, immediate = false) {
    if (this.disposed || (!immediate && room === this.room)) return;
    this.room = room;
    const profile = ROOM_AIR[room], now = this.ctx.currentTime;
    for (const [param, value] of [
      [this.air.gain, profile.air], [this.filter.frequency, profile.cutoff],
      [this.water.gain, profile.water], [this.motor.gain, profile.motor],
      [this.tone.frequency, profile.frequency],
    ] as const) {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, 1.2);
    }
  }

  reset() { this.update("office", true); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    for (const node of this.nodes) node.disconnect();
  }
}
