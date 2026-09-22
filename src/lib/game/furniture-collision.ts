import { Matrix4, Vector3 } from "three";
import type { FurnitureModel } from "./furniture-models";

/** Rapier hulls use compact authored solids where available, never tiny keycaps. */
export function furnitureCollisionParts(model: FurnitureModel, pose: Matrix4) {
  if (model.playerBounds) {
    const point = new Vector3();
    return model.playerBounds.map((bounds) => {
      const vertices = new Float32Array(24);
      let at = 0;
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            point.set(x, y, z).applyMatrix4(pose).toArray(vertices, at);
            at += 3;
          }
      return vertices;
    });
  }
  return model.parts.map(({ geometry }) => {
    const placed = geometry.clone().applyMatrix4(pose);
    const vertices = new Float32Array(placed.getAttribute("position").array);
    placed.dispose();
    return vertices;
  });
}
