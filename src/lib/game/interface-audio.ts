export type InterfaceSound = "click" | "power-on" | "power-off";

/** Dry plastic clicks and a heavier, resonant CRT power-switch clunk. */
export function interfaceSamples(kind: InterfaceSound, sampleRate: number) {
  const power = kind !== "click";
  const duration = power ? 0.22 : 0.045;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const frequency = kind === "power-on" ? 145 : 110;
  const alpha = 1 - Math.exp((-2 * Math.PI * 1700) / sampleRate);
  let seed = 0x19940618;
  let smooth = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    smooth += alpha * (noise - smooth);
    const attack = Math.min(1, t / 0.001);
    const click = (noise - smooth) * Math.exp(-t / 0.006);
    const body = power
      ? Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t / 0.038) * 0.48 +
        smooth * Math.exp(-t / 0.022) * 0.42
      : Math.sin(2 * Math.PI * 1850 * t) * Math.exp(-t / 0.007) * 0.12;
    // A second contact gives the power switch its tactile, spring-loaded snap.
    const contact = power && t > 0.026
      ? smooth * Math.exp(-(t - 0.026) / 0.009) * 0.26
      : 0;
    samples[i] = (click * (power ? 0.16 : 0.3) + body + contact) * attack *
      Math.min(1, (duration - t) / 0.012);
  }
  samples[0] = samples[samples.length - 1] = 0;
  return samples;
}

export class InterfaceAudio {
  private buffers = new Map<InterfaceSound, AudioBuffer>();
  private sources = new Map<AudioBufferSourceNode, GainNode>();

  constructor(private ctx: BaseAudioContext, private output: AudioNode) {}

  play(kind: InterfaceSound, volume = 1) {
    let buffer = this.buffers.get(kind);
    if (!buffer) {
      const samples = interfaceSamples(kind, this.ctx.sampleRate);
      buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(kind, buffer);
    }
    this.playBuffer(buffer, volume);
  }

  playBuffer(buffer: AudioBuffer, volume = 1) {
    // Keep rapid clicking bounded, including while audio access is pending.
    if (this.sources.size >= 8) this.release(this.sources.keys().next().value!);
    const source = this.ctx.createBufferSource();
    const level = this.ctx.createGain();
    level.gain.value = volume;
    source.buffer = buffer;
    source.connect(level).connect(this.output);
    source.onended = () => this.release(source);
    this.sources.set(source, level);
    source.start();
  }

  private release(source: AudioBufferSourceNode) {
    source.onended = null;
    source.stop();
    source.disconnect();
    this.sources.get(source)?.disconnect();
    this.sources.delete(source);
  }

  dispose() {
    for (const source of this.sources.keys()) this.release(source);
    this.buffers.clear();
  }
}
