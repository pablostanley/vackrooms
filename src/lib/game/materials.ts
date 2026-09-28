import { FurnitureLibrary } from "./furniture-library";
import * as THREE from "three";
import { createDiscoveryNotes } from "./discovery-notes";
import { createHotelLabels } from "./hotel-labels";
import { createRoomAmbientPool } from "./room-lighting";
import { random, type Theme } from "./maze";
import { BALL_COLORS } from "./ball-pit";
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
  const ambientMaps = createRoomAmbientPool();
  const textures: THREE.Texture[] = [];
  const hotelLabels = createHotelLabels();
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
  // A prismatic acrylic lens over three tubes: brighter bands where the lamps
  // sit, a fine pyramid texture, and falloff toward the painted steel rim.
  const lightMap = texture((ctx, s) => {
    const image = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const u = x / s, v = y / s;
        const tubes = [0.22, 0.5, 0.78].reduce(
          (sum, center) => sum + Math.exp(-(((v - center) / 0.085) ** 2)),
          0,
        );
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const rim = Math.min(1, edge / 0.08) ** 0.6;
        const prism = (x % 4 < 2) !== (y % 4 < 2) ? 1 : 0.955;
        const value = (0.74 + tubes * 0.24) * (0.72 + rim * 0.28) * prism;
        const at = (y * s + x) * 4;
        image.data[at] = Math.min(255, value * 250);
        image.data[at + 1] = Math.min(255, value * 247);
        image.data[at + 2] = Math.min(255, value * 232);
        image.data[at + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
  }, 256);
  lightMap.wrapS = lightMap.wrapT = THREE.ClampToEdgeWrapping;
  const ao = texture((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "rgba(60,49,16,.23)");
    g.addColorStop(0.2, "rgba(60,49,16,.07)");
    g.addColorStop(1, "rgba(13,12,4,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 128);
  // This one-shot fade is not periodic: wrapping leaks its dark edge back into
  // the transparent outer edge when bilinear/mipmap filtering samples it.
  ao.wrapS = ao.wrapT = THREE.ClampToEdgeWrapping;
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
    emissive: "#d4ceb1",
    // Carpet and wall bounce lights the board; the outage mask still dims it.
    emissiveIntensity: 0.2,
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
  // A tiny equirectangular stand-in for the maze: panel-dotted ceiling, ochre
  // walls, brown carpet. Only untextured metal and enamel sample it, so their
  // highlights read as reflected fluorescents instead of flat dark paint.
  const reflections = texture((ctx, s) => {
    const h = s / 2;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#d9d3b4");
    sky.addColorStop(0.42, "#bfb78f");
    sky.addColorStop(0.5, "#b8a653");
    sky.addColorStop(0.72, "#9d8e48");
    sky.addColorStop(0.78, "#6d5f3a");
    sky.addColorStop(1, "#4e4330");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, h);
    ctx.fillStyle = "#fffbe6";
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 8; column++) {
        const y = h * (0.04 + row * 0.085);
        const width = s * (0.05 - row * 0.009);
        ctx.fillRect(((column + (row % 2) * 0.5) / 8) * s, y, width, h * 0.018);
      }
  }, 256);
  reflections.mapping = THREE.EquirectangularReflectionMapping;
  reflections.wrapT = THREE.ClampToEdgeWrapping;
  // Painted steel troffer rims catch the panel's own spill and carpet bounce.
  const troffer = new THREE.MeshStandardMaterial({
    color: "#e4dfc8",
    roughness: 0.55,
    emissive: "#f2e6bd",
    emissiveIntensity: 0.18,
  });
  const fixtures = new THREE.MeshStandardMaterial({
    color: "#bab37e",
    roughness: 0.7,
    metalness: 0.35,
    envMap: reflections,
    envMapIntensity: 0.55,
  });
  const luminous = new THREE.MeshBasicMaterial({
    map: lightMap,
    // Authored HDR radiance keeps warm panels bright through the same tone-mapped
    // output as the room. Real fluorescent diffusers clip to a warm near-white
    // on camera; the excess feeds the lens bloom rather than tinting the lens.
    color: new THREE.Color(2.5, 2.35, 1.45),
  });
  // Tired and failing tubes share one batch per section. Their vertex colors
  // carry each tube's current brightness, rewritten by the engine per frame.
  const tubePanel = luminous.clone();
  tubePanel.vertexColors = true;
  const deadLight = new THREE.MeshStandardMaterial({
    color: "#b2ad78",
    roughness: 0.8,
  });
  const lampGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.46, 0.855, 0.144),
  });
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
    roughness: 0.6,
    metalness: 0.08,
    envMap: reflections,
    envMapIntensity: 0.45,
  });
  const fadedRed = new THREE.MeshStandardMaterial({
    color: "#9b5942",
    roughness: 0.88,
  });
  // Glossy playground plastic; each ball's colour comes from its instance.
  const ballPit = new THREE.MeshStandardMaterial({ roughness: 0.34 });
  // The shaded heap under the top layer, seen through its gaps.
  const ballPitFill = new THREE.MeshStandardMaterial({
    map: texture((ctx, s) => {
      const rng = random(0xba11);
      ctx.fillStyle = "#2f2a20";
      ctx.fillRect(0, 0, s, s);
      const r = s / 20;
      for (let n = 0; n < 420; n++) {
        const x = rng() * s, y = rng() * s;
        const color = BALL_COLORS[Math.floor(rng() * BALL_COLORS.length)];
        for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
          const g = ctx.createRadialGradient(x + dx - r * 0.3, y + dy - r * 0.3, r * 0.1, x + dx, y + dy, r);
          g.addColorStop(0, color);
          g.addColorStop(1, "#1e1a14");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }),
    roughness: 0.6,
  });
  // Canvas tiles cover two meters of heap.
  ballPitFill.map!.repeat.set(0.5, 0.5);
  const cream = new THREE.MeshStandardMaterial({
    ...plaster,
    color: "#c8bc91",
    roughness: 0.86,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#32392d",
    metalness: 0.65,
    roughness: 0.45,
    envMap: reflections,
    envMapIntensity: 0.7,
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
    envMap: reflections, envMapIntensity: 0.6,
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
  fabric.userData.surfaceMeters = upholstery.userData.surfaceMeters = 1.2;
  configureSurfaceSampling(fabric);
  configureSurfaceSampling(upholstery);
  courtyardGrass.userData.surfaceMeters = 2.4;
  configureSurfaceSampling(courtyardGrass);
  streetGrass.userData.surfaceMeters = streetHedge.userData.surfaceMeters = 2.4;
  configureSurfaceSampling(streetGrass);
  configureSurfaceSampling(streetHedge);
  const furniture: FurnitureLibrary = new FurnitureLibrary(() => materials);
  const materials = {
    furniture,
    discoveryNotes: notes.materials,
    hotelNumbers: hotelLabels.material,
    ambientMaps,
    wall,
    floor,
    top,
    tileWall,
    tileFloor,
    trim,
    fixtures,
    troffer,
    luminous,
    tubePanel,
    lampGlow,
    deadLight,
    shadow,
    wood,
    fabric,
    upholstery,
    enamel,
    fadedRed,
    ballPit,
    ballPitFill,
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
      hotelLabels.dispose();
      ambientMaps.dispose();
      furniture.dispose();
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
        troffer,
        luminous,
        tubePanel,
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
  return materials;
}
export type Materials = ReturnType<typeof createMaterials>;
