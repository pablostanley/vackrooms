import * as THREE from "three";
import { WebGPURenderer, RenderPipeline, type Node } from "three/webgpu";
import { pass, uniform, uv, vec2, vec3, max } from "three/tsl";
import { tslExports } from "vgpu/three";
import tapeModule from "@/shaders/tape.wgsl";
import { createPoolWater } from "./pool-water";
import { RenderResolution } from "./render-resolution";

type WarpInputs = { uv: Node; seconds: Node; damage: Node; anomaly: Node };
type GradeInputs = WarpInputs & { color: Node };
export interface GameRenderer {
  canvas: HTMLCanvasElement;
  backend: "WebGPU · vgpu" | "WebGL";
  waterMaterial: THREE.Material;
  resize: (w: number, h: number) => void;
  recordFrame: (milliseconds: number, playing: boolean) => void;
  render: (time: number, damage: number, stress: number) => void;
  dispose: () => void;
}

export async function createRenderer(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<GameRenderer> {
  const resolution = new RenderResolution();
  let width = 1,
    height = 1;
  const forceWebGL = process.env.NODE_ENV === "development" &&
    new URLSearchParams(location.search).get("renderer") === "webgl";
  if (navigator.gpu && !forceWebGL) {
    let renderer: WebGPURenderer | undefined;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        renderer = new WebGPURenderer({
          antialias: true,
          powerPreference: "high-performance",
        });
        await renderer.init();
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
        const bleed = vec2(damage.mul(0.0007).add(anomaly.mul(0.0008)), 0);
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
        const water = createPoolWater(true);
        const resize = () => {
          gpuRenderer.setPixelRatio(
            resolution.pixelRatio(width, height, window.devicePixelRatio),
          );
          gpuRenderer.setSize(width, height);
        };
        return {
          canvas: renderer.domElement,
          backend: "WebGPU · vgpu",
          waterMaterial: water.material,
          resize: (w, h) => {
            width = w;
            height = h;
            resolution.resetSampling();
            resize();
          },
          recordFrame: (milliseconds, playing) => {
            if (resolution.recordFrame(milliseconds, playing)) resize();
          },
          render: (t, d, s) => {
            water.update(t);
            seconds.value = t;
            damage.value = d;
            anomaly.value = s;
            pipeline.render();
          },
          dispose: () => {
            water.material.dispose();
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
  const water = createPoolWater(false);
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
      float frame=floor(seconds*30.);float jitter=(noise(vec2(floor(vUv.y*480.),frame))-.5)*.0008;
      float bandA=1.-step(.004,abs(vUv.y-fract(frame*.173+.19)));float bandB=1.-step(.0025,abs(vUv.y-fract(frame*.317+.63)));float dropout=1.-step(2.,mod(frame,211.));
      p.x+=(jitter+(bandA-bandB*.6)*(anomaly*.010+dropout*.0015))*damage;p=clamp(p,.001,.999);
      float bleed=damage*.0007+anomaly*.0008;vec3 color=vec3(texture2D(image,p+vec2(bleed,0)).r,texture2D(image,p).g,texture2D(image,p-vec2(bleed,0)).b);
      vec2 soft=vec2(damage*.0015,0.);color=color*.6+texture2D(image,p+soft).rgb*.2+texture2D(image,p-soft).rgb*.2;
      vec2 halo=vec2(.0035,.0025);vec3 glow=max(texture2D(image,p+halo).rgb-.82,0.)+max(texture2D(image,p-halo).rgb-.82,0.)+max(texture2D(image,p+vec2(halo.x,-halo.y)).rgb-.82,0.)+max(texture2D(image,p-vec2(halo.x,-halo.y)).rgb-.82,0.);color+=glow*.075;
      float v=pow(clamp(vUv.x*(1.-vUv.x)*vUv.y*(1.-vUv.y)*16.,0.,1.),.065);color*=mix(1.,v*.97,damage*.8);
      float grain=noise(floor(vUv*vec2(1280.,960.))+floor(seconds*29.97))-.5;color+=grain*(.013+anomaly*.08)*damage;
      float loss=step(.86,noise(vec2(floor(vUv.y*240.),frame)));color*=1.-loss*anomaly*damage*.18;gl_FragColor=vec4(color,1.);
      #include <colorspace_fragment>
    }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  postScene.add(quad);
  const resize = () => {
    const ratio = resolution.pixelRatio(width, height, window.devicePixelRatio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height);
    target.setSize(
      Math.max(1, Math.floor(width * ratio)),
      Math.max(1, Math.floor(height * ratio)),
    );
  };
  return {
    canvas: renderer.domElement,
    backend: "WebGL",
    waterMaterial: water.material,
    resize: (w, h) => {
      width = w;
      height = h;
      resolution.resetSampling();
      resize();
    },
    recordFrame: (milliseconds, playing) => {
      if (resolution.recordFrame(milliseconds, playing)) resize();
    },
    render: (t, d, s) => {
      water.update(t);
      material.uniforms.seconds.value = t;
      material.uniforms.damage.value = d;
      material.uniforms.anomaly.value = s;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    dispose: () => {
      water.material.dispose();
      quad.geometry.dispose();
      material.dispose();
      target.dispose();
      renderer.dispose();
    },
  };
}
