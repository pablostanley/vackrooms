import * as THREE from "three";
import {
  CSS3DObject,
  CSS3DRenderer,
} from "three/addons/renderers/CSS3DRenderer.js";
import {
  browserAddress,
  canUseComputer,
  COMPUTER_HOME,
  MAX_LIVE_SCREENS,
  type ComputerStation,
} from "./computers";
import type { Section } from "./world";
import { ComputerCrt } from "./computer-crt";
import { attachComputerNavigation } from "./computer-navigation";

interface LiveScreen {
  station: ComputerStation;
  object: CSS3DObject;
  iframe: HTMLIFrameElement;
  address: HTMLInputElement;
  dispose: () => void;
}

/** Real DOM in perspective, with a strict cap on live browsing contexts. */
export class ComputerScreens {
  private scene = new THREE.Scene();
  private renderer = new CSS3DRenderer();
  private dialog = document.createElement("dialog");
  private exitButton = document.createElement("button");
  private screens = new Map<string, LiveScreen>();
  private raycaster = new THREE.Raycaster();
  private active: ComputerStation | null = null;
  private crt: ComputerCrt;
  nearest: ComputerStation | null = null;
  visible = false;

  constructor(
    container: HTMLElement,
    private exit: () => void,
  ) {
    this.dialog.className = "computer-layer";
    this.dialog.setAttribute("aria-label", "Computer browser");
    this.renderer.domElement.className = "computer-perspective";
    // Focus/scrollIntoView in the iframe must not scroll the 3D projection plane.
    this.renderer.domElement.style.overflow = "clip";
    this.exitButton.className = "computer-exit";
    this.exitButton.textContent = "ESC · BACK TO CAMERA";
    this.exitButton.addEventListener("click", exit);
    // Modal dismissal handles Escape while the browser chrome has focus.
    // The engine uses native fullscreen exit for keys inside a foreign iframe.
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.exit();
    });
    this.dialog.append(this.renderer.domElement, this.exitButton);
    container.append(this.dialog);
    this.crt = new ComputerCrt(this.dialog);
    this.dialog.inert = true;
    this.dialog.show();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
  }

  focus(station: ComputerStation) {
    this.active = station;
    this.exitButton.textContent = "ESC · BACK TO CAMERA";
    this.dialog.inert = false;
    this.dialog.classList.add("is-browsing");
    this.dialog.close();
    this.dialog.showModal();
    for (const screen of this.screens.values()) {
      screen.object.element.inert = screen.station.id !== station.id;
      screen.object.element.style.pointerEvents =
        screen.station.id === station.id ? "auto" : "none";
    }
    this.exitButton.focus({ preventScroll: true });
  }

  useButtonToExit() {
    this.exitButton.textContent = "BACK TO CAMERA";
  }

  leave() {
    this.active = null;
    this.dialog.close();
    this.dialog.classList.remove("is-browsing");
    this.dialog.classList.remove("is-screen-flat");
    this.dialog.inert = true;
    this.dialog.show();
    for (const screen of this.screens.values()) {
      screen.object.element.inert = true;
      screen.object.element.style.pointerEvents = "none";
    }
  }

  private create(station: ComputerStation): LiveScreen {
    const element = document.createElement("div");
    element.className = `crt-browser ${station.kind === "computerCart" ? "explorer" : "navigator"}`;
    element.dataset.station = station.id;
    const title = document.createElement("div");
    title.className = "crt-title";
    title.textContent =
      station.kind === "computerCart"
        ? "Internet Explorer"
        : "Netscape Navigator";
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Leave computer");
    close.addEventListener("click", this.exit);
    title.append(close);
    const toolbar = document.createElement("div");
    toolbar.className = "crt-toolbar";
    const address = document.createElement("input");
    address.setAttribute("aria-label", "Website address");
    address.spellcheck = false;
    address.autocomplete = "off";
    address.value = COMPUTER_HOME;
    const iframe = document.createElement("iframe");
    iframe.title = "Website on the CRT monitor";
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
    );
    // Popups may open separately; the embedded page cannot replace the game.
    const status = document.createElement("div");
    status.className = "crt-status";
    status.textContent = "Connecting…";
    let requested = COMPUTER_HOME;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const navigate = (value: string) => {
      const url = browserAddress(value);
      if (!url || new URL(url).origin === location.origin) {
        status.textContent = "Enter an HTTPS website address.";
        return;
      }
      requested = url;
      address.value = url;
      status.textContent = "Connecting…";
      navigation.setAddress(url);
      iframe.src = url;
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => {
        status.textContent = "Page not appearing? Try Reload or Open in tab.";
      }, 15000);
    };
    const button = (label: string, action?: () => void) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      if (action) control.addEventListener("click", action);
      toolbar.append(control);
      return control;
    };
    const back = button("← Back");
    const forward = button("Forward →");
    const navigation = attachComputerNavigation(
      iframe,
      back,
      forward,
      (url) => {
        requested = url;
        address.value = url;
      },
    );
    button("⌂ Home", () => navigate(COMPUTER_HOME));
    button("↻ Reload", () => {
      // Reassigning src also recovers from sites which refuse to be framed.
      navigate(requested);
    });
    button("Open in tab ↗", () =>
      window.open(requested, "_blank", "noopener,noreferrer"),
    );
    toolbar.lastElementChild!.setAttribute(
      "title",
      "Open the current or last entered address in a tab if this site blocks embedding",
    );
    const note = document.createElement("span");
    note.textContent = "WORLD WIDE WEB";
    toolbar.append(note);
    const form = document.createElement("form");
    form.className = "crt-address";
    const label = document.createElement("label");
    label.textContent = "Location:";
    label.append(address);
    const go = document.createElement("button");
    go.type = "submit";
    go.textContent = "Go";
    form.append(label, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      navigate(address.value);
    });
    iframe.addEventListener("load", () => {
      clearTimeout(loadTimer);
      status.textContent = "Done";
    });
    const glass = document.createElement("div");
    glass.className = "crt-glass";
    glass.setAttribute("aria-hidden", "true");
    const picture = document.createElement("div");
    picture.className = "crt-picture";
    picture.append(title, toolbar, form, iframe, status);
    element.append(picture, glass);
    const detachCrt = this.crt.attach(element, picture, glass, iframe);
    const object = new CSS3DObject(element);
    object.position.copy(station.position);
    object.quaternion.copy(station.quaternion);
    object.scale.setScalar(station.width / 1000);
    element.inert = true;
    element.style.pointerEvents = "none";
    this.scene.add(object);
    navigate(COMPUTER_HOME);
    return {
      station,
      object,
      iframe,
      address,
      dispose: () => {
        detachCrt();
        navigation.dispose();
        clearTimeout(loadTimer);
        iframe.src = "about:blank";
        object.removeFromParent();
      },
    };
  }

  private unobstructed(
    station: ComputerStation,
    camera: THREE.PerspectiveCamera,
    meshes: THREE.Object3D[],
  ) {
    // Test the entire glass opening so DOM never shines through walls or props.
    for (const [x, y] of [
      [0, 0],
      [-0.49, -0.49],
      [-0.49, 0.49],
      [0.49, -0.49],
      [0.49, 0.49],
    ]) {
      const target = new THREE.Vector3(x * station.width, y * station.height, 0)
        .applyQuaternion(station.quaternion)
        .add(station.position);
      const delta = target.sub(camera.position);
      this.raycaster.set(camera.position, delta.clone().normalize());
      this.raycaster.far = delta.length() - 0.025;
      if (this.raycaster.intersectObjects(meshes, false).length) return false;
    }
    return true;
  }

  update(
    camera: THREE.PerspectiveCamera,
    sections: Iterable<Section>,
    playing: boolean,
  ) {
    const resident = [...sections];
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const candidates = resident
      .flatMap((section) => section.computers)
      .filter((station) => {
        if (this.active && station.id !== this.active.id) return false;
        const delta = station.position.clone().sub(camera.position);
        return (
          delta.lengthSq() < 18 * 18 &&
          delta.clone().normalize().dot(forward) > 0.3 &&
          delta.dot(station.normal) < -0.12
        );
      })
      .sort(
        (a, b) =>
          a.position.distanceToSquared(camera.position) -
          b.position.distanceToSquared(camera.position),
      );
    const meshes: THREE.Object3D[] = [];
    for (const section of resident) {
      section.group.updateMatrixWorld();
      for (const object of section.group.children) {
        if (
          object instanceof THREE.Mesh &&
          !(object.material as THREE.Material).transparent
        )
          meshes.push(object);
      }
    }
    const visible = candidates
      .filter((station) => this.unobstructed(station, camera, meshes))
      .slice(0, MAX_LIVE_SCREENS);
    this.nearest =
      playing && !this.active
        ? (visible.find((station) => canUseComputer(station, camera)) ?? null)
        : null;
    for (const [id, screen] of this.screens) {
      // Keep a nearby page alive when looking away; release on distance/eviction.
      const exists = resident.some((section) =>
        section.computers.includes(screen.station),
      );
      if (
        !exists ||
        screen.station.position.distanceTo(camera.position) > 20 ||
        (!visible.includes(screen.station) &&
          visible.some((station) => !this.screens.has(station.id)))
      ) {
        screen.dispose();
        this.screens.delete(id);
      }
    }
    for (const station of visible) {
      if (!this.screens.has(station.id) && this.screens.size < MAX_LIVE_SCREENS)
        this.screens.set(station.id, this.create(station));
    }
    this.visible = false;
    for (const screen of this.screens.values()) {
      screen.object.visible =
        visible.includes(screen.station) &&
        (!this.active || screen.station.id === this.active.id);
      this.visible ||= screen.object.visible;
    }
  }

  render(camera: THREE.PerspectiveCamera) {
    this.renderer.render(this.scene, camera);
    // Once face-on, flatten the equivalent projection for native iframe hit
    // testing. Some engines miss iframe clicks through cancelling 90° CSS
    // transforms. The same live DOM stays mounted at the exact glass position.
    const flat =
      !!this.active &&
      camera.quaternion.angleTo(this.active.quaternion) < 0.0005;
    this.dialog.classList.toggle("is-screen-flat", flat);
    if (flat && this.active) {
      const center = this.active.position.clone().project(camera);
      const { width, height } = this.renderer.getSize();
      const distance = this.active.position.distanceTo(camera.position);
      const scale =
        (this.active.width * camera.projectionMatrix.elements[5] * height) /
        (2 * distance * 1000);
      this.dialog.style.setProperty("--screen-scale", String(scale));
      this.dialog.style.setProperty(
        "--screen-x",
        `${((center.x + 1) * width) / 2}px`,
      );
      this.dialog.style.setProperty(
        "--screen-y",
        `${((1 - center.y) * height) / 2}px`,
      );
    }
  }

  dispose() {
    this.dialog.close();
    this.crt.dispose();
    for (const screen of this.screens.values()) {
      screen.dispose();
    }
    this.screens.clear();
    this.dialog.remove();
  }
}
