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
    const { waterColor, waterPosition } = tslExports<{
      waterColor: WaveInputs & { eye: Node };
      waterPosition: WaveInputs;
    }>(waterModule)("waterColor", "waterPosition");
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    });
    material.name = "vgpu-pool-water";
    material.positionNode = waterPosition({ position: positionLocal, seconds });
    material.colorNode = waterColor({
      position: positionWorld,
      eye: cameraPosition,
      seconds,
    });
    return {
      material,
      update: (time: number) => {
        seconds.value = time;
      },
    };
  }
  // Keep the same pool playable on browsers without WebGPU. The primary path
  // above uses the authored WGSL through vgpu; this is an explicit GLSL fallback.
  const material = new THREE.ShaderMaterial({
    name: "compatible-pool-water",
    transparent: true,
    depthWrite: false,
    uniforms: { seconds: { value: 0 } },
    vertexShader: `uniform float seconds; varying vec3 world;
      void main() {
        vec3 p = position;
        p.y += sin(dot(p.xz,vec2(1.7,.9))+seconds*.72)*.017
          + sin(dot(p.xz,vec2(-.8,2.1))-seconds*.53)*.012;
        world = (modelMatrix*vec4(p,1.)).xyz;
        gl_Position = projectionMatrix*viewMatrix*vec4(world,1.);
      }`,
    fragmentShader: `uniform float seconds; varying vec3 world;
      void main() {
        vec2 p = world.xz;
        vec2 slope = vec2(1.7,.9)*cos(dot(p,vec2(1.7,.9))+seconds*.72)*.017
          + vec2(-.8,2.1)*cos(dot(p,vec2(-.8,2.1))-seconds*.53)*.012
          + vec2(3.4,-2.5)*cos(dot(p,vec2(3.4,-2.5))+seconds*.37)*.004;
        vec3 n = normalize(vec3(-slope.x,1.,-slope.y));
        vec3 v = normalize(cameraPosition-world);
        float f = .035+.965*pow(1.-max(dot(n,v),0.),5.);
        vec3 r = reflect(-v,n);
        vec2 hit = p+r.xz*(6.98/max(r.y,.045));
        vec2 fixture = abs(fract(hit/4.8)-.5)*4.8;
        float glow = (1.-smoothstep(1.08,1.32,fixture.x))*(1.-smoothstep(.23,.43,fixture.y));
        vec2 q = p+slope*3.5;
        float a = sin(q.x*2.9+sin(q.y*1.8+seconds*.24));
        float b = sin(q.y*3.1-sin(q.x*1.6-seconds*.21));
        float c = pow(1.-abs(a*b),12.);
        vec3 body = vec3(.30,.34,.145)+c*vec3(.10,.105,.055);
        vec3 reflected = vec3(.53,.50,.29)+glow*vec3(1.1,1.05,.68);
        gl_FragColor = vec4(mix(body,reflected,.18+f*.72),.86);
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
