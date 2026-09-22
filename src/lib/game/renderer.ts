import * as THREE from "three";
import { WebGPURenderer, RenderPipeline, type Node } from "three/webgpu";
import { pass, uniform, uv, vec2, vec3, max } from "three/tsl";
import { tslExports } from "vgpu/three";
import tapeModule from "@/shaders/tape.wgsl";
import { createPoolWater } from "./pool-water";
import { contactShadowsEnabled, type RenderSettings } from "./render-quality";
import { RenderResolution } from "./render-resolution";
import { createGLContactShadows, createGPUContactShadows } from "./contact-shadows";

type WarpInputs = { uv: Node; seconds: Node; damage: Node; anomaly: Node };
type GradeInputs = WarpInputs & { color: Node };
export interface GameRenderer {
  canvas: HTMLCanvasElement;
  backend: "WebGPU · vgpu" | "WebGL";
  waterMaterial: THREE.Material;
  resize: (w: number, h: number) => void;
  updateSettings: (settings: RenderSettings) => void;
  recordFrame: (milliseconds: number, playing: boolean) => void;
  render: (time: number, damage: number, stress: number) => void;
  dispose: () => void;
}

export async function createRenderer(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  initialSettings: RenderSettings,
): Promise<GameRenderer> {
  const resolution = new RenderResolution(initialSettings.quality);
  let settings = initialSettings;
  let contactAvailable = true;
  const contactEnabled = () => contactAvailable && contactShadowsEnabled(settings);
  const diagnostics = (canvas: HTMLCanvasElement) => {
    if (process.env.NODE_ENV !== "development") return;
    canvas.dataset.quality = settings.quality;
    canvas.dataset.contactShadows = String(contactEnabled());
    canvas.dataset.tapeEffects = String(settings.tapeEffects);
  };
  let width = 1,
    height = 1;
  const forceWebGL = new URLSearchParams(location.search).get("renderer") === "webgl";
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
        const contactShadows = createGPUContactShadows(scene, camera);
        const scenePass = pass(scene, camera);
        scenePass.contextNode = contactShadows.context;
        const plainPass = pass(scene, camera);
        const seconds = uniform(0),
          damage = uniform(0.7),
          anomaly = uniform(0);
        const { tapeWarp, tapeGrade } = tslExports<{
          tapeWarp: WarpInputs;
          tapeGrade: GradeInputs;
        }>(tapeModule)("tapeWarp", "tapeGrade");
        const tapeOutput = (cameraTexture: ReturnType<typeof scenePass.getTextureNode>) => {
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
          return tapeGrade({
            ...inputs,
            color: soft.add(glow.mul(0.075)),
          });
        };
        // Separate graphs remove AO's geometry prepass entirely when disabled.
        const shadedTexture = scenePass.getTextureNode("output");
        const plainTexture = plainPass.getTextureNode("output");
        const shadedTape = tapeOutput(shadedTexture);
        const plainTape = tapeOutput(plainTexture);
        const configurePipeline = () => {
          const contact = contactShadowsEnabled(settings);
          pipeline.outputNode = settings.tapeEffects
            ? (contact ? shadedTape : plainTape)
            : (contact ? shadedTexture : plainTexture);
          pipeline.needsUpdate = true;
        };
        configurePipeline();
        const gpuRenderer = renderer;
        const water = createPoolWater(true);
        const resize = () => {
          gpuRenderer.setPixelRatio(
            resolution.pixelRatio(width, height, window.devicePixelRatio),
          );
          gpuRenderer.setSize(width, height);
          diagnostics(gpuRenderer.domElement);
          contactShadows.resize(
            width * gpuRenderer.getPixelRatio(),
            height * gpuRenderer.getPixelRatio(),
          );
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
          updateSettings: (next) => {
            const changed = settings.tapeEffects !== next.tapeEffects || contactShadowsEnabled(settings) !== contactShadowsEnabled(next);
            settings = next;
            if (resolution.setQuality(next.quality)) resize();
            if (changed) configurePipeline();
            diagnostics(gpuRenderer.domElement);
          },
          recordFrame: (milliseconds, playing) => {
            if (resolution.recordFrame(milliseconds, playing)) resize();
          },
          render: (t, d, s) => {
            water.update(t);
            seconds.value = t;
            damage.value = d;
            anomaly.value = s;
            if (!settings.tapeEffects && !contactShadowsEnabled(settings)) {
              gpuRenderer.render(scene, camera);
            } else pipeline.render();
          },
          dispose: () => {
            water.material.dispose();
            pipeline.dispose();
            scenePass.dispose();
            plainPass.dispose();
            contactShadows.dispose();
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
  // Three leaves offscreen scene color linear and untone-mapped. Preserve
  // highlights until the output pass when float color attachments are usable;
  // keep the byte target for WebGL2 implementations without that extension.
  const floatColor = renderer.extensions.has("EXT_color_buffer_float");
  contactAvailable = floatColor;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: floatColor
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType,
  });
  // GTAO also uses half-float attachments. Unsupported devices keep the
  // playable byte/tape path without attempting incomplete AO framebuffers.
  const contactShadows = floatColor ? createGLContactShadows(scene, camera, target) : null;
  const postScene = new THREE.Scene(),
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      image: { value: target.texture },
      contactOcclusion: { value: contactShadows?.texture ?? null },
      seconds: { value: 0 },
      damage: { value: 0.7 },
      anomaly: { value: 0 },
      contactEnabled: { value: contactEnabled() },
      tapeEnabled: { value: settings.tapeEffects },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader:
      "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }",
    fragmentShader: `uniform sampler2D image; uniform sampler2D contactOcclusion; uniform float seconds; uniform float damage; uniform float anomaly; uniform bool contactEnabled; uniform bool tapeEnabled; varying vec2 vUv;
      float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){vec2 p=vUv; vec3 color;float frame=floor(seconds*30.); if(tapeEnabled){ vec2 c=p-.5; p+=c*dot(c,c)*.032*damage;
      float jitter=(noise(vec2(floor(vUv.y*480.),frame))-.5)*.0008;
      float bandA=1.-step(.004,abs(vUv.y-fract(frame*.173+.19)));float bandB=1.-step(.0025,abs(vUv.y-fract(frame*.317+.63)));float dropout=1.-step(2.,mod(frame,211.));
      p.x+=(jitter+(bandA-bandB*.6)*(anomaly*.010+dropout*.0015))*damage;p=clamp(p,.001,.999);
      float bleed=damage*.0007+anomaly*.0008;color=vec3(texture2D(image,p+vec2(bleed,0)).r,texture2D(image,p).g,texture2D(image,p-vec2(bleed,0)).b);
      vec2 soft=vec2(damage*.0015,0.);color=color*.6+texture2D(image,p+soft).rgb*.2+texture2D(image,p-soft).rgb*.2;
      vec2 halo=vec2(.0035,.0025);vec3 glow=max(texture2D(image,p+halo).rgb-.82,0.)+max(texture2D(image,p-halo).rgb-.82,0.)+max(texture2D(image,p+vec2(halo.x,-halo.y)).rgb-.82,0.)+max(texture2D(image,p-vec2(halo.x,-halo.y)).rgb-.82,0.);color+=glow*.075;}else{color=texture2D(image,p).rgb;}
      // Preserve luminous panels and bright direct highlights in the fallback.
      float ao=contactEnabled?texture2D(contactOcclusion,p).r:1.;float highlight=smoothstep(.45,.9,max(color.r,max(color.g,color.b)));color*=mix(1.,ao,.5*(1.-highlight));
      if(tapeEnabled){float v=pow(clamp(vUv.x*(1.-vUv.x)*vUv.y*(1.-vUv.y)*16.,0.,1.),.065);color*=mix(1.,v*.97,damage*.8);
      float grain=noise(floor(vUv*vec2(1280.,960.))+floor(seconds*29.97))-.5;color+=grain*(.013+anomaly*.08)*damage;
      float loss=step(.86,noise(vec2(floor(vUv.y*240.),frame)));color*=1.-loss*anomaly*damage*.18;}gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  postScene.add(quad);
  const resize = () => {
    const ratio = resolution.pixelRatio(width, height, window.devicePixelRatio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height);
    diagnostics(renderer.domElement);
    target.setSize(
      Math.max(1, Math.floor(width * ratio)),
      Math.max(1, Math.floor(height * ratio)),
    );
    contactShadows?.resize(target.width, target.height);
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
    updateSettings: (next) => {
      settings = next;
      material.uniforms.contactEnabled.value = contactEnabled();
      material.uniforms.tapeEnabled.value = next.tapeEffects;
      if (resolution.setQuality(next.quality)) resize();
      diagnostics(renderer.domElement);
    },
    recordFrame: (milliseconds, playing) => {
      if (resolution.recordFrame(milliseconds, playing)) resize();
    },
    render: (t, d, s) => {
      water.update(t);
      material.uniforms.seconds.value = t;
      material.uniforms.damage.value = d;
      material.uniforms.anomaly.value = s;
      if (!settings.tapeEffects && !contactEnabled()) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (contactEnabled()) contactShadows?.render(renderer);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    dispose: () => {
      water.material.dispose();
      quad.geometry.dispose();
      material.dispose();
      target.dispose();
      contactShadows?.dispose();
      renderer.dispose();
    },
  };
}
