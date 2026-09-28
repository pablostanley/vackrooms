import { random } from "./maze";

/**
 * One falling drop: a Minnaert bubble resonance whose pitch rises as it
 * decays (van den Doel, "Physically based models for liquid sounds"), after a
 * sub-millisecond impact tick. radius is the entrained bubble in metres.
 */
export function dropletSamples(sampleRate: number, radius: number, seed: number) {
  const rng = random(seed ^ 0x2545f491);
  const f0 = 3.26 / radius;
  const decay = 0.043 * f0 + 0.0014 * f0 ** 1.5;
  const rise = 0.11 * decay;
  const length = Math.round(sampleRate * Math.min(0.4, 7 / decay));
  const samples = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * f0 * (1 + rise * t)) / sampleRate;
    // A short raised onset avoids a click without softening the plink.
    const onset = Math.min(1, t * sampleRate / 12);
    const tick = t < 0.0012 ? (rng() * 2 - 1) * 0.35 * (1 - t / 0.0012) : 0;
    samples[i] = Math.sin(phase) * Math.exp(-decay * t) * onset * 0.8 + tick;
  }
  return samples;
}

/**
 * Seamless lapping against the gutter: noise shaped by slow, irregular swells.
 * Envelope partials complete whole cycles in the loop, so only the noise
 * needs the raised-cosine crossfade.
 */
export function lappingSamples(sampleRate: number, seed: number) {
  const seconds = 8;
  const length = Math.round(sampleRate * seconds), overlap = Math.round(sampleRate * 0.2);
  const rng = random(seed ^ 0x1b873593);
  const raw = new Float32Array(length + overlap);
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = rng() * 2 - 1;
    brown = (brown + white * 0.06) / 1.06;
    raw[i] = brown * 2.2 + white * 0.28;
  }
  const noise = raw.slice(overlap);
  for (let i = 0; i < overlap; i++) {
    const blend = 0.5 - 0.5 * Math.cos(Math.PI * i / overlap);
    noise[length - overlap + i] = raw[length + i] * (1 - blend) + raw[i] * blend;
  }
  const phases = [rng(), rng(), rng(), rng()].map((p) => p * Math.PI * 2);
  const samples = new Float32Array(length);
  let energy = 0;
  for (let i = 0; i < length; i++) {
    const cycle = (i / length) * Math.PI * 2;
    const swell = 0.5 + 0.22 * Math.sin(cycle * 5 + phases[0]) + 0.16 * Math.sin(cycle * 7 + phases[1])
      + 0.08 * Math.sin(cycle * 13 + phases[2]) + 0.04 * Math.sin(cycle * 19 + phases[3]);
    // Cubing turns gentle swells into distinct laps with quiet gaps between.
    const lap = 0.12 + Math.max(0, swell) ** 3 * 2.4;
    samples[i] = noise[i] * lap;
    energy += samples[i] * samples[i];
  }
  const gain = 0.22 / Math.sqrt(energy / length);
  for (let i = 0; i < length; i++) samples[i] *= gain;
  return samples;
}

/** Filtered swish of legs pushing through water, following movement speed. */
export class WadingVoice {
  private source: AudioBufferSourceNode;
  private band: BiquadFilterNode;
  private level: GainNode;
  private disposed = false;

  constructor(private ctx: BaseAudioContext, destinations: AudioNode[], noise: AudioBuffer) {
    this.source = ctx.createBufferSource();
    this.source.buffer = noise;
    this.source.loop = true;
    this.source.playbackRate.value = 1.35;
    this.band = ctx.createBiquadFilter();
    this.band.type = "bandpass";
    this.band.frequency.value = 520;
    this.band.Q.value = 0.7;
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.source.connect(this.band).connect(this.level);
    for (const destination of destinations) this.level.connect(destination);
    this.source.start();
  }

  /** speed in m/s; walking is 2.35 and running 4.1. */
  update(speed: number, inWater: boolean) {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const push = inWater ? Math.min(Math.max(speed, 0) / 4.1, 1) : 0;
    this.level.gain.setTargetAtTime(push ** 1.4 * 0.11, now, push > 0 ? 0.07 : 0.22);
    this.band.frequency.setTargetAtTime(380 + push * 520, now, 0.1);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.source.stop();
    this.source.disconnect();
    this.band.disconnect();
    this.level.disconnect();
  }
}
