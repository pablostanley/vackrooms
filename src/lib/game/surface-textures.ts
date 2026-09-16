import * as THREE from "three";
import { random } from "./maze";

export type Surface = "wallpaper" | "carpet" | "ceiling" | "plaster" | "wood";

// One shared set per material, never per section. Dimensions are in meters.
export const SURFACE_SIZE: Record<Surface, number> = {
  wallpaper: 1.2,
  carpet: 2.4,
  ceiling: 1.2,
  plaster: 2.4,
  wood: 1.2,
};

const palettes: Record<Surface, readonly [number, number, number]> = {
  wallpaper: [201, 188, 107],
  carpet: [161, 144, 92],
  ceiling: [190, 181, 121],
  // Neutral maps let the existing plaster and furniture colors tint them.
  plaster: [235, 233, 220],
  wood: [229, 217, 197],
};

const smooth = (v: number) => v * v * (3 - 2 * v);
const fract = (v: number) => v - Math.floor(v);

/** Periodic, interpolated noise: the wrap has exactly the same slope as the interior. */
function noise(size: number, columns: number, rows: number, seed: number) {
  const rng = random(seed);
  const grid = Float32Array.from({ length: columns * rows }, () => rng());
  const result = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * rows;
    const iy = Math.floor(gy);
    const sy = smooth(fract(gy));
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * columns;
      const ix = Math.floor(gx);
      const sx = smooth(fract(gx));
      const a = grid[iy * columns + ix];
      const b = grid[iy * columns + ((ix + 1) % columns)];
      const c = grid[((iy + 1) % rows) * columns + ix];
      const d = grid[((iy + 1) % rows) * columns + ((ix + 1) % columns)];
      result[y * size + x] = a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
    }
  }
  return result;
}

/** Bake color, relief, and roughness together; no painted-in directional lighting. */
export function bakeSurface(surface: Surface, size = 512) {
  const seed = { wallpaper: 83, carpet: 129, ceiling: 871, plaster: 566, wood: 947 }[surface];
  const broad = noise(size, 4, 4, seed);
  const medium = noise(size, 19, 19, seed + 1);
  const fine = noise(size, 91, 87, seed + 2);
  const fibers = noise(size, 211, surface === "wood" ? 5 : 137, seed + 3);
  const rng = random(seed + 4);
  const color = new Uint8Array(size * size * 4);
  const detailMap = new Uint8Array(size * size * 4);
  const base = palettes[surface];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const macro = broad[i] - 0.5, detail = fine[i] - 0.5;
      const grain = rng() - 0.5;
      let shade = 0, relief = 0, rough = 1;
      if (surface === "wallpaper") {
        // A faded small leaf emboss, over irregular vertical paper fibers.
        const row = Math.floor(v * 6);
        const mx = (fract(u * 8 + (row % 2) * 0.5) - 0.5) * 2;
        const my = (fract(v * 6) - 0.5) * 2;
        const leaf = Math.max(0, 1 - Math.abs(Math.abs(mx) - 0.34 * Math.cos(my * Math.PI / 2)) * 30)
          * Math.max(0, 1 - Math.abs(my));
        const paper = Math.sin(u * Math.PI * 192 + Math.sin(v * Math.PI * 8) * 0.45);
        shade = macro * 6 + detail * 4 + grain * 3 - leaf * 6 + paper * 0.7;
        relief = detail * 0.16 + grain * 0.045 + paper * 0.035 + leaf * 0.16;
        rough = 0.89 + medium[i] * 0.08;
      } else if (surface === "carpet") {
        // Dense uneven loop pile with gentle changes in nap, without carpet tiles.
        const pile = fibers[i] - 0.5;
        const nap = (medium[i] - 0.5) * 0.6 + macro;
        shade = nap * 8 + pile * 16 + detail * 7 + grain * 5;
        relief = pile * 0.65 + detail * 0.3 + grain * 0.14;
        rough = 0.94 + medium[i] * 0.06;
      } else if (surface === "ceiling") {
        // Mineral-fiber board, with sparse irregular fissures and recessed T seams.
        const pore = Math.max(0, (0.33 - fibers[i]) / 0.33);
        const edgeX = Math.min(fract(u * 2), 1 - fract(u * 2)) * 0.6;
        const edgeY = Math.min(v, 1 - v) * 1.2;
        const seam = 1 - smooth(Math.min(1, Math.min(edgeX, edgeY) / 0.004));
        shade = macro * 5 + detail * 6 + grain * 3 - pore * 18 - seam * 13;
        relief = detail * 0.09 - pore * 0.32 - seam * 0.4;
        rough = 0.93 + medium[i] * 0.07;
      } else if (surface === "plaster") {
        shade = macro * 7 + (medium[i] - 0.5) * 5 + detail * 2 + grain;
        relief = (medium[i] - 0.5) * 0.13 + detail * 0.1 + grain * 0.015;
        rough = 0.78 + broad[i] * 0.16 + detail * 0.04;
      } else {
        // Long, wandering wood pores, never high-contrast zebra stripes.
        const pore = fibers[i] - 0.5;
        shade = macro * 9 + pore * 24 + detail * 3;
        relief = pore * 0.22 + detail * 0.04;
        rough = 0.72 + medium[i] * 0.17;
      }
      for (let c = 0; c < 3; c++) {
        color[i * 4 + c] = Math.max(0, Math.min(255, Math.round(base[c] + shade)));
      }
      // Three samples bump from R and roughness from G. Reusing this texture
      // leaves room for the game's fixture shadows on 16-texture GPUs.
      detailMap[i * 4] = Math.round(Math.max(0, Math.min(1, 0.5 + relief)) * 255);
      detailMap[i * 4 + 1] = Math.round(rough * 255);
      detailMap[i * 4 + 2] = 0;
      color[i * 4 + 3] = detailMap[i * 4 + 3] = 255;
    }
  }
  return { color, detail: detailMap, size };
}

