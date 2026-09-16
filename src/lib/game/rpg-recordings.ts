import type { FootstepSurface } from "./acoustics";

const kenney = (file: string, gain: number, cutoff: number) => ({
  src: `/audio/kenney-rpg/${file}.ogg`, gain, cutoff,
});
const water = (step: string) => ({ src: `/audio/water/${step}.ogg`, gain: 0.18, cutoff: 6500 });
export const WATER_RECORDINGS = ["water", "water2", "water3", "water4", "water5", "water6"] as const;

export const FOOTSTEP_RECORDINGS = {
  normal: kenney("footstep00", 0.1, 2200),
  hard: kenney("footstep04", 0.18, 4200),
  heavy: kenney("footstep08", 0.11, 3200),
  water: water("step01"),
  water2: water("step02"),
  water3: water("step03"),
  water4: water("step04"),
  water5: water("step05"),
  water6: water("step06"),
} as const;
export const CREAK_RECORDINGS = ["creak1", "creak2", "creak3"] as const;
export const RPG_RECORDINGS = {
  ...FOOTSTEP_RECORDINGS,
  creak1: kenney("creak1", 0.18, 1800),
  creak2: kenney("creak2", 0.18, 1800),
  creak3: kenney("creak3", 0.11, 1800),
  flashlight: kenney("metalClick", 0.14, 3500),
  jump: kenney("cloth4", 0.32, 2800),
} as const;
export type RecordedSound = keyof typeof RPG_RECORDINGS;

/** Random variation without playing the same splash twice consecutively. */
export function nextWaterRecording(previous: number, rng: () => number) {
  const count = WATER_RECORDINGS.length;
  return previous < 0 ? Math.floor(rng() * count)
    : (previous + 1 + Math.floor(rng() * (count - 1))) % count;
}

export function footstepRecording(
  surface: FootstepSurface,
  running: boolean,
  entity = false,
  waterIndex = 0,
): keyof typeof FOOTSTEP_RECORDINGS {
  if (surface === "water") return WATER_RECORDINGS[waterIndex];
  if (entity) return "heavy";
  return surface === "hard" ? "hard" : "normal";
}

/** Running changes weight, not the floor material. Keep variation below caricature. */
export function footstepPerformance(surface: FootstepSurface, running: boolean, entity: boolean, rng: () => number) {
  return {
    gain: (running ? (surface === "water" ? 1.1 : 1.25) : 1) * (0.92 + rng() * 0.16),
    rate: (entity ? 0.72 : running ? 0.98 : 0.96) + rng() * 0.08,
    brightness: (running ? 1.06 : 1) * (0.94 + rng() * 0.12),
  };
}

/** Decode a small fixed set once. Missed footsteps are never queued for later. */
export class RpgRecordings {
  private buffers = new Map<RecordedSound, AudioBuffer>();
  private loading = new Map<RecordedSound, Promise<void>>();
  private controller = new AbortController();
  private disposed = false;

  constructor(private ctx: BaseAudioContext) {}

  get(kind: RecordedSound) {
    return this.buffers.get(kind);
  }

  async preload() {
    if (this.disposed) return;
    await Promise.all(
      (Object.keys(RPG_RECORDINGS) as RecordedSound[]).map((kind) => {
        if (this.buffers.has(kind)) return;
        const pending = this.loading.get(kind);
        if (pending) return pending;
        const request = fetch(RPG_RECORDINGS[kind].src, {
          signal: this.controller.signal,
        })
          .then((response) => {
            if (!response.ok) throw new Error(`Could not load ${kind} recording`);
            return response.arrayBuffer();
          })
          .then((data) => this.ctx.decodeAudioData(data))
          .then((buffer) => {
            if (!this.disposed) this.buffers.set(kind, buffer);
          })
          .catch(() => {})
          .finally(() => this.loading.delete(kind));
        this.loading.set(kind, request);
        return request;
      }),
    );
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    this.buffers.clear();
  }
}
