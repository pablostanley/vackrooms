import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  bakeSurface,
  configureSurfaceSampling,
  createSurfaceTextures,
  projectSurfaceUVs,
  SURFACE_SIZE,
  type Surface,
} from "../src/lib/game/surface-textures";

test("surface maps stay deterministic, warm, and within a two-texture GPU budget", () => {
  for (const surface of Object.keys(SURFACE_SIZE) as Surface[]) {
    const a = bakeSurface(surface, 64);
    const b = bakeSurface(surface, 64);
    assert.deepEqual(a, b);
    assert.ok(new Set(a.color).size > 20, `${surface} has actual surface variation`);
    for (let i = 0; i < a.color.length; i += 4) {
      assert.ok(a.color[i] >= a.color[i + 2], "no blue cast");
      assert.equal(a.color[i + 3], 255);
      assert.ok(a.detail[i + 1] >= 180, "keep roughness restrained");
    }
    const maps = createSurfaceTextures(surface);
    assert.equal(maps.bumpMap, maps.roughnessMap, "height and roughness share one GPU binding");
    assert.equal(maps.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(maps.bumpMap.colorSpace, THREE.NoColorSpace);
    for (const texture of [maps.map, maps.bumpMap]) {
      assert.equal(texture.wrapS, THREE.RepeatWrapping);
      assert.equal(texture.wrapT, THREE.RepeatWrapping);
      assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
      assert.equal(texture.generateMipmaps, true);
      texture.dispose();
    }
  }
});

test("WebGL reuses packed and room-mask samplers, including on section material clones", () => {
  const maps = createSurfaceTextures("wallpaper");
  const original = new THREE.MeshStandardMaterial(maps);
  const material = original.clone();
  material.aoMap = material.emissiveMap = new THREE.DataTexture();
  configureSurfaceSampling(material);
  const shader = {
    fragmentShader: [
      "#include <roughnessmap_pars_fragment>",
      "#include <roughnessmap_fragment>",
      "#include <emissivemap_pars_fragment>",
      "#include <emissivemap_fragment>",
    ].join("\n"),
    vertexShader: "",
    uniforms: {},
  };
  material.onBeforeCompile(
    shader as Parameters<THREE.MeshStandardMaterial["onBeforeCompile"]>[0],
    {} as THREE.WebGLRenderer,
  );
  assert.match(shader.fragmentShader, /texture2D\( bumpMap, vBumpMapUv \)/);
  assert.match(shader.fragmentShader, /texture2D\( aoMap, vAoMapUv \)/);
  assert.doesNotMatch(shader.fragmentShader, /uniform sampler2D/);
  const sharedKey = material.customProgramCacheKey();
  material.emissiveMap = null;
  assert.notEqual(material.customProgramCacheKey(), sharedKey);
  material.aoMap.dispose();
  maps.map.dispose();
  maps.bumpMap.dispose();
  material.dispose();
  original.dispose();
});

test("texture edges do not introduce a visible repeated carpet or plaster seam", () => {
  for (const surface of ["carpet", "plaster"] as const) {
    const { color, size } = bakeSurface(surface);
    let seam = 0, interior = 0;
    for (let y = 0; y < size; y++) {
      seam += Math.abs(color[y * size * 4] - color[(y * size + size - 1) * 4]);
      seam += Math.abs(color[y * 4] - color[((size - 1) * size + y) * 4]);
      for (let x = 1; x < size; x++)
        interior += Math.abs(color[(y * size + x) * 4] - color[(y * size + x - 1) * 4]);
    }
    assert.ok(seam / (size * 2) < (interior / (size * (size - 1))) * 1.4);
  }
});

test("floor mapping matches across positive and negative section boundaries without touching AO", () => {
  const planes = [-57.6, 0, 57.6].map((offset) => {
    const geometry = new THREE.PlaneGeometry(57.6, 57.6)
      .rotateX(-Math.PI / 2)
      .translate(offset + 28.8, 0, 28.8);
    const ambient = new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2);
    geometry.setAttribute("uv1", ambient);
    projectSurfaceUVs(geometry, 2.4);
    assert.equal(geometry.getAttribute("uv1"), ambient);
    return geometry;
  });
  for (let p = 0; p < 2; p++) {
    const left = planes[p].getAttribute("uv");
    const right = planes[p + 1].getAttribute("uv");
    for (const [a, b] of [[1, 0], [3, 2]]) {
      assert.ok(Math.abs(left.getX(a) - right.getX(b)) < 0.00001);
      assert.ok(Math.abs(left.getY(a) - right.getY(b)) < 0.00001);
    }
  }
  planes.forEach((geometry) => geometry.dispose());
});

test("wall relief keeps upward V and consistent scale on every box face", () => {
  const box = new THREE.BoxGeometry(4.8, 3.2, 0.18);
  projectSurfaceUVs(box, 1.2);
  const uv = box.getAttribute("uv");
  const position = box.getAttribute("position");
  const normal = box.getAttribute("normal");
  for (let i = 0; i < position.count; i++) {
    assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)));
    if (!normal.getY(i))
      assert.ok(Math.abs(uv.getY(i) - position.getY(i) / 1.2) < 0.00001);
  }
  box.dispose();
});
