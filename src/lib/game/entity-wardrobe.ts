import type { EntityVariant } from "./entity-anatomy";
import type { EntitySurface } from "./entity-skin";

const key = (variant: EntityVariant, seed: number) => `${variant}:${seed}`;

/** Sculpts upcoming bodies on a worker while their stalker is away, so a new
 * appearance never stalls a frame. Without workers, callers sculpt in place.
 */
export class EntityWardrobe {
  private worker: Worker | null = null;
  private waiting = new Set<string>();
  private ready = new Map<string, EntitySurface>();
  constructor() {
    if (typeof Worker === "undefined") return;
    try {
      this.worker = new Worker(new URL("./entity-sculpt.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return;
    }
    this.worker.onmessage = ({ data }: MessageEvent<{ variant: EntityVariant; seed: number; surface: EntitySurface }>) => {
      const id = key(data.variant, data.seed);
      if (!this.waiting.delete(id)) return;
      this.ready.set(id, data.surface);
      // Bodies for abandoned tapes are never taken; keep only the newest few.
      for (const stale of this.ready.keys()) if (this.ready.size > 4) this.ready.delete(stale);
    };
    this.worker.onerror = () => this.dispose();
  }
  get available() {
    return this.worker !== null;
  }
  prepare(variant: EntityVariant, seed: number) {
    const id = key(variant, seed);
    if (!this.worker || this.waiting.has(id) || this.ready.has(id)) return;
    this.waiting.add(id);
    this.worker.postMessage({ variant, seed });
  }
  take(variant: EntityVariant, seed: number) {
    const id = key(variant, seed), surface = this.ready.get(id);
    this.ready.delete(id);
    return surface;
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
    this.ready.clear();
  }
}
