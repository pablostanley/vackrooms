import * as THREE from "three";
import type { ComputerStation } from "./computers";

const samples = [
  [0, 0],
  [-0.49, -0.49],
  [-0.49, 0.49],
  [0.49, -0.49],
  [0.49, 0.49],
];

/** Exact glass visibility, stopping at the first opaque obstruction. */
export class ScreenVisibility {
  private raycaster = new THREE.Raycaster();
  private direction = new THREE.Vector3();
  private hits: THREE.Intersection[] = [];

  unobstructed(
    station: ComputerStation,
    position: THREE.Vector3,
    meshes: readonly THREE.Mesh[],
  ) {
    for (const [x, y] of samples) {
      this.direction
        .set(x * station.width, y * station.height, 0)
        .applyQuaternion(station.quaternion)
        .add(station.position)
        .sub(position);
      this.raycaster.far = this.direction.length() - 0.025;
      this.raycaster.set(position, this.direction.normalize());
      for (const mesh of meshes) {
        // No recursion, complete hit list, or distance sort is needed for a
        // yes/no occlusion query. Mesh.raycast still tests the real triangles.
        mesh.raycast(this.raycaster, this.hits);
        const blocked = this.hits.length > 0;
        this.hits.length = 0;
        if (blocked) return false;
      }
    }
    return true;
  }
}
