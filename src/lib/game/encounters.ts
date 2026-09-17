import type { Vector3 } from "three";
import type { EntityNavigation } from "./entity-navigation";
import { Stalker, type StalkerInput } from "./stalker";

/** Two resident creatures, staggered arrivals, and a single holder at a time. */
export class Encounters {
  readonly stalkers: readonly Stalker[];
  private escapeGrace = 0;

  constructor(seed: number, navigation: EntityNavigation) {
    this.stalkers = [
      new Stalker(seed, navigation),
      new Stalker(seed ^ 0x70797261, navigation, 45),
    ];
  }
  get attacker() {
    return this.stalkers.find((stalker) => stalker.attacking);
  }
  get attacking() {
    return !!this.attacker;
  }
  get attackTime() {
    return this.attacker?.attackTime ?? 0;
  }
  get present() {
    return this.stalkers.some((stalker) => stalker.present);
  }
  reset() {
    for (const stalker of this.stalkers) stalker.reset();
    this.escapeGrace = 0;
  }
  escape() {
    if (!this.attacker?.escape()) return false;
    // A second creature cannot immediately undo a successful jump escape.
    this.escapeGrace = 3;
    return true;
  }
  update(
    dt: number,
    input: StalkerInput,
    footstep: (position: Vector3, running: boolean) => void,
  ) {
    this.escapeGrace = Math.max(0, this.escapeGrace - Math.min(dt, 0.1));
    const attacker = this.attacker;
    if (attacker) return attacker.update(dt, input, footstep);
    for (const stalker of this.stalkers) {
      stalker.update(dt, {
        ...input,
        canGrab: this.escapeGrace <= 0,
        otherPositions: this.stalkers
          .filter((other) => other !== stalker && other.present)
          .map((other) => other.position),
      }, footstep);
      if (stalker.attacking) break;
    }
    return false;
  }
}
