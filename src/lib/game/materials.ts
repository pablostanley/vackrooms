import * as THREE from "three";
import { createDiscoveryNotes } from "./discovery-notes";
import { random, type Theme } from "./maze";
import { drawFunCarpet, drawFunMural } from "./fun-textures";
import {
  configureSurfaceSampling,
  createSurfaceTextures,
  SURFACE_SIZE,
  type Surface,
} from "./surface-textures";

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 512,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function grain(
  ctx: CanvasRenderingContext2D,
  size: number,
  strength: number,
  seed: number,
) {
  const rng = random(seed),
    image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (rng() - 0.5) * strength;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}
export function createMaterials() {
  const notes = createDiscoveryNotes();
  const textures: THREE.Texture[] = [];
  const texture = (
    draw: (ctx: CanvasRenderingContext2D, size: number) => void,
    size?: number,
  ) => {
    const t = canvasTexture(draw, size);
    textures.push(t);
    return t;
  };
  const surface = (name: Surface) => {
    const maps = createSurfaceTextures(name);
    textures.push(maps.map, maps.bumpMap);
    return maps;
  };
  const wallpaper = surface("wallpaper");
  const carpet = surface("carpet");
  const ceiling = surface("ceiling");
  const plaster = surface("plaster");
  const woodGrain = surface("wood");
  const lightMap = texture((ctx, s) => {
    ctx.fillStyle = "#edeacf";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 5) {
      ctx.fillStyle = "rgba(114,121,90,.14)";
      ctx.fillRect(0, y, s, 1);
    }
    grain(ctx, s, 9, 143);
  });
  const ao = texture((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "rgba(60,49,16,.23)");
    g.addColorStop(0.2, "rgba(60,49,16,.07)");
    g.addColorStop(1, "rgba(13,12,4,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 128);
  const wall = new THREE.MeshStandardMaterial({
    ...wallpaper,
    roughness: 0.97,
    color: "#ffffff",
    emissive: "#ccbc5f",
    emissiveIntensity: 0.035,
  });
  const floor = new THREE.MeshStandardMaterial({
    ...carpet,
    roughness: 1,
    emissive: "#ab9552",
    emissiveIntensity: 0.025,
  });
  const top = new THREE.MeshStandardMaterial({
    ...ceiling,
    roughness: 1,
    color: "#ffffff",
    emissive: "#c4b976",
    emissiveIntensity: 0.075,
  });
  const tileWall = new THREE.MeshStandardMaterial({
    ...plaster,
    roughness: 0.48,
    color: "#b0bb92",
  });
  const tileFloor = new THREE.MeshStandardMaterial({
    ...plaster,
    roughness: 0.38,
    color: "#818d72",
  });
  const service = wall.clone();
  service.color.set("#91a38a");
  const archive = wall.clone();
  archive.color.set("#ccbea5");
  const trim = new THREE.MeshStandardMaterial({
    color: "#a99b55",
    roughness: 0.85,
  });
  const fixtures = new THREE.MeshStandardMaterial({
    color: "#bab37e",
    roughness: 0.7,
    metalness: 0.35,
  });
  const luminous = new THREE.MeshBasicMaterial({
    map: lightMap,
    color: "#ffffdd",
    toneMapped: false,
  });
  const deadLight = new THREE.MeshStandardMaterial({
    color: "#b2ad78",
    roughness: 0.8,
  });
  const lampGlow = new THREE.MeshBasicMaterial({ color: "#ffe0a0", toneMapped: false });
  const shadow = new THREE.MeshBasicMaterial({
    map: ao,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const wood = new THREE.MeshStandardMaterial({
    ...woodGrain,
    color: "#4a3017",
    roughness: 0.8,
  });
  const fabric = new THREE.MeshStandardMaterial({
    bumpMap: carpet.bumpMap,
    roughnessMap: carpet.roughnessMap,
    bumpScale: 0.002,
    color: "#535843",
    roughness: 1,
  });
  const upholstery = new THREE.MeshStandardMaterial({
    bumpMap: carpet.bumpMap,
    roughnessMap: carpet.roughnessMap,
    bumpScale: 0.002,
    color: "#8b7c53",
    roughness: 1,
  });
  const enamel = new THREE.MeshStandardMaterial({
    color: "#b4a052",
    roughness: 0.72,
    metalness: 0.08,
  });
  const fadedRed = new THREE.MeshStandardMaterial({
    color: "#9b5942",
    roughness: 0.88,
  });
  const cream = new THREE.MeshStandardMaterial({
    ...plaster,
    color: "#c8bc91",
    roughness: 0.86,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#32392d",
    metalness: 0.65,
    roughness: 0.55,
  });
  const paper = new THREE.MeshStandardMaterial({
    color: "#b0aa7e",
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const darkness = new THREE.MeshBasicMaterial({ color: "#060806" });
  const funWall = new THREE.MeshStandardMaterial({
    ...plaster,
    color: "#e0cf85",
    roughness: 0.96,
  });
  const funCarpet = new THREE.MeshStandardMaterial({
    ...carpet,
    map: texture(drawFunCarpet, 1024),
    roughness: 1,
  });
  funCarpet.userData.surfaceMeters = 3.6;
  configureSurfaceSampling(funCarpet);
  const funTrim = new THREE.MeshStandardMaterial({
    color: "#b9b49a",
    roughness: 0.9,
  });
  const funStripe = new THREE.MeshStandardMaterial({
    color: "#797252",
    roughness: 0.95,
  });
  const funMurals = [0, 1, 2].map((kind) => {
    const map = texture((ctx, size) => drawFunMural(ctx, size, kind));
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  });
  const courtyardWall = new THREE.MeshStandardMaterial({
    ...plaster, color: "#d7d4bd", roughness: 0.94,
  });
  const courtyardPaving = new THREE.MeshStandardMaterial({
    ...plaster, color: "#aaa492", roughness: 0.88,
  });
  const courtyardWood = new THREE.MeshStandardMaterial({
    ...woodGrain, color: "#b4a080", roughness: 0.9,
  });
  const courtyardGrass = new THREE.MeshStandardMaterial({
    bumpMap: carpet.bumpMap, roughnessMap: carpet.roughnessMap,
    bumpScale: 0.007, color: "#56633a", roughness: 1,
  });
  const courtyardCurtain = new THREE.MeshStandardMaterial({
    color: "#343c32", roughness: 0.88,
  });
  const courtyardWarm = new THREE.MeshStandardMaterial({
    color: "#b8a370", emissive: "#d3ad64", emissiveIntensity: 0.36, roughness: 0.95,
  });
  const courtyardGlass = new THREE.MeshStandardMaterial({
    color: "#a2ae94", transparent: true, opacity: 0.1,
    roughness: 0.18, metalness: 0.15, depthWrite: false, side: THREE.DoubleSide,
  });
  // The indoor street: painted sky walls, lap siding, shingles, and lawn.
  const streetWall = new THREE.MeshStandardMaterial({
    ...plaster, color: "#86bdea", roughness: 0.95,
    // The warm fixtures would otherwise pull painted sky toward teal.
    emissive: "#2f7fd0", emissiveIntensity: 0.22,
  });
  const streetAsphalt = new THREE.MeshStandardMaterial({
    ...plaster, color: "#75736c", roughness: 0.97,
  });
  const streetGrass = new THREE.MeshStandardMaterial({
    bumpMap: carpet.bumpMap, roughnessMap: carpet.roughnessMap,
    bumpScale: 0.009, color: "#5c8a3c", roughness: 1,
  });
  const streetRoof = new THREE.MeshStandardMaterial({
    color: "#7a7973", roughness: 0.96, side: THREE.DoubleSide,
  });
  const streetTrim = new THREE.MeshStandardMaterial({
    color: "#efeee6", roughness: 0.8,
  });
  const streetHedge = new THREE.MeshStandardMaterial({
    bumpMap: carpet.bumpMap, roughnessMap: carpet.roughnessMap,
    bumpScale: 0.02, color: "#2f4a2b", roughness: 1,
  });
  const lapMap = texture((ctx, s) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, s, s);
    // Four boards per tile; each casts a thin shadow onto the one below.
    for (let board = 0; board < 4; board++) {
      const y = (board * s) / 4;
      const g = ctx.createLinearGradient(0, y, 0, y + s / 4);
      g.addColorStop(0, "rgba(0,0,0,.34)");
      g.addColorStop(0.09, "rgba(0,0,0,.1)");
      g.addColorStop(0.2, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, s / 4);
    }
    grain(ctx, s, 7, 389);
  }, 256);
  const streetSiding = ["#e9e6d8", "#d9c98a", "#9aa3a8", "#5f7f9e", "#a9b48e"].map(
    (color) => {
      const siding = new THREE.MeshStandardMaterial({
        map: lapMap, color, roughness: 0.9,
      });
      siding.userData.surfaceMeters = 0.56;
      return siding;
    },
  );
  for (const [kind, materials] of [
    ["wallpaper", [wall, service, archive]],
    ["carpet", [floor]],
    ["ceiling", [top]],
    ["plaster", [tileWall, tileFloor, cream, funWall, courtyardWall, courtyardPaving, streetWall, streetAsphalt]],
    ["wood", [wood, courtyardWood]],
  ] as const)
    for (const material of materials) {
      material.userData.surfaceMeters = SURFACE_SIZE[kind];
      configureSurfaceSampling(material);
    }
  // Upholstery has finer fibers than floor carpet but shares its relief maps.
  fabric.userData.surfaceMeters = upholstery.userData.surfaceMeters = 0.6;
  configureSurfaceSampling(fabric);
  configureSurfaceSampling(upholstery);
  courtyardGrass.userData.surfaceMeters = 1.2;
  configureSurfaceSampling(courtyardGrass);
  streetGrass.userData.surfaceMeters = streetHedge.userData.surfaceMeters = 1.2;
  configureSurfaceSampling(streetGrass);
  configureSurfaceSampling(streetHedge);
  return {
    discoveryNotes: notes.materials,
    wall,
    floor,
    top,
    tileWall,
    tileFloor,
    trim,
    fixtures,
    luminous,
    lampGlow,
    deadLight,
    shadow,
    wood,
    fabric,
    upholstery,
    enamel,
    fadedRed,
    cream,
    metal,
    paper,
    darkness,
    funWall,
    funCarpet,
    funTrim,
    funStripe,
    funMurals,
    courtyardWall,
    courtyardPaving,
    courtyardWood,
    courtyardGrass,
    courtyardCurtain,
    courtyardWarm,
    courtyardGlass,
    streetWall,
    streetAsphalt,
    streetGrass,
    streetRoof,
    streetTrim,
    streetHedge,
    streetSiding,
    forTheme: (theme: Theme) => ({
      wall:
        theme === "service" ? service : theme === "archive" ? archive : wall,
      floor,
    }),
    dispose: () => {
      notes.dispose();
      textures.forEach((t) => t.dispose());
      [
        wall,
        floor,
        top,
        tileWall,
        tileFloor,
        service,
        archive,
        trim,
        fixtures,
        luminous,
        lampGlow,
        deadLight,
        shadow,
        wood,
        fabric,
        upholstery,
        enamel,
        fadedRed,
        cream,
        metal,
        paper,
        darkness,
        funWall,
        funCarpet,
        funTrim,
        funStripe,
        ...funMurals,
        courtyardWall,
        courtyardPaving,
        courtyardWood,
        courtyardGrass,
        courtyardCurtain,
        courtyardWarm,
        courtyardGlass,
        streetWall,
        streetAsphalt,
        streetGrass,
        streetRoof,
        streetTrim,
        streetHedge,
        ...streetSiding,
      ].forEach((m) => m.dispose());
    },
  };
}
export type Materials = ReturnType<typeof createMaterials>;
