import * as THREE from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraViewMatrix,
  float,
  linearDepth,
  positionLocal,
  positionView,
  positionWorld,
  reflector,
  screenUV,
  select,
  uniform,
  vec2,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from "three/tsl";
import { tslExports } from "vgpu/three";
import waterModule from "@/shaders/water.wgsl";
import { POOL_WATER_Y } from "./acoustics";
import { WATER_RIPPLES, WaterRipples } from "./water-ripples";

export interface PoolWater {
  material: THREE.Material;
  update: (time: number) => void;
  /** Drop a ring packet at a world position, e.g. a footstep or a drip. */
  disturb: (x: number, z: number, strength: number) => void;
  /** Planar reflection resolution relative to the drawing buffer. */
  setReflectionScale: (scale: number) => void;
  dispose: () => void;
}

type Vec = Node;
type WaterExports = {
  waterPosition: { position: Vec; seconds: Vec };
  waterNormal: {
    local: Vec; world: Vec; eye: Vec; seconds: Vec;
    r0: Vec; r1: Vec; r2: Vec; r3: Vec; r4: Vec; r5: Vec; r6: Vec; r7: Vec;
  };
  waterShade: {
    normal: Vec; view: Vec; position: Vec; local: Vec; seconds: Vec;
    behind: Vec; thickness: Vec; reflected: Vec; mirror: Vec | number;
  };
};

/**
 * One shared water material for all resident pools. On WebGPU the surface
 * refracts the real scene behind it (scene colour and depth copied as the
 * water draws), so any basin outline or depth absorbs light correctly, and
 * one planar reflector serves every pool because they share one water height.
 */
