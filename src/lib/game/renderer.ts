import * as THREE from "three";
import { WebGPURenderer, RenderPipeline, type Node } from "three/webgpu";
import { pass, uniform, uv, vec2, vec3, max } from "three/tsl";
import { tslExports } from "vgpu/three";
import tapeModule from "@/shaders/tape.wgsl";

type WarpInputs = { uv: Node; seconds: Node; damage: Node; anomaly: Node };
type GradeInputs = WarpInputs & { color: Node };
export interface GameRenderer {
  canvas: HTMLCanvasElement;
  backend: "WebGPU · vgpu" | "WebGL";
  resize: (w: number, h: number) => void;
  render: (time: number, damage: number, stress: number) => void;
  dispose: () => void;
}

export async function createRenderer(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<GameRenderer> {
  if (navigator.gpu) {
    let renderer: WebGPURenderer | undefined;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        renderer = new WebGPURenderer({
          antialias: true,
          powerPreference: "high-performance",
        });
        await renderer.init();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        const pipeline = new RenderPipeline(renderer);
        const scenePass = pass(scene, camera);
        const cameraTexture = scenePass.getTextureNode("output");
        const seconds = uniform(0),
          damage = uniform(0.7),
          anomaly = uniform(0);
        const { tapeWarp, tapeGrade } = tslExports<{
          tapeWarp: WarpInputs;
          tapeGrade: GradeInputs;
        }>(tapeModule)("tapeWarp", "tapeGrade");
        const coordinates = uv(),
          inputs = { uv: coordinates, seconds, damage, anomaly };
        const warped = tapeWarp(inputs);
        const bleed = vec2(damage.mul(0.0007).add(anomaly.mul(0.003)), 0);
        const picture = vec3(
          cameraTexture.sample(warped.add(bleed)).r,
          cameraTexture.sample(warped).g,
          cameraTexture.sample(warped.sub(bleed)).b,
        );
        // A narrow analog low-pass softens detail without smearing room silhouettes.
        const softness = vec2(damage.mul(0.0015), 0);
        const soft = picture
          .mul(0.6)
          .add(cameraTexture.sample(warped.add(softness)).rgb.mul(0.2))
          .add(cameraTexture.sample(warped.sub(softness)).rgb.mul(0.2));
        // Only overexposed fluorescent highlights spill into the surrounding tape.
        const halo = vec2(0.0035, 0.0025);
        const glow = max(
          cameraTexture.sample(warped.add(halo)).rgb.sub(0.82),
          0,
        )
          .add(max(cameraTexture.sample(warped.sub(halo)).rgb.sub(0.82), 0))
          .add(
            max(
              cameraTexture
                .sample(warped.add(vec2(halo.x, halo.y.negate())))
                .rgb.sub(0.82),
              0,
            ),
          )
          .add(
            max(
              cameraTexture
                .sample(warped.sub(vec2(halo.x, halo.y.negate())))
                .rgb.sub(0.82),
              0,
            ),
          );
        pipeline.outputNode = tapeGrade({
          ...inputs,
          color: soft.add(glow.mul(0.075)),
        });
        const gpuRenderer = renderer;
        return {
          canvas: renderer.domElement,
          backend: "WebGPU · vgpu",
          resize: (w, h) => {
            gpuRenderer.setSize(w, h);
          },
          render: (t, d, s) => {
            seconds.value = t;
            damage.value = d;
            anomaly.value = s;
            pipeline.render();
          },
          dispose: () => {
            pipeline.dispose();
            scenePass.dispose();
            gpuRenderer.dispose();
          },
        };
      }
    } catch (error) {
      renderer?.dispose();
      console.warn(
        "WebGPU is unavailable; using the compatible renderer.",
        error,
      );
    }
  }
  // Browsers without WebGPU get the same playable maze and a GLSL tape pass.
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const target = new THREE.WebGLRenderTarget(1, 1);
  const postScene = new THREE.Scene(),
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      image: { value: target.texture },
      seconds: { value: 0 },
      damage: { value: 0.7 },
      anomaly: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader:
      "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }",
    fragmentShader: `uniform sampler2D image; uniform float seconds; uniform float damage; uniform float anomaly; varying vec2 vUv;
      float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){vec2 p=vUv; vec2 c=p-.5; p+=c*dot(c,c)*.032*damage;
      p.x+=(noise(vec2(floor(p.y*480.),floor(seconds*24.)))-.5)*.0012*damage+sin(p.y*80.+seconds*21.)*anomaly*.032*damage;
      float bleed=damage*.0007+anomaly*.003;vec3 color=vec3(texture2D(image,p+vec2(bleed,0)).r,texture2D(image,p).g,texture2D(image,p-vec2(bleed,0)).b);
      vec2 soft=vec2(damage*.0015,0.);color=color*.6+texture2D(image,p+soft).rgb*.2+texture2D(image,p-soft).rgb*.2;
      vec2 halo=vec2(.0035,.0025);vec3 glow=max(texture2D(image,p+halo).rgb-.82,0.)+max(texture2D(image,p-halo).rgb-.82,0.)+max(texture2D(image,p+vec2(halo.x,-halo.y)).rgb-.82,0.)+max(texture2D(image,p-vec2(halo.x,-halo.y)).rgb-.82,0.);color+=glow*.075;
      float v=pow(clamp(vUv.x*(1.-vUv.x)*vUv.y*(1.-vUv.y)*16.,0.,1.),.065);color*=mix(1.,v*.97,damage*.8);
      color+=(noise(floor(vUv*vec2(1280.,960.))+floor(seconds*29.97))-.5)*.013*damage;gl_FragColor=vec4(color,1.);}`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  postScene.add(quad);
  return {
    canvas: renderer.domElement,
    backend: "WebGL",
    resize: (w, h) => {
      renderer.setSize(w, h);
      target.setSize(
        Math.floor(w * renderer.getPixelRatio()),
        Math.floor(h * renderer.getPixelRatio()),
      );
    },
    render: (t, d, s) => {
      material.uniforms.seconds.value = t;
      material.uniforms.damage.value = d;
      material.uniforms.anomaly.value = s;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    dispose: () => {
      quad.geometry.dispose();
      material.dispose();
      target.dispose();
      renderer.dispose();
    },
  };
}
