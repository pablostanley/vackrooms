import type { SpotLight, Vector3 } from "three";

/** Fluorescent fixtures and architecture are static between world changes. */
export class ShadowCache {
  private hadMovingCaster = false;

  constructor(private lights: readonly SpotLight[]) {
    for (const light of lights) light.shadow.autoUpdate = false;
    this.invalidate();
  }

  invalidate() {
    for (const light of this.lights) light.shadow.needsUpdate = true;
  }

  place(light: SpotLight, position: Vector3) {
    if (light.position.equals(position)) return;
    light.position.copy(position);
    light.target.position.set(position.x, 0, position.z);
    light.shadow.needsUpdate = true;
  }

  update(movingCaster: boolean) {
    // Refresh the final frame too, clearing the creature's previous silhouette.
    if (movingCaster || this.hadMovingCaster) this.invalidate();
    this.hadMovingCaster = movingCaster;
  }
}
