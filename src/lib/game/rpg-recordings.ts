import type { FootstepSurface } from "./acoustics";

export const FOOTSTEP_RECORDINGS = {
  normal: { file: "footstep00", gain: 0.1, cutoff: 2200 },
  hard: { file: "footstep04", gain: 0.18, cutoff: 4200 },
  water: { file: "footstep05", gain: 0.2, cutoff: 5000 },
  heavy: { file: "footstep08", gain: 0.11, cutoff: 3200 },
} as const;
export const CREAK_RECORDINGS = ["creak1", "creak2", "creak3"] as const;
export const RPG_RECORDINGS = {
  ...FOOTSTEP_RECORDINGS,
  creak1: { file: "creak1", gain: 0.18, cutoff: 1800 },
  creak2: { file: "creak2", gain: 0.18, cutoff: 1800 },
  creak3: { file: "creak3", gain: 0.11, cutoff: 1800 },
  flashlight: { file: "metalClick", gain: 0.14, cutoff: 3500 },
} as const;
export type RecordedSound = keyof typeof RPG_RECORDINGS;

export function footstepRecording(
  surface: FootstepSurface,
  running: boolean,
  entity = false,
): keyof typeof FOOTSTEP_RECORDINGS {
  if (surface === "water") return "water";
  if (running || entity) return "heavy";
  return surface === "hard" ? "hard" : "normal";
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
        const request = fetch(`/audio/kenney-rpg/${RPG_RECORDINGS[kind].file}.ogg`, {
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
