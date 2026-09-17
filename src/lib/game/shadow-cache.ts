import type { Sphere, SpotLight, Vector3 } from "three";

/** Fluorescent fixtures and architecture are static between world changes. */
export class ShadowCache {
  private affected = new Set<SpotLight>();

  constructor(private lights: readonly SpotLight[]) {
    for (const light of lights) light.shadow.autoUpdate = false;
    this.invalidate();
  }

  invalidate() {
    for (const light of this.lights) light.shadow.needsUpdate = true;
  }

  /** Keep each selected fixture on its existing map when distance ranks swap. */
  assign<T extends { position: Vector3 }>(candidates: readonly T[]) {
    const selected = candidates.slice(0, this.lights.length);
    const assigned = this.lights.map((light) =>
      selected.find((fixture) => fixture.position.equals(light.position)),
    );
    const remaining = selected.filter((fixture) => !assigned.includes(fixture));
    for (let i = 0; i < assigned.length; i++) {
      assigned[i] ??= remaining.shift();
      const fixture = assigned[i];
      if (fixture) this.place(this.lights[i], fixture.position);
    }
    return assigned;
  }

  place(light: SpotLight, position: Vector3) {
    if (light.position.equals(position)) return;
    light.position.copy(position);
    light.target.position.set(position.x, 0, position.z);
    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    light.shadow.updateMatrices(light);
    light.shadow.needsUpdate = true;
  }

  update(casters: readonly Sphere[]) {
    for (const light of this.lights) {
      const moving =
        light.visible && casters.some((caster) => light.shadow.getFrustum().intersectsSphere(caster));
      // Clear the old silhouette once after it leaves this particular light.
      if (moving || this.affected.has(light)) light.shadow.needsUpdate = true;
      if (moving) this.affected.add(light);
      else this.affected.delete(light);
    }
  }
}
