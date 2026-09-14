import * as THREE from "three";
import { CSS3DObject } from "three/addons/renderers/CSS3DRenderer.js";
import type { ComputerStation } from "./computers";

/** The physical switch stays outside the clipped browser glass. */
export class ComputerPower {
  readonly object: CSS3DObject;
  private button = document.createElement("button");
  private active = false;

  constructor(
    station: ComputerStation,
    private browser: HTMLElement,
    private powered: boolean,
    private change: (powered: boolean) => void,
  ) {
    this.button.type = "button";
    this.button.className = "crt-power-control";
    this.button.innerHTML = '<span aria-hidden="true">⏻</span>';
    this.object = new CSS3DObject(this.button);
    this.object.position
      .set(0.32, -0.318, 0.008)
      .applyQuaternion(station.quaternion)
      .add(station.position);
    this.object.quaternion.copy(station.quaternion);
    this.object.scale.setScalar(station.width / 1000);
    this.button.addEventListener("click", () => {
      this.powered = !this.powered;
      this.sync();
      this.change(this.powered);
    });
    this.sync();
  }

  setActive(active: boolean) {
    this.active = active;
    this.sync();
  }

  private sync() {
    const label = this.powered ? "Turn monitor off" : "Turn monitor on";
    this.button.setAttribute("aria-label", label);
    this.button.title = label;
    this.button.setAttribute("aria-pressed", String(this.powered));
    this.button.classList.toggle("is-powered", this.powered);
    this.button.inert = !this.active;
    this.button.style.pointerEvents = this.active ? "auto" : "none";
    // Keep the browsing context mounted: switching back on resumes this page,
    // including its scroll position. Eviction still disposes it normally.
    this.browser.style.visibility = this.powered ? "" : "hidden";
    this.browser.inert = !this.active || !this.powered;
    this.browser.style.pointerEvents =
      this.active && this.powered ? "auto" : "none";
  }

  project(camera: THREE.PerspectiveCamera, width: number, height: number) {
    const center = this.object.position.clone().project(camera);
    this.button.style.setProperty(
      "--power-x",
      `${((center.x + 1) * width) / 2}px`,
    );
    this.button.style.setProperty(
      "--power-y",
      `${((1 - center.y) * height) / 2}px`,
    );
  }

  dispose() {
    this.object.removeFromParent();
  }
}