export function createSurfaceTextures(surface: Surface) {
  const data = bakeSurface(surface);
  function texture(bytes: Uint8Array, color = false) {
    const result = new THREE.DataTexture(bytes, data.size, data.size, THREE.RGBAFormat);
    result.name = `${surface}-${color ? "color" : "detail"}`;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 8;
    result.needsUpdate = true;
    return result;
  }
  const detail = texture(data.detail);
  return {
    map: texture(data.color, true),
    bumpMap: detail,
    roughnessMap: detail,
    bumpScale: { wallpaper: 0.008, carpet: 0.01, ceiling: 0.012, plaster: 0.015, wood: 0.006 }[surface],
  };
}

/** WebGL otherwise spends two sampler slots on the same packed texture.
 * WebGPU shares the texture binding automatically and ignores this GL hook.
 * Reapply after Material.clone(), which intentionally does not copy hooks.
 */
export function configureSurfaceSampling(material: THREE.MeshStandardMaterial) {
  if (!material.bumpMap || material.bumpMap !== material.roughnessMap) return;
  material.onBeforeCompile = function (this: THREE.MeshStandardMaterial, shader) {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <roughnessmap_pars_fragment>", "")
      .replace(
        "#include <roughnessmap_fragment>",
        THREE.ShaderChunk.roughnessmap_fragment
          .replaceAll("roughnessMap", "bumpMap")
          .replaceAll("vRoughnessMapUv", "vBumpMapUv"),
      );
    // Dark rooms use one linear mask for both ambient fill and emission.
    // Sharing that sampler also leaves space for Three's built-in DFG lookup.
    if (this.aoMap && this.aoMap === this.emissiveMap)
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <emissivemap_pars_fragment>", "")
        .replace(
          "#include <emissivemap_fragment>",
          THREE.ShaderChunk.emissivemap_fragment
            .replaceAll("emissiveMap", "aoMap")
            .replaceAll("vEmissiveMapUv", "vAoMapUv"),
        );
  };
  material.customProgramCacheKey = function (this: THREE.MeshStandardMaterial) {
    return `packed-surface-v2:${Boolean(this.aoMap && this.aoMap === this.emissiveMap)}`;
  };
}

/** Project only channel 0. Lighting owns the independent uv1 ambient map. */
export function projectSurfaceUVs(geometry: THREE.BufferGeometry, meters: number) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    // Consistent handedness keeps relief raised on opposite sides of a wall.
    if (Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz)))
      uv.setXY(i, x / meters, (ny > 0 ? -z : z) / meters);
    else if (Math.abs(nx) > Math.abs(nz))
      uv.setXY(i, (nx > 0 ? -z : z) / meters, y / meters);
    else uv.setXY(i, (nz > 0 ? x : -x) / meters, y / meters);
  }
  uv.needsUpdate = true;
}
