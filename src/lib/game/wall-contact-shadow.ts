import * as THREE from "three";
import { CELL } from "./maze";

/** A floor-facing strip whose opaque V=1 edge always sits against the wall.
 * Rotate about world Y after laying it flat: Euler(-PI/2, PI, 0) instead turns
 * the plane upside down, and swapping its dimensions makes the fade run along
 * vertical walls rather than outward from them.
 */
export function wallContactShadowGeometry(vertical: boolean, side: number) {
  const geometry = new THREE.PlaneGeometry(CELL, 0.65);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(vertical ? side * Math.PI / 2 : side < 0 ? Math.PI : 0);
  return geometry;
}
