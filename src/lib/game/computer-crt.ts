import { effect, frame, init, target } from "vgpu";
import crtShader from "@/shaders/crt.wgsl";

const SVG = "http://www.w3.org/2000/svg";
interface CrtMaps {
  curvature: string;
  grade: string;
}
interface CrtScreen {
  root: HTMLElement;
  picture: HTMLElement;
  glass: HTMLElement;
  iframe: HTMLIFrameElement;
  requestId: string;
  adapterReady: boolean;
  disconnect: () => void;
}

// Two immutable maps for the entire game, not a device or render loop per desk.
let maps: Promise<CrtMaps | null> | undefined;

async function renderMaps(): Promise<CrtMaps | null> {
  if (!navigator.gpu) return null;
  const gpu = await init({ powerPreference: "low-power" });
  try {
    const shader = effect(gpu, crtShader, { set: { params: { mode: 0 } } });
    const output = target(gpu, { size: [256, 192], format: "rgba8unorm" });
    await shader.compile(output);
    const image = async (mode: number, width: number, height: number) => {
      output.resize([width, height]);
      shader.set({ params: { mode } });
      frame(gpu, (f) => f.pass(output, shader));
      const pixels = await output.read();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("CRT map encoding is unavailable");
      const data = context.createImageData(width, height);
      data.data.set(pixels);
      context.putImageData(data, 0, 0);
      return canvas.toDataURL("image/png");
    };
    const curvature = await image(0, 256, 192);
    const grade = await image(1, 1000, 750);
    return { curvature, grade };
  } finally {
    // Readback is once for our own static maps; no website pixels or per-frame copies.
    gpu.dispose();
  }
}

/** vgpu-authored maps composed with native HTML; site curvature requires opt-in. */
export class ComputerCrt {
  private definition = document.createElementNS(SVG, "svg");
  private id = `crt-${crypto.randomUUID()}`;
  private elements = new Set<CrtScreen>();
  private curvature: string | undefined;
  private grade: string | undefined;
  private ready = false;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.definition.setAttribute("aria-hidden", "true");
    this.definition.setAttribute("width", "0");
    this.definition.setAttribute("height", "0");
    this.definition.style.position = "absolute";
    this.definition.style.pointerEvents = "none";
    container.append(this.definition);
    maps ??= renderMaps().catch((error) => {
      console.warn(
        "CRT WebGPU treatment unavailable; keeping clear glass.",
        error,
      );
      return null;
    });
    void maps.then((result) => {
      if (!result || this.disposed) return;
      const make = (name: string, attributes: Record<string, string>) => {
        const node = document.createElementNS(SVG, name);
        for (const [key, value] of Object.entries(attributes))
          node.setAttribute(key, value);
        return node;
      };
      const filter = make("filter", {
        id: this.id,
        x: "0",
        y: "0",
        width: "1",
        height: "1",
        filterUnits: "objectBoundingBox",
        primitiveUnits: "userSpaceOnUse",
        "color-interpolation-filters": "sRGB",
      });
      filter.append(
        make("feImage", {
          href: result.curvature,
          result: "curvature",
          x: "0",
          y: "0",
          width: "1000",
          height: "750",
          preserveAspectRatio: "none",
        }),
        make("feDisplacementMap", {
          in: "SourceGraphic",
          in2: "curvature",
          scale: "20",
          xChannelSelector: "R",
          yChannelSelector: "G",
          result: "curved",
        }),
      );
      this.definition.append(filter);
      this.curvature = result.curvature;
      this.grade = result.grade;
      this.ready = true;
      for (const element of this.elements) this.apply(element);
    });
  }

  private apply(screen: CrtScreen) {
    screen.picture.style.filter = `url("#${this.id}")`;
    // A sibling glass layer also grades foreign frames which Chromium excludes
    // from an SVG SourceGraphic. It never intercepts input or reads site pixels.
    screen.glass.style.backgroundImage = `url("${this.grade}")`;
    screen.root.dataset.crtEffect = "vgpu";
    this.sendCurvature(screen);
  }

  private sendCurvature(screen: CrtScreen) {
    if (!this.curvature || !screen.adapterReady || this.disposed) return;
    // The vgpu embed adapter explicitly opts in; other sites keep shaded glass.
    screen.iframe.contentWindow?.postMessage(
      {
        type: "vackrooms-crt",
        version: 1,
        requestId: screen.requestId,
        curvature: this.curvature,
        scale: 20,
      },
      "https://vgpu.sh",
    );
  }

  attach(
    root: HTMLElement,
    picture: HTMLElement,
    glass: HTMLElement,
    iframe: HTMLIFrameElement,
  ) {
    const screen: CrtScreen = {
      root,
      picture,
      glass,
      iframe,
      requestId: crypto.randomUUID(),
      adapterReady: false,
      disconnect: () => {},
    };
    const load = () => {
      delete root.dataset.crtContent;
    };
    const message = (event: MessageEvent) => {
      if (
        event.origin !== "https://vgpu.sh" ||
        event.source !== iframe.contentWindow
      )
        return;
      const data = event.data;
      if (!data || data.version !== 1) return;
      if (data.type === "vackrooms-crt-ready") {
        screen.adapterReady = true;
        this.sendCurvature(screen);
      }
      if (
        data.type === "vackrooms-crt-applied" &&
        data.requestId === screen.requestId
      )
        root.dataset.crtContent = "curved";
    };
    iframe.addEventListener("load", load);
    window.addEventListener("message", message);
    screen.disconnect = () => {
      iframe.removeEventListener("load", load);
      window.removeEventListener("message", message);
      picture.style.removeProperty("filter");
      glass.style.removeProperty("background-image");
      delete root.dataset.crtEffect;
      delete root.dataset.crtContent;
    };
    this.elements.add(screen);
    if (this.ready) this.apply(screen);
    return () => {
      this.elements.delete(screen);
      screen.disconnect();
    };
  }

  dispose() {
    this.disposed = true;
    for (const element of this.elements) {
      element.disconnect();
    }
    this.elements.clear();
    this.definition.remove();
  }
}
