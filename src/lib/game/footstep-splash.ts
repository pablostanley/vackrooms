import { random } from "./maze";

/** One short, seeded splash, cached by the audio engine and varied in playback. */
export function splashSamples(sampleRate: number, seed: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * 0.44));
  const rng = random(seed ^ 0x510e527f);
  const smoothing = Math.exp((-2 * Math.PI * 900) / sampleRate);
  let smooth = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const noise = rng() * 2 - 1;
    smooth = smooth * smoothing + noise * (1 - smoothing);
    // A quick displacement of water followed by a softer returning slosh.
    const wash = (1 - Math.exp(-120 * t)) * Math.exp(-25 * t) +
      0.45 * Math.exp(-Math.pow((t - 0.12) / 0.065, 2));
    let value = (smooth * 1.5 + noise * 0.12) * wash;
    for (const delay of [0.055, 0.13]) {
      const age = t - delay;
      if (age <= 0) continue;
      const phase = 2 * Math.PI *
        (170 * age + (420 / 24) * (1 - Math.exp(-24 * age)));
      value += Math.sin(phase) * 0.14 *
        (1 - Math.exp(-200 * age)) * Math.exp(-32 * age);
    }
    const fade = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.04));
    samples[i] = value * fade * Math.min(1, t / 0.006);
  }
  return samples;
}
