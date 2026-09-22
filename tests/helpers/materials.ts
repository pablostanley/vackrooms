import * as THREE from "three";
import type { Materials } from "../../src/lib/game/materials";

export function headlessMaterials(): Materials {
  const standardNames = [
    "hotelNumbers",
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
    "funWall",
    "funCarpet",
    "funTrim",
    "funStripe",
    "courtyardWall",
    "courtyardPaving",
    "courtyardWood",
    "courtyardGrass",
    "courtyardCurtain",
    "courtyardWarm",
    "courtyardGlass",
    "streetWall",
    "streetAsphalt",
    "streetGrass",
    "streetRoof",
    "streetTrim",
    "streetHedge",
  ] as const;
  const standard = Object.fromEntries(
    standardNames.map((name) => [name, new THREE.MeshStandardMaterial()]),
  ) as Record<(typeof standardNames)[number], THREE.MeshStandardMaterial>;
  const basic = {
    luminous: new THREE.MeshBasicMaterial(),
    lampGlow: new THREE.MeshBasicMaterial(),
    shadow: new THREE.MeshBasicMaterial({ transparent: true }),
    darkness: new THREE.MeshBasicMaterial(),
  };
  const funMurals = Array.from(
    { length: 3 },
    () => new THREE.MeshStandardMaterial({ alphaTest: 0.5 }),
  );
  const streetSiding = Array.from(
    { length: 5 },
    () => new THREE.MeshStandardMaterial(),
  );
  return {
    ...standard,
    ...basic,
    funMurals,
    streetSiding,
    forTheme: () => ({ wall: standard.wall, floor: standard.floor }),
    dispose: () => {
      for (const material of [
        ...Object.values(standard),
        ...Object.values(basic),
        ...funMurals,
        ...streetSiding,
      ])
        material.dispose();
    },
  };
}
