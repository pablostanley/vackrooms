import * as THREE from "three";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { builtinAOContext, mix, mrt, normalView, pass, rtt, screenUV } from "three/tsl";

/** Half-resolution contact shading, capped independently of the main picture. */
export function contactShadowScale(width: number, height: number) {
  return Math.min(0.5, Math.sqrt((960 * 540) / Math.max(1, width * height)));
}

export function createGPUContactShadows(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
) {
  // The prepass stores geometric normals rather than the fine normal-map grain:
  // contact occlusion should describe the room, not dirty every carpet fiber.
  const geometry = pass(scene, camera, { samples: 0 });
  geometry.transparent = false;
  geometry.setMRT(mrt({ output: normalView }));
  const normals = geometry.getTextureNode("output");
  const depth = geometry.getTextureNode("depth");
  const occlusion = ao(depth, normals, camera);
  occlusion.radius.value = 0.65;
  occlusion.thickness.value = 0.3;
  occlusion.samples.value = 8;
  const filtered = denoise(occlusion.getTextureNode(), depth, normals, camera);
  filtered.radius.value = 3;
  const texture = rtt(filtered);
  // Apply to indirect light only, alongside each section's existing outage
  // mask. Fluorescent panels, direct illumination, and water keep their light.
  const context = builtinAOContext(mix(1, texture.sample(screenUV).r, 0.85));
  return {
    context,
    resize: (width: number, height: number) => {
      const scale = contactShadowScale(width, height);
      geometry.setResolutionScale(scale);
      occlusion.resolutionScale = scale;
      texture.setResolutionScale(scale);
    },
    dispose: () => {
      texture.dispose();
      filtered.dispose();
      occlusion.dispose();
      geometry.dispose();
    },
  };
}

export function createGLContactShadows(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  target: THREE.WebGLRenderTarget,
) {
  target.depthTexture = new THREE.DepthTexture(1, 1);
  // Reuse the main picture's depth, reconstructing normals in the AO shader.
  // No second scene render or shadow-map update is needed on the fallback.
  const occlusion = new GTAOPass(scene, camera, 1, 1);
  occlusion.setGBuffer(target.depthTexture);
  occlusion.output = GTAOPass.OUTPUT.Off;
  occlusion.updateGtaoMaterial({ radius: 0.65, thickness: 0.3, samples: 8 });
  occlusion.updatePdMaterial({ radius: 3, samples: 8 });
  return {
    texture: occlusion.gtaoMap,
    resize: (width: number, height: number) => {
      const scale = contactShadowScale(width, height);
      occlusion.setSize(
        Math.max(1, Math.floor(width * scale)),
        Math.max(1, Math.floor(height * scale)),
      );
    },
    render: (renderer: THREE.WebGLRenderer) => {
      occlusion.render(renderer, target, target, 0, false);
    },
    dispose: () => {
      occlusion.dispose();
      // Three r186's GTAOPass.dispose omits these two owned materials.
      occlusion.gtaoMaterial.dispose();
      occlusion.blendMaterial.dispose();
    },
  };
}
