import * as THREE from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  cameraPosition,
  positionLocal,
  positionWorld,
  uniform,
} from "three/tsl";
import { tslExports } from "vgpu/three";
import waterModule from "@/shaders/water.wgsl";

type WaveInputs = { position: Node; seconds: Node };

/** One shared water material and clock for all resident pools. */
export function createPoolWater(webgpu: boolean) {
  if (webgpu) {
    const seconds = uniform(0);
    const { waterSurface, waterPosition } = tslExports<{
      waterSurface: WaveInputs & { local: Node; eye: Node };
      waterPosition: WaveInputs;
    }>(waterModule)("waterSurface", "waterPosition");
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    material.name = "vgpu-pool-water";
    material.positionNode = waterPosition({ position: positionLocal, seconds });
    const surface = waterSurface({
      position: positionWorld,
      local: positionLocal,
      eye: cameraPosition,
      seconds,
    }).toVar("poolSurface");
    material.colorNode = surface.rgb;
    material.opacityNode = surface.a;
    return {
      material,
      update: (time: number) => {
        seconds.value = time;
      },
    };
  }
  // Explicit GLSL equivalent of water.wgsl for browsers without WebGPU.
  // Shared helpers keep the displaced mesh and its shading normal in phase.
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
    uniforms: { seconds: { value: 0 } },
    vertexShader: `uniform float seconds; varying vec3 world; varying vec2 local;
      ${waves}
      void main() {
        vec3 p = position;
        local = p.xz;
        p.y += poolWaves(local, seconds).z;
        world = (modelMatrix * vec4(p, 1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }`,
    fragmentShader: `uniform float seconds; varying vec3 world; varying vec2 local;
      ${waves}
      void main() {
        vec2 p = local;
        float distanceToEye = length(cameraPosition - world);
        float detail = 1. - smoothstep(8., 32., distanceToEye);
        vec3 drift = poolWaves(p, seconds);
        vec3 fine = poolWave(p, vec2(7.3, 4.8), -seconds * 1.13, .004)
          + poolWave(p, vec2(-5.7, 9.2), seconds * .91, .003)
          + poolWave(p, vec2(13.1, -7.4), seconds * 1.31, .0012);
        vec2 slope = drift.xy + fine.xy * detail;
        vec3 normal = normalize(vec3(-slope.x, 1., -slope.y));
        vec3 view = normalize(cameraPosition - world);
        float facing = clamp(dot(normal, view), 0., 1.);
        float fresnel = .025 + .975 * pow(1. - facing, 5.);
        vec3 reflection = reflect(-view, normal);
        vec2 ceilingHit = world.xz + reflection.xz * (6.98 / max(reflection.y, .06));
        vec2 fixture = abs(fract(ceilingHit / 4.8) - .5) * 4.8;
        float blur = .07 + (1. - facing) * .16;
        float ceilingVisibility = smoothstep(.12, .38, reflection.y);
        float core = ceilingVisibility * (1. - smoothstep(1.04 - blur, 1.20 + blur, fixture.x))
          * (1. - smoothstep(.15, .27 + blur, fixture.y));
        float halo = ceilingVisibility * (1. - smoothstep(.95, 1.48, fixture.x))
          * (1. - smoothstep(.20, .65, fixture.y));
        vec3 reflectedRoom = vec3(.48, .47, .29)
          + (core * 1.65 + halo * .16) * vec3(1., .97, .72);
        vec3 ray = refract(-view, normal, .75);
        vec2 floorPoint = p + ray.xz * (1.22 / max(-ray.y, .2));
        vec2 q = floorPoint + drift.xy * 2.6;
        float a = sin(q.x * 2.7 + sin(q.y * 1.9 - seconds * .31) + seconds * .23);
        float b = sin(q.y * 2.4 + sin(q.x * 1.6 + seconds * .27) - seconds * .19);
        float caustic = pow(1. - abs((a + b) * .5), 10.);
        float broad = sin(q.x * .43 + q.y * .31 + seconds * .12)
          * sin(q.y * .57 - q.x * .23 - seconds * .09);
        float absorption = 1. - exp(-.32 / max(facing, .22));
        vec3 body = mix(vec3(.29, .34, .19), vec3(.19, .25, .12), absorption)
          + broad * vec3(.012, .016, .008)
          + caustic * vec3(.055, .061, .029) * (1. - fresnel);
        float reflectance = .10 + fresnel * .80;
        vec3 color = mix(body, reflectedRoom, reflectance);
        float opacity = clamp(.43 + absorption * .18 + fresnel * .36 + core * .08, 0., .94);
        gl_FragColor = vec4(color, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return {
    material,
    update: (time: number) => {
      material.uniforms.seconds.value = time;
    },
  };
}
