import { ROOM_SOUNDS, type RoomSound } from "./acoustics";
import { random } from "./maze";

const REFLECTIONS: Record<RoomSound, readonly number[]> = {
  office: [0.011, 0.023, 0.037],
  hall: [0.024, 0.047, 0.081],
  pool: [0.019, 0.043, 0.073, 0.113],
  corridor: [0.016, 0.05, 0.092, 0.139],
};

/** Material-dependent early reflections; treble dies before the low diffuse tail. */
export function roomImpulse(room: RoomSound, sampleRate: number, seed: number) {
  const { decay, cutoff } = ROOM_SOUNDS[room];
  const reflections = REFLECTIONS[room];
  const rng = random(seed + Math.round(decay * 1000));
  const channels = [new Float32Array(Math.ceil(sampleRate * decay)), new Float32Array(Math.ceil(sampleRate * decay))];
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * 0.35 / sampleRate);
  for (const [channel, samples] of channels.entries()) {
    let low = 0;
    const onset = reflections[0] + channel * 0.0017;
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      const noise = rng() * 2 - 1;
      low += alpha * (noise - low);
      if (t < onset) continue;
      const age = t - onset, density = Math.min(1, age / 0.035);
      samples[i] = density * (low * Math.exp(-6.9 * age / decay) +
        (noise - low) * 0.22 * Math.exp(-6.9 * age / (decay * 0.38)));
    }
    for (const [bounce, delay] of reflections.entries()) {
      const start = Math.round((delay + channel * 0.0017) * sampleRate);
      const width = Math.max(2, Math.round(sampleRate * 0.0007));
      for (let i = 0; i < width && start + i < samples.length; i++)
        samples[start + i] += Math.sin(Math.PI * i / width) * 0.22 / (bounce + 1);
    }
  }
  return channels;
}
