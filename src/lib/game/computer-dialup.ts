export const DIALUP_SECONDS = 5;

const tau = Math.PI * 2;
const envelope = (t: number, start: number, end: number, edge = 0.012) =>
  Math.max(0, Math.min(1, (t - start) / edge, (end - t) / edge));

/** A small original telephone/modem handshake, with its fade baked into PCM. */
export function dialupSamples(sampleRate: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * DIALUP_SECONDS));
  const digits = [
    [697, 1209],
    [770, 1336],
    [852, 1477],
    [697, 1336],
    [941, 1336],
    [770, 1209],
    [852, 1336],
  ];
  let noiseSeed = 0x199307;
  let low = 0,
    high = 0,
    phase = 0;
  const lowAlpha = 1 - Math.exp((-tau * 500) / sampleRate);
  const highAlpha = 1 - Math.exp((-tau * 3200) / sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    // Dial tone, followed by seven short DTMF key pairs.
    let sample =
      envelope(t, 0, 0.29) *
      0.07 *
      (Math.sin(tau * 350 * t) + Math.sin(tau * 440 * t));
    for (let digit = 0; digit < digits.length; digit++) {
      const start = 0.34 + digit * 0.115;
      sample +=
        envelope(t, start, start + 0.085, 0.006) *
        0.11 *
        (Math.sin(tau * digits[digit][0] * t) +
          Math.sin(tau * digits[digit][1] * t));
    }
    // The answering carrier breaks into chirps and raspy training chatter.
    sample +=
      envelope(t, 1.28, 1.58) *
      0.085 *
      (Math.sin(tau * 440 * t) + Math.sin(tau * 480 * t));
    sample += envelope(t, 1.67, 2.3, 0.025) * 0.16 * Math.sin(tau * 2100 * t);
    const frequency = [1200, 2400, 1800, 2100][Math.floor(t * 14) % 4];
    phase += (tau * frequency) / sampleRate;
    sample +=
      envelope(t, 2.34, 3.55, 0.025) *
      0.14 *
      Math.sin(phase) *
      (0.65 + 0.35 * Math.sin(tau * 32 * t));
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
    const noise = (noiseSeed / 0xffffffff) * 2 - 1;
    low += lowAlpha * (noise - low);
    high += highAlpha * (noise - high);
    sample +=
      envelope(t, 3.05, DIALUP_SECONDS, 0.12) *
      ((high - low) * 0.5 + Math.sin(phase) * 0.055);
    // The complete sound ends at five seconds, including the final one-second fade.
    const fade = Math.min(1, Math.max(0, DIALUP_SECONDS - t));
    samples[i] = sample * fade * fade;
  }
  samples[0] = samples[samples.length - 1] = 0;
  return samples;
}

interface DialupVoice {
  source: AudioBufferSourceNode;
  level: GainNode;
}

/** One source at a time, routed through the game's existing volume/mute bus. */
export class ComputerDialup {
  private buffer: AudioBuffer | null = null;
  private voice: DialupVoice | null = null;

  constructor(
    private ctx: BaseAudioContext,
    private output: AudioNode,
  ) {}

  play() {
    this.stop(false);
    if (!this.buffer) {
      const samples = dialupSamples(this.ctx.sampleRate);
      this.buffer = this.ctx.createBuffer(
        1,
        samples.length,
        this.ctx.sampleRate,
      );
      this.buffer.getChannelData(0).set(samples);
    }
    const source = this.ctx.createBufferSource();
    const level = this.ctx.createGain();
    source.buffer = this.buffer;
    source.connect(level).connect(this.output);
    const voice = { source, level };
    this.voice = voice;
    source.onended = () => this.release(voice);
    source.start();
  }

  stop(fade = true) {
    const voice = this.voice;
    if (!voice) return;
    if (!fade) {
      voice.source.stop();
      this.release(voice);
      return;
    }
    const now = this.ctx.currentTime;
    voice.level.gain.cancelAndHoldAtTime(now);
    voice.level.gain.linearRampToValueAtTime(0, now + 0.06);
    voice.source.stop(now + 0.06);
  }

  private release(voice: DialupVoice) {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.level.disconnect();
    if (this.voice === voice) this.voice = null;
  }

  dispose() {
    this.stop(false);
    this.buffer = null;
  }
}
