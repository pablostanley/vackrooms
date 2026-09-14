import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { CharacterMotor } from "./physics";
import { BackroomsAudio } from "./audio";
import {
  canStand,
  cellAt,
  CELL,
  directions,
  generateChunk,
  SPAN,
  type ChunkData,
} from "./maze";
import { createMaterials } from "./materials";
import { createRenderer, type GameRenderer } from "./renderer";
import { TapeOverlay } from "./tape-overlay";
import { buildSection, createEntity, type Portal, type Section } from "./world";

export interface GameSettings {
  volume: number;
  sensitivity: number;
  tape: number;
  reducedMotion: boolean;
}
export interface GameStats {
  seconds: number;
  distance: number;
  depth: number;
  nearPortal: boolean;
  noclipProgress: number;
  signal: number;
  flashlight: boolean;
  backend: string;
}
interface Callbacks {
  ready: (backend: string) => void;
  pause: () => void;
  stats: (stats: GameStats) => void;
  message: (text: string) => void;
  error: (text: string) => void;
}
export class BackroomsEngine {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.065, 85);
  private renderer: GameRenderer | null = null;
  private controls: PointerLockControls | null = null;
  private motor: CharacterMotor | null = null;
  private materials = createMaterials();
  private chunks = new Map<string, ChunkData>();
  private sections = new Map<string, Section>();
  private lights: THREE.SpotLight[] = [];
  private audio = new BackroomsAudio();
  private entity = createEntity(this.materials.darkness);
  private flashlight = new THREE.SpotLight("#e5e0b0", 0, 23, 0.46, 0.7, 1.8);
  private keys = new Set<string>();
  private position = new THREE.Vector3(CELL * 2.5, 1.66, CELL * 4.5);
  private yaw = -0.13;
  private pitch = -0.025;
  private alive = true;
  private active = false;
  private hasStarted = false;
  private locked = false;
  private frameId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private seconds = 0;
  private distance = 0;
  private stepDistance = 0;
  private stepSide = 1;
  private depth = 0;
  private stress = 0;
  private tapeBurst = 0;
  private tapeOverlay: TapeOverlay | null = null;
  private clipProgress = 0;
  private nearestPortal: Portal | null = null;
  private flashOn = false;
  private lastStats = 0;
  private lastLights = -10;
  private lastChange = 0;
  private lastSound = 0;
  private lastEntity = 0;
  private entityAge = 0;
  private drag: { x: number; y: number; id: number } | null = null;
  private touchMove = { x: 0, y: 0 };
  private mutation = 0;
  private settings: GameSettings;
  private listeners = new AbortController();
  private resizeObserver: ResizeObserver;
  constructor(
    private container: HTMLElement,
    private seed: number,
    private callbacks: Callbacks,
    settings: GameSettings,
    overlayCanvas: HTMLCanvasElement | null = null,
  ) {
    this.settings = settings;
    if (overlayCanvas) this.tapeOverlay = new TapeOverlay(overlayCanvas);
    this.scene.background = new THREE.Color("#9e9450");
    this.scene.fog = new THREE.Fog("#9e9450", 24, 43);
    this.scene.add(new THREE.HemisphereLight("#fff3bc", "#897947", 1.05));
    this.scene.add(new THREE.AmbientLight("#fff5c6", 0.42));
    for (let i = 0; i < 12; i++) {
      const light = new THREE.SpotLight("#fff1bd", 24, 16, 1.32, 0.8, 2);
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.15;
      light.shadow.camera.far = 16;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.025;
      light.shadow.radius = 3;
      this.scene.add(light, light.target);
      this.lights.push(light);
    }
    this.scene.add(this.flashlight, this.flashlight.target, this.entity);
    this.camera.rotation.order = "YXZ";
    this.stream();
    this.updateLights();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    void this.initialize();
  }
  private async initialize() {
    try {
      const motor = await CharacterMotor.create(this.position);
      if (!this.alive) {
        motor.dispose();
        return;
      }
      this.motor = motor;
      for (const [key, data] of this.chunks)
        motor.addSection(key, data, this.sections.get(key)!.colliders);
      const renderer = await createRenderer(this.scene, this.camera);
      if (!this.alive) {
        renderer.dispose();
        return;
      }
      this.renderer = renderer;
      this.controls = new PointerLockControls(this.camera, renderer.canvas);
      this.controls.pointerSpeed = this.settings.sensitivity;
      this.controls.minPolarAngle = 0.22;
      this.controls.maxPolarAngle = Math.PI - 0.22;
      this.controls.enabled = false;
      this.controls.addEventListener("change", () => {
        this.yaw = this.camera.rotation.y;
        this.pitch = this.camera.rotation.x;
      });
      renderer.canvas.setAttribute(
        "aria-label",
        "First person view of the backrooms",
      );
      this.container.appendChild(renderer.canvas);
      this.resize();
      this.bind();
      this.camera.position.copy(this.position);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      renderer.render(0, this.settings.tape, 0);
      this.callbacks.ready(renderer.backend);
      this.frameId = requestAnimationFrame(this.tick);
    } catch (error) {
      console.error(error);
      if (this.alive)
        this.callbacks.error(
          "The camera could not start. Try a browser with hardware acceleration enabled.",
        );
    }
  }
  private resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer?.resize(w, h);
    this.tapeOverlay?.resize(w, h);
  }
  private bind() {
    const signal = this.listeners.signal;
    // An embedded preview may deny pointer capture. Handle that failure before
    // the addon's default logger, then retain the supported drag-to-look path.
    document.addEventListener(
      "pointerlockerror",
      (event) => {
        if (!this.active) return;
        event.stopImmediatePropagation();
      },
      { capture: true, signal },
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (!this.active) return;
        if (
          [
            "KeyW",
            "KeyA",
            "KeyS",
            "KeyD",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Space",
            "KeyE",
          ].includes(e.code)
        )
          e.preventDefault();
        this.keys.add(e.code);
        if (e.code === "KeyF" && !e.repeat) this.toggleFlashlight();
        if (e.code === "Escape") this.pause();
      },
      { signal },
    );
    document.addEventListener("keyup", (e) => this.keys.delete(e.code), {
      signal,
    });
    document.addEventListener(
      "pointerlockchange",
      () => {
        const locked = document.pointerLockElement === this.renderer?.canvas;
        if (this.locked && !locked) this.pause();
        this.locked = locked;
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.pause();
      },
      { signal },
    );
    window.addEventListener(
      "blur",
      () => {
        if (this.active) this.pause();
      },
      { signal },
    );
    this.renderer!.canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.active) return;
        if (e.pointerType === "mouse" && !this.locked) this.requestLock();
        if (!this.locked) {
          this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
          try {
            this.renderer!.canvas.setPointerCapture(e.pointerId);
          } catch {
            // A granted mouse lock can cancel this pointer before capture runs.
          }
        }
      },
      { signal },
    );
    this.renderer!.canvas.addEventListener(
      "pointermove",
      (e) => {
        if (!this.active || this.locked || this.drag?.id !== e.pointerId)
          return;
        this.look(
          (e.clientX - this.drag.x) * 1.25,
          (e.clientY - this.drag.y) * 1.25,
        );
        this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      },
      { signal },
    );
    const endDrag = () => {
      this.drag = null;
    };
    this.renderer!.canvas.addEventListener("pointerup", endDrag, { signal });
    this.renderer!.canvas.addEventListener("pointercancel", endDrag, {
      signal,
    });
  }
  private look(dx: number, dy: number) {
    this.yaw -= dx * 0.002 * this.settings.sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - dy * 0.002 * this.settings.sensitivity,
      -1.35,
      1.35,
    );
  }
  private requestLock() {
    if (!this.renderer || matchMedia("(pointer: coarse)").matches) return;
    try {
      const request = this.renderer.canvas.requestPointerLock();
      // Embedded browsers can decline pointer lock; drag still works silently.
      request?.catch(() => {});
    } catch {
      // The same drag controls work when pointer lock is unavailable.
    }
  }
  start() {
    if (!this.renderer || !this.alive) return;
    this.active = true;
    this.tapeBurst = 0.65;
    if (this.controls) this.controls.enabled = true;
    this.hasStarted = true;
    this.requestLock();
    void this.audio
      .start()
      .catch(() =>
        this.callbacks.message(
          "Audio could not start. Check your browser sound permissions.",
        ),
      );
  }
  pause() {
    if (!this.active) return;
    this.active = false;
    this.tapeBurst = 0.65;
    if (this.controls) this.controls.enabled = false;
    this.keys.clear();
    this.touchMove = { x: 0, y: 0 };
    this.drag = null;
    this.audio.pause();
    if (document.pointerLockElement === this.renderer?.canvas)
      document.exitPointerLock();
    this.callbacks.pause();
  }
  updateSettings(settings: GameSettings) {
    this.settings = settings;
    if (this.controls) this.controls.pointerSpeed = settings.sensitivity;
    this.audio.setVolume(settings.volume);
  }
  move(x: number, y: number) {
    this.touchMove = { x, y };
  }
  noclip(held: boolean) {
    if (held) this.keys.add("KeyE");
    else this.keys.delete("KeyE");
  }
  toggleFlashlight() {
    this.flashOn = !this.flashOn;
  }
  private stream() {
    const cx = Math.floor(this.position.x / SPAN),
      cz = Math.floor(this.position.z / SPAN);
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        const key = `${x},${z}`;
        if (this.chunks.has(key)) continue;
        const data = generateChunk(x, z, this.seed, this.depth);
        this.chunks.set(key, data);
        const section = buildSection(data, this.materials, this.depth);
        this.sections.set(key, section);
        this.motor?.addSection(key, data, section.colliders);
        this.scene.add(section.group);
      }
    for (const [key, data] of this.chunks)
      if (Math.abs(data.x - cx) > 1 || Math.abs(data.z - cz) > 1) {
        this.sections.get(key)?.dispose();
        this.motor?.removeSection(key);
        this.sections.delete(key);
        this.chunks.delete(key);
      }
  }
  private updateLights() {
    const candidates = [...this.sections.values()]
      .flatMap((s) => s.lights)
      .sort(
        (a, b) =>
          a.distanceToSquared(this.position) -
          b.distanceToSquared(this.position),
      );
    this.lights.forEach((light, i) => {
      const p = candidates[i];
      light.visible = !!p;
      if (p) {
        light.position.copy(p);
        light.target.position.set(p.x, 0, p.z);
      }
    });
  }
  private clearPath(x: number, z: number) {
    if (!canStand(this.chunks, x, z)) return false;
    for (const section of this.sections.values())
      for (const box of section.colliders) {
        if (
          x > box.min.x - 0.2 &&
          x < box.max.x + 0.2 &&
          z > box.min.z - 0.2 &&
          z < box.max.z + 0.2
        )
          return false;
      }
    return true;
  }
  private walk(dt: number) {
    let x =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0) +
      this.touchMove.x;
    let z =
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) +
      this.touchMove.y;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    const running = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = running ? 4.1 : 2.35;
    const dx = (x * Math.cos(this.yaw) + z * Math.sin(this.yaw)) * speed * dt,
      dz = (-x * Math.sin(this.yaw) + z * Math.cos(this.yaw)) * speed * dt;
    const previous = this.position.clone();
    this.motor?.move(dx, dz, dt, this.position);
    const moved = Math.hypot(
      this.position.x - previous.x,
      this.position.z - previous.z,
    );
    this.distance += moved;
    this.stepDistance += moved;
    if (this.stepDistance > (running ? 1.15 : 0.94)) {
      this.stepDistance = 0;
      this.stepSide *= -1;
      this.audio.step(running, false, this.stepSide);
    }
    const bob = this.settings.reducedMotion
      ? 0
      : Math.sin(this.distance * 6.7) *
        Math.min(moved / Math.max(dt, 0.001), 0.7) *
        0.029;
    this.camera.position.copy(this.position);
    this.camera.position.y += bob;
    this.camera.rotation.set(
      this.pitch,
      this.yaw,
      this.settings.reducedMotion
        ? 0
        : Math.sin(this.distance * 3.35) *
            Math.min(moved / Math.max(dt, 0.001), 1) *
            0.003,
    );
    const fov = running && moved > 0.001 ? 72 : 68;
    this.camera.fov += (fov - this.camera.fov) * Math.min(dt * 5, 1);
    this.camera.updateProjectionMatrix();
  }
  private findPortal(dt: number) {
    this.nearestPortal = null;
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw),
    );
    for (const section of this.sections.values())
      for (const portal of section.portals) {
        const delta = portal.position.clone().sub(this.position);
        delta.y = 0;
        if (
          delta.length() < 1.85 &&
          delta.clone().normalize().dot(forward) > 0.62
        )
          this.nearestPortal = portal;
        (portal.mesh.material as THREE.MeshBasicMaterial).opacity =
          0.23 + Math.sin(this.elapsed * 3.5 + portal.position.x) * 0.07;
        portal.mesh.scale.x =
          1 +
          (this.settings.reducedMotion
            ? 0
            : Math.sin(this.elapsed * 13) * 0.016);
      }
    if (this.nearestPortal && this.keys.has("KeyE")) {
      this.clipProgress += dt / 1.15;
      this.stress = Math.max(this.stress, this.clipProgress * 0.7);
      if (this.clipProgress >= 1) this.descend();
    } else this.clipProgress = Math.max(0, this.clipProgress - dt * 2);
  }
  private descend() {
    this.depth++;
    this.stress = 1;
    this.tapeBurst = 1;
    this.clipProgress = 0;
    this.keys.delete("KeyE");
    this.audio.anomaly();
    for (const section of this.sections.values()) section.dispose();
    this.sections.clear();
    this.chunks.clear();
    this.motor?.clearSections();
    this.position.set(CELL * 2.5, 1.66, CELL * 4.5);
    this.motor?.teleport(this.position);
    this.entity.visible = false;
    this.lastEntity = this.seconds;
    this.stream();
    this.updateLights();
    this.callbacks.message(
      [
        "That was not an exit.",
        "You remember this place differently.",
        "The air is warmer here.",
        "There is no outside.",
      ][this.depth % 4],
    );
  }
  private alterUnseen() {
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw),
    );
    for (const [key, data] of this.chunks) {
      const dx = data.x * SPAN + SPAN / 2 - this.position.x,
        dz = data.z * SPAN + SPAN / 2 - this.position.z;
      const delta = new THREE.Vector3(dx, 0, dz);
      // Only replace a whole section when its bounding sphere is behind the camera.
      if (
        delta.length() < SPAN * 1.12 ||
        delta.clone().normalize().dot(forward) > -0.83
      )
        continue;
      const revised = generateChunk(
        data.x,
        data.z,
        this.seed,
        this.depth + ++this.mutation * 11,
      );
      this.sections.get(key)?.dispose();
      this.chunks.set(key, revised);
      const section = buildSection(revised, this.materials, this.depth);
      this.sections.set(key, section);
      this.motor?.addSection(key, revised, section.colliders);
      this.scene.add(section.group);
      this.lastLights = -10;
      return;
    }
  }
  private updateEntity(dt: number) {
    if (!this.entity.visible) {
      if (this.seconds - this.lastEntity < 42) return;
      const angle = this.yaw + Math.PI;
      const x = this.position.x - Math.sin(angle) * 19,
        z = this.position.z - Math.cos(angle) * 19;
      const cell = cellAt(this.chunks, x, z);
      if (!cell) return;
      const ex = cell.chunk.x * SPAN + (cell.cx + 0.5) * CELL,
        ez = cell.chunk.z * SPAN + (cell.cz + 0.5) * CELL;
      if (!this.clearPath(ex, ez)) return;
      this.entity.position.set(ex, 0, ez);
      this.entity.visible = true;
      this.entityAge = 0;
      this.lastEntity = this.seconds;
      this.audio.distant(this.seconds);
    }
    this.entityAge += dt;
    const delta = this.entity.position.clone().sub(this.position);
    delta.y = 0;
    const distance = delta.length();
    let facing =
      delta
        .normalize()
        .dot(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))) >
      0.82;
    if (facing) {
      for (let d = 0.4; d < distance; d += 0.35) {
        if (
          !canStand(
            this.chunks,
            this.position.x + delta.x * d,
            this.position.z + delta.z * d,
            0.01,
          )
        ) {
          facing = false;
          break;
        }
      }
    }
    if (facing && distance < 18)
      this.stress = Math.max(this.stress, (1 - distance / 22) * 0.36);
    if (!facing) {
      const direction = this.entityDirection();
      if (direction) {
        const step = direction.sub(this.entity.position);
        step.y = 0;
        if (step.length() > 0.08) {
          step.normalize().multiplyScalar(dt * 1.12);
          if (
            canStand(
              this.chunks,
              this.entity.position.x + step.x,
              this.entity.position.z + step.z,
              0.15,
            )
          )
            this.entity.position.add(step);
        }
      }
    }
    this.entity.rotation.y = Math.atan2(
      this.position.x - this.entity.position.x,
      this.position.z - this.entity.position.z,
    );
    if (distance < 1.6) {
      this.descend();
      this.callbacks.message("Something moved with you.");
    }
    if (this.entityAge > 90 || distance > 39) {
      this.entity.visible = false;
      this.lastEntity = this.seconds;
    }
  }
  private entityDirection() {
    const sx = Math.floor(this.entity.position.x / CELL),
      sz = Math.floor(this.entity.position.z / CELL),
      tx = Math.floor(this.position.x / CELL),
      tz = Math.floor(this.position.z / CELL);
    const queue: [number, number, number, number][] = [[sx, sz, sx, sz]],
      seen = new Set([`${sx},${sz}`]);
    for (let i = 0; i < queue.length && i < 350; i++) {
      const [x, z, fx, fz] = queue[i];
      if (x === tx && z === tz)
        return new THREE.Vector3((fx + 0.5) * CELL, 0, (fz + 0.5) * CELL);
      const cell = cellAt(this.chunks, (x + 0.5) * CELL, (z + 0.5) * CELL);
      if (!cell) continue;
      for (const d of directions) {
        if (!(cell.bits & d.bit)) continue;
        const nx = x + d.dx,
          nz = z + d.dz,
          key = `${nx},${nz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push([nx, nz, i === 0 ? nx : fx, i === 0 ? nz : fz]);
      }
    }
    return null;
  }
  private tick = (now: number) => {
    if (!this.alive) return;
    const dt = Math.min((now - (this.lastTime || now)) / 1000, 0.045);
    this.lastTime = now;
    this.elapsed += dt;
    try {
      if (this.active) {
        this.seconds += dt;
        this.walk(dt);
        this.stream();
        this.findPortal(dt);
        this.updateEntity(dt);
        if (this.seconds - this.lastChange > 24) {
          this.lastChange = this.seconds;
          this.alterUnseen();
        }
        if (this.seconds - this.lastSound > 21) {
          this.lastSound = this.seconds;
          this.audio.distant(this.seconds);
        }
        this.audio.update(this.elapsed, this.stress, 1);
      } else if (!this.hasStarted) {
        this.camera.position.copy(this.position);
        this.camera.rotation.set(
          this.pitch,
          this.yaw +
            (this.settings.reducedMotion
              ? 0
              : Math.sin(this.elapsed * 0.075) * 0.085),
          0,
        );
      }
      if (this.elapsed - this.lastLights > 0.3) {
        this.updateLights();
        this.lastLights = this.elapsed;
      }
      for (let i = 0; i < this.lights.length; i++) {
        const light = this.lights[i];
        const jitter = this.settings.reducedMotion
          ? 0
          : Math.sin(this.elapsed * 8 + i * 8.7) * 0.035;
        light.intensity = 24 * (1 + jitter) * (i < 8 ? 1 : 0.6);
      }
      this.flashlight.position.copy(this.camera.position);
      const target = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(this.camera.quaternion)
        .multiplyScalar(8)
        .add(this.camera.position);
      this.flashlight.target.position.copy(target);
      this.flashlight.intensity = this.flashOn ? 22 : 0;
      this.stress = Math.max(0, this.stress - dt * 0.4);
      const tapeDamage = this.settings.reducedMotion
        ? Math.min(0.18, this.settings.tape)
        : this.settings.tape;
      // Proximity can cause a brief dropout, but never a sustained screen wobble.
      const tapeAnomaly = this.settings.reducedMotion
        ? 0
        : Math.max(
            this.tapeBurst,
            Math.floor(this.elapsed * 12) % 37 === 0 ? this.stress * 0.2 : 0,
          );
      this.renderer?.render(
        this.settings.reducedMotion ? 0 : this.elapsed,
        tapeDamage,
        tapeAnomaly,
      );
      this.tapeOverlay?.render(
        this.elapsed,
        tapeDamage,
        tapeAnomaly,
        this.settings.reducedMotion,
      );
      this.tapeBurst = Math.max(0, this.tapeBurst - dt * 5);
      if (this.elapsed - this.lastStats > 0.12) {
        this.lastStats = this.elapsed;
        this.callbacks.stats({
          seconds: this.seconds,
          distance: this.distance,
          depth: this.depth,
          nearPortal: !!this.nearestPortal,
          noclipProgress: this.clipProgress,
          signal: Math.max(
            8,
            Math.round(98 - this.stress * 68 - this.depth * 2),
          ),
          flashlight: this.flashOn,
          backend: this.renderer?.backend ?? "",
        });
      }
      this.frameId = requestAnimationFrame(this.tick);
    } catch (error) {
      console.error(error);
      this.pause();
      this.callbacks.error(
        "The camera lost its signal. Reload to start a new recording.",
      );
    }
  };
  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.frameId);
    this.listeners.abort();
    this.resizeObserver.disconnect();
    if (document.pointerLockElement === this.renderer?.canvas)
      document.exitPointerLock();
    this.audio.dispose();
    this.controls?.dispose();
    this.motor?.dispose();
    for (const s of this.sections.values()) s.dispose();
    this.entity.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.lights.forEach((light) => light.dispose());
    this.materials.dispose();
    this.tapeOverlay?.dispose();
    this.renderer?.dispose();
    this.renderer?.canvas.remove();
  }
}
