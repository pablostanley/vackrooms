import type { FootstepSurface } from "./acoustics";

export const FOOTSTEP_RECORDINGS = {
  normal: { file: "footstep00", gain: 0.1, cutoff: 2200 },
  hard: { file: "footstep04", gain: 0.18, cutoff: 4200 },
  water: { file: "footstep05", gain: 0.2, cutoff: 5000 },
  heavy: { file: "footstep08", gain: 0.11, cutoff: 3200 },
} as const;
export type RecordedSound = keyof typeof FOOTSTEP_RECORDINGS;

export function footstepRecording(
  surface: FootstepSurface,
  running: boolean,
  entity = false,
): RecordedSound {
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
      (Object.keys(FOOTSTEP_RECORDINGS) as RecordedSound[]).map((kind) => {
        if (this.buffers.has(kind)) return;
        const pending = this.loading.get(kind);
        if (pending) return pending;
        const request = fetch(`/audio/kenney-rpg/${FOOTSTEP_RECORDINGS[kind].file}.ogg`, {
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
