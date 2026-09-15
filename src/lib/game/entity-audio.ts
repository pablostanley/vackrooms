import { random } from "./maze";

/** One bounded synth, routed through the room's volume control and compressor. */
export class EntityAudio {
  private rumble: AudioBufferSourceNode;
  private static: AudioBufferSourceNode;
  private tone: OscillatorNode;
  private rumbleLevel: GainNode;
  private staticLevel: GainNode;
  private drive: GainNode;
  private filter: BiquadFilterNode;
  private output: GainNode;
  private nodes: AudioNode[];
  constructor(private ctx: AudioContext, destination: AudioNode, seed: number) {
    const rng = random(seed ^ 0x67726162);
    const buffer = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = rng() * 2 - 1;
    }
    this.rumble = ctx.createBufferSource();
    this.static = ctx.createBufferSource();
    this.rumble.buffer = this.static.buffer = buffer;
    this.rumble.loop = this.static.loop = true;
    const low = ctx.createBiquadFilter(), high = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 125;
    high.type = "bandpass";
    high.frequency.value = 1350;
    high.Q.value = 0.65;
    this.rumbleLevel = ctx.createGain();
    this.staticLevel = ctx.createGain();
    this.drive = ctx.createGain();
    const distortion = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5);
    }
    distortion.curve = curve;
    distortion.oversample = "2x";
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1600;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.rumbleLevel.gain.value = 0.65;
    this.staticLevel.gain.value = 0;
    this.tone = ctx.createOscillator();
    this.tone.frequency.value = 43;
    const toneLevel = ctx.createGain();
    toneLevel.gain.value = 0.09;
    this.rumble.connect(low).connect(this.rumbleLevel).connect(this.drive);
    this.static.connect(high).connect(this.staticLevel).connect(this.drive);
    this.tone.connect(toneLevel).connect(this.drive);
    this.drive.connect(distortion).connect(this.filter).connect(this.output).connect(destination);
    this.nodes = [low, high, this.rumbleLevel, this.staticLevel, this.drive, distortion, this.filter, this.output, toneLevel];
    this.rumble.start();
    this.static.start();
    this.tone.start();
  }
  update(proximity: number, squeeze: number, time: number, blackout: number) {
    const now = this.ctx.currentTime;
    const near = Math.max(0, Math.min(1, proximity));
    const pulse = 0.5 - Math.cos(time * Math.PI * 4) * 0.5;
    const broken = Math.sin(time * 37) * Math.sin(time * 59) > 0.28 ? 1 : 0.22;
    this.output.gain.setTargetAtTime((near * near * 0.16 + squeeze * (0.06 + pulse * 0.065)) * (1 - blackout), now, 0.06);
    this.staticLevel.gain.setTargetAtTime(near * 0.1 * broken + squeeze * 0.24, now, 0.018);
    this.drive.gain.setTargetAtTime(1 + squeeze * (7 + pulse * 9), now, 0.03);
    this.filter.frequency.setTargetAtTime(900 + near * 1000 + squeeze * 900, now, 0.1);
    this.tone.frequency.setTargetAtTime(43 - squeeze * 12, now, 0.1);
  }
  reset() {
    this.output.gain.cancelScheduledValues(this.ctx.currentTime);
    this.output.gain.setTargetAtTime(0, this.ctx.currentTime, 0.025);
  }
  dispose() {
    for (const source of [this.rumble, this.static, this.tone]) {
      source.stop();
      source.disconnect();
    }
    for (const node of this.nodes) node.disconnect();
  }
}