export function createPoolWater(webgpu: boolean, scene: THREE.Scene): PoolWater {
  const ripples = new WaterRipples();
  if (webgpu) {
    const seconds = uniform(0);
    const rings = ripples.slots.map((slot) => uniform(slot));
    const { waterPosition, waterNormal, waterShade } = tslExports<WaterExports>(waterModule)(
      "waterPosition", "waterNormal", "waterShade",
    );
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    material.name = "vgpu-pool-water";
    material.positionNode = waterPosition({ position: positionLocal, seconds });
    const [r0, r1, r2, r3, r4, r5, r6, r7] = rings;
    const normal = waterNormal({
      local: positionLocal, world: positionWorld, eye: cameraPosition, seconds,
      r0, r1, r2, r3, r4, r5, r6, r7,
    }).toVar("poolNormal");
    const view = cameraPosition.sub(positionWorld).normalize().toVar("poolView");
    // Surface tilt in view space drives both screen-space displacements.
    const tilt = cameraViewMatrix.mul(vec4(normal.x, 0, normal.z, 0)).xy;
    const bend = vec2(tilt.x, tilt.y.negate()).toVar("poolBend");

    // Water thickness from the depth already in the buffer; view-Z metres
    // scaled to the actual ray length through the water.
    const depth = viewportDepthTexture();
    const metres = cameraFar.sub(cameraNear);
    const surface = linearDepth();
    const along = positionView.length().div(positionView.z.negate().max(0.001));
    const straight = linearDepth(depth.sample(screenUV)).sub(surface).mul(metres).max(0);
    // Parallax refraction: deeper water and closer views bend further.
    const shift = bend.mul(straight.min(2.5).mul(0.2).div(positionView.length().add(1.5)));
    const refractedUV = screenUV.add(shift).toVar("poolRefractedUV");
    const refracted = linearDepth(depth.sample(refractedUV)).sub(surface).mul(metres);
    // Never pull in things standing in front of the water (legs, pillars).
    const inside = refracted.greaterThan(0);
    const behind = viewportSharedTexture(select(inside, refractedUV, screenUV)).rgb;
    const thickness = select(inside, refracted, straight).mul(along);

    const mirror = reflector({ resolutionScale: 0.5, bounces: false });
    mirror.target.rotateX(-Math.PI / 2);
    mirror.target.position.y = POOL_WATER_Y;
    mirror.target.name = "pool-reflection-plane";
    scene.add(mirror.target);
    mirror.uvNode = mirror.uvNode!.add(bend.mul(float(0.9).div(positionView.length().add(2))));

    material.colorNode = waterShade({
      normal, view, position: positionWorld, local: positionLocal, seconds,
      behind, thickness, reflected: mirror.rgb, mirror: 1,
    }).rgb;
    return {
      material,
      update: (time) => {
        seconds.value = time;
        ripples.update(time);
      },
      disturb: (x, z, strength) => ripples.add(x, z, strength),
      setReflectionScale: (scale) => {
        mirror.reflector.resolutionScale = scale;
      },
      dispose: () => {
        scene.remove(mirror.target);
        mirror.dispose();
        material.dispose();
      },
    };
  }
  // Explicit GLSL equivalent of water.wgsl for browsers without WebGPU. There
  // is no scene capture here, so it assumes the standard 1.22m basin and
  // alpha-blends an equivalent absorption over the real floor.
  const waves = `
    vec3 poolWave(vec2 p, vec2 direction, float phase, float amplitude) {
      float angle = dot(p, direction) + phase;
      return vec3(direction * cos(angle) * amplitude, sin(angle) * amplitude);
    }
    vec3 poolWaves(vec2 p, float seconds) {
      return poolWave(p, vec2(1.7, 0.9), seconds * 0.72, 0.017)
        + poolWave(p, vec2(-0.8, 2.1), -seconds * 0.53, 0.012)
        + poolWave(p, vec2(3.4, -2.5), seconds * 0.37, 0.006);
    }`;
  const material = new THREE.ShaderMaterial({
    name: "compatible-pool-water",
    transparent: true,
    depthWrite: false,
    uniforms: { seconds: { value: 0 }, ripples: { value: ripples.slots } },
    vertexShader: `uniform float seconds; varying vec3 world; varying vec2 local;
      ${waves}
      void main() {
        vec3 p = position;
        local = p.xz;
        p.y += poolWaves(local, seconds).z;
        world = (modelMatrix * vec4(p, 1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }`,
    fragmentShader: `uniform float seconds; uniform vec4 ripples[${WATER_RIPPLES}];
      varying vec3 world; varying vec2 local;
      ${waves}
      vec2 poolChop(vec2 p, float s) {
        return (poolWave(p, vec2(7.3, 4.8), -s * 1.13, .004)
          + poolWave(p, vec2(-5.7, 9.2), s * .91, .003)
          + poolWave(p, vec2(13.1, -7.4), s * 1.31, .0012)
          + poolWave(p, vec2(-11.6, -9.9), s * 1.57, .0011)
          + poolWave(p, vec2(19.3, 6.1), -s * 1.83, .0006)
          + poolWave(p, vec2(-4.2, -17.8), s * 2.09, .0005)).xy;
      }
      vec2 ripple(vec2 p, vec4 r, float s) {
        float age = s - r.z;
        if (r.w <= 0. || age < 0. || age > 5.) return vec2(0.);
        vec2 offset = p - r.xy;
        float dist = length(offset);
        float front = .08 + age * .58;
        float k = 18. - min(age, 3.) * 2.5;
        float behind = front - dist;
        float packet = exp(-behind * behind * 5.) * (behind > 0. ? .55 : 1.);
        float fade = r.w * exp(-age * .9) / (1. + dist * 1.8);
        return offset / max(dist, .001) * cos(behind * k) * k * .0055 * packet * fade;
      }
      float causticField(vec2 p, float seconds) {
        vec2 q = mod(p, 6.2831853);
        float t = seconds * .42 + 23.;
        vec2 i = q;
        float c = 1.;
        for (int n = 0; n < 4; n++) {
          float s = t * (1. - 3.5 / float(n + 1));
          i = q + vec2(cos(s - i.x) + sin(s + i.y), sin(s - i.y) + cos(s + i.x));
          c += 1. / length(vec2(1.25 / sin(i.x + s), 1.25 / cos(i.y + s)));
        }
        c = 1.17 - pow(c / 4., 1.4);
        return pow(abs(c), 8.);
      }
      void main() {
        float detail = 1. - smoothstep(8., 32., length(cameraPosition - world));
        vec2 rings = vec2(0.);
        for (int n = 0; n < ${WATER_RIPPLES}; n++) rings += ripple(world.xz, ripples[n], seconds);
        vec2 slope = poolWaves(local, seconds).xy + poolChop(local, seconds) * detail
          + rings * mix(.45, 1., detail);
        vec3 normal = normalize(vec3(-slope.x, 1., -slope.y));
        vec3 view = normalize(cameraPosition - world);
        float facing = clamp(dot(normal, view), 0., 1.);
        float fresnel = .02 + .98 * pow(1. - facing, 5.);
        // Look fixtures up through the broad swell only: the sharp analytic
        // panels otherwise shatter into bright curls on the fine chop.
        vec2 broad = poolWaves(local, seconds).xy + rings * .35;
        vec3 reflection = reflect(-view, normalize(vec3(-broad.x, 1., -broad.y)));
        vec2 hit = world.xz + reflection.xz * (6.98 / max(reflection.y, .06));
        vec2 fixture = abs(fract(hit / 4.8) - .5) * 4.8;
        float blur = .16 + (1. - facing) * .3;
        float visible = smoothstep(.12, .38, reflection.y);
        float core = visible * (1. - smoothstep(1.04 - blur, 1.20 + blur, fixture.x))
          * (1. - smoothstep(.15, .27 + blur, fixture.y));
        float halo = visible * (1. - smoothstep(.95, 1.48, fixture.x))
          * (1. - smoothstep(.20, .65, fixture.y));
        vec3 mirrored = vec3(.48, .47, .29) + (core * 1.65 + halo * .16) * vec3(1., .97, .72);
        vec3 ray = refract(-view, normal, .75);
        float depth = 1.22 / max(-ray.y, .2);
        vec3 transmittance = exp(-depth * vec3(.40, .24, .70));
        float through = dot(transmittance, vec3(.3, .5, .2)) * (1. - fresnel);
        float pattern = causticField((local + ray.xz * depth) * 2.6, seconds);
        vec3 scatter = vec3(.15, .18, .07) * (1. - transmittance) * (1. - fresnel);
        vec3 light = pattern * vec3(.3, .31, .2) * through;
        float alpha = clamp(1. - through, 0., 1.);
        gl_FragColor = vec4((scatter + mirrored * fresnel + light) / max(alpha, .05), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return {
    material,
    update: (time) => {
      material.uniforms.seconds.value = time;
      ripples.update(time);
    },
    disturb: (x, z, strength) => ripples.add(x, z, strength),
    setReflectionScale: () => {},
    dispose: () => material.dispose(),
  };
}
