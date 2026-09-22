import * as THREE from "three";
import { createRenderer } from "../../src/lib/game/renderer";
import { createMaterials } from "../../src/lib/game/materials";

/** Browser integration check; run with ?renderer=webgl, outside the Node suite. */
export async function checkWebGLTone(forceByteTarget = false, fixture?: "luminous" | "lampGlow") {
  const original = WebGL2RenderingContext.prototype.getExtension;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 3;
  const geometry = new THREE.PlaneGeometry(10, 10);
  const fixtureMaterials = fixture ? createMaterials() : undefined;
  const material = fixtureMaterials && fixture ? fixtureMaterials[fixture] : new THREE.MeshBasicMaterial({
    // The supported path must retain an HDR channel above 1. Byte targets are
    // intentionally checked only inside their representable color range.
    color: new THREE.Color(0.18, 0.45, forceByteTarget ? 0.75 : 2.5),
  });
  // Sample one actual diffuser texel independent of quality resolution.
  if (fixture) {
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5);
  }
  scene.add(new THREE.Mesh(geometry, material));
  const settings = { quality: "balanced" as const, tapeEffects: false, contactShadows: false };
  let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined;
  try {
    if (forceByteTarget) {
      WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
        return (name === "EXT_color_buffer_float" || name === "EXT_color_buffer_half_float")
          ? null : Reflect.apply(original, this, [name]);
      } as typeof original;
    }
    renderer = await createRenderer(scene, camera, { ...settings, contactShadows: true, tapeEffects: true });
    if (renderer.backend !== "WebGL") throw new Error("Use ?renderer=webgl");
    renderer.resize(64, 64);
    const gl = renderer.canvas.getContext("webgl2")!;
    // Exercise real effect-enabled defaults before changing any preference.
    renderer.render(0, 0, 0);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL error with default effects");
    if (forceByteTarget && renderer.canvas.dataset.contactShadows === "true")
      throw new Error("Unsupported AO still enabled");
    const samples: { quality: string; post: boolean; pixel: number[] }[] = [];
    for (const quality of ["balanced", "low", "high", "balanced"] as const)
      for (const post of [false, true, false, true]) {
        renderer.updateSettings({ ...settings, quality,
          // White AO on a single plane does not alter color. The byte fallback
          // must ignore the requested AO and still run its neutral tape pass.
          contactShadows: post,
          tapeEffects: forceByteTarget && post,
        });
        renderer.render(0, 0, 0);
        const pixel = new Uint8Array(4);
        gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL error during setting toggle");
        samples.push({ quality, post, pixel: Array.from(pixel) });
      }
    const reference = samples[0].pixel;
    if (fixture && (!material.toneMapped || reference[0] < 225 || reference[1] < 215 || reference[2] >= reference[1]))
      throw new Error("Fixture must stay bright, warm, and use the common tone-mapping policy");
    const maxDifference = Math.max(...samples.flatMap(({ pixel }) =>
      pixel.slice(0, 3).map((channel, i) => Math.abs(channel - reference[i]))));
    if (maxDifference > 1) throw new Error(`Tone mapping changed by ${maxDifference} channel levels`);
    return { target: forceByteTarget ? "byte" : "half-float", fixture, reference, maxDifference, samples: samples.length };
  } finally {
    renderer?.dispose(); geometry.dispose();
    if (fixtureMaterials) fixtureMaterials.dispose();
    else material.dispose();
    WebGL2RenderingContext.prototype.getExtension = original;
  }
}
