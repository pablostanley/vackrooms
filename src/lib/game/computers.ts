import * as THREE from "three";
import type { ComputerKind } from "./computer-models";

export interface ComputerStation {
  id: string;
  kind: ComputerKind;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  normal: THREE.Vector3;
  width: number;
  height: number;
}

export const COMPUTER_HOME = "https://vgpu.sh/";
export const MAX_LIVE_SCREENS = 2;

/** Never execute address-bar scripts or navigate the surrounding game. */
export function browserAddress(value: string): string | null {
  try {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Frame the entire plastic shell at any viewport aspect ratio. */
export function computerFocus(station: ComputerStation, aspect: number) {
  const fov = 48;
  const halfFov = THREE.MathUtils.degToRad(fov / 2);
  const distance = Math.max(
    0.47 / Math.tan(halfFov),
    0.57 / (Math.tan(halfFov) * aspect),
  );
  return {
    position: station.position
      .clone()
      .addScaledVector(station.normal, distance),
    quaternion: station.quaternion.clone(),
    fov,
  };
}

export function canUseComputer(
  station: ComputerStation,
  camera: THREE.PerspectiveCamera,
) {
  const delta = station.position.clone().sub(camera.position);
  const distance = delta.length();
  return (
    distance < 2.5 &&
    distance > 0.15 &&
    delta.clone().negate().normalize().dot(station.normal) > 0.35 &&
    delta.normalize().dot(camera.getWorldDirection(new THREE.Vector3())) > 0.72
  );
}
