import * as THREE from "three";
import type { Materials } from "../../src/lib/game/materials";

export function headlessMaterials(): Materials {
  const standardNames = [
    "wall",
    "floor",
    "top",
    "tileWall",
    "tileFloor",
    "trim",
    "fixtures",
    "deadLight",
    "wood",
    "fabric",
    "upholstery",
    "enamel",
    "fadedRed",
    "cream",
    "metal",
    "paper",
  ] as const;
  const standard = Object.fromEntries(
    standardNames.map((name) => [name, new THREE.MeshStandardMaterial()]),
  ) as Record<(typeof standardNames)[number], THREE.MeshStandardMaterial>;
  const basic = {
    luminous: new THREE.MeshBasicMaterial(),
    shadow: new THREE.MeshBasicMaterial({ transparent: true }),
    darkness: new THREE.MeshBasicMaterial(),
  };
  return {
    ...standard,
    ...basic,
    forTheme: () => ({ wall: standard.wall, floor: standard.floor }),
    dispose: () => {
      for (const material of [
        ...Object.values(standard),
        ...Object.values(basic),
      ])
        material.dispose();
    },
  };
}
