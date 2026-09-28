import * as THREE from "three";

/** Simultaneous ring packets the surface can show; matches water.wgsl. */
export const WATER_RIPPLES = 8;
/** Ring packets fade out completely after this many seconds in water.wgsl. */
export const RIPPLE_LIFETIME = 5;

/**
 * Round-robin ripple slots shared by both renderers. Each slot is
 * (world x, world z, start seconds, strength); strength 0 is silent.
 */
export class WaterRipples {
  readonly slots = Array.from(
    { length: WATER_RIPPLES },
    () => new THREE.Vector4(0, 0, -RIPPLE_LIFETIME * 2, 0),
  );
  private next = 0;
  private time = 0;

  /** Advance the shared clock; a clock that rewinds (tape reset) clears all rings. */
  update(time: number) {
    if (time < this.time - 0.001) this.clear();
    this.time = time;
  }

  add(x: number, z: number, strength: number) {
    if (!(strength > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    // Prefer an expired slot so a burst of drips never cuts off a fresh wake.
    let slot = this.slots.findIndex((s) => s.w <= 0 || this.time - s.z > RIPPLE_LIFETIME);
    if (slot < 0) {
      slot = this.next;
      this.next = (this.next + 1) % WATER_RIPPLES;
    }
    this.slots[slot].set(x, z, this.time, Math.min(strength, 3));
  }

  clear() {
    for (const slot of this.slots) slot.set(0, 0, -RIPPLE_LIFETIME * 2, 0);
    this.next = 0;
  }
}
