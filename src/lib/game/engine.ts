import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { CharacterMotor } from "./physics";
import { BackroomsAudio } from "./audio";
import { footstepSurfaceAt } from "./acoustics";
import { CELL, generateChunk, landmarkKind, SPAN, type ChunkData } from "./maze";
import { createMaterials } from "./materials";
import { createRenderer, type GameRenderer } from "./renderer";
import { TapeOverlay } from "./tape-overlay";
import { buildSection, type Portal, type Section } from "./world";
import { EntityNavigation, groundDistance } from "./entity-navigation";
import { EntityModel } from "./entity-model";
import { Encounters } from "./encounters";
import { crushEnvelope, DEATH_HOLD, nextLifeSeed } from "./encounter-effects";
import { ComputerScreens } from "./computer-screens";
import { computerFocus, type ComputerStation } from "./computers";
import { ShadowCache } from "./shadow-cache";
import { fixturePhase, fixtureStrength } from "./fixture-lighting";
import { connectedGamepads, GamepadInput, PAD, type GamepadFrame } from "./gamepad";
import type { GameSettings } from "./settings";

export type { GameSettings } from "./settings";
export interface GameStats {
  seconds: number;
  distance: number;
  depth: number;
  nearPortal: boolean;
  nearComputer: boolean;
  browsing: boolean;
  noclipProgress: number;
  signal: number;
  flashlight: boolean;
  backend: string;
  gamepad: boolean;
  encounter?: string;
  attacking?: boolean;
  canEscape?: boolean;
}
interface Callbacks {
  ready: (backend: string) => void;
  play: () => void;
  pause: () => void;
  settings: () => void;
  mute: () => void;
  gamepadMenu: (input: GamepadFrame) => boolean;
  stats: (stats: GameStats) => void;
  message: (text: string) => void;
  tape: (seed: number) => void;
  error: (text: string) => void;
}
export class BackroomsEngine {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.065, 85);
  private renderer: GameRenderer | null = null;
  private controls: PointerLockControls | null = null;
  private computerScreens: ComputerScreens | null = null;
  private focusedComputer: ComputerStation | null = null;
  private ownsComputerFullscreen = false;
  private computerHadFullscreen = false;
  private returnView: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    fov: number;
  } | null = null;
  private lastScreens = -1;
  private motor: CharacterMotor | null = null;
  private materials = createMaterials();
  private chunks = new Map<string, ChunkData>();
  private sections = new Map<string, Section>();
  private lights: THREE.SpotLight[] = [];
  private shadows: ShadowCache;
  private streamedX = NaN;
  private streamedZ = NaN;
  private audio: BackroomsAudio;
  private audioForward = new THREE.Vector3();
  private audioUp = new THREE.Vector3();
  private entityMaterial = new THREE.MeshStandardMaterial({
    color: "#15150f",
    roughness: 0.96,
    metalness: 0,
  });
  private entities = [
    new EntityModel(this.entityMaterial),
    new EntityModel(this.entityMaterial, "pyramid"),
  ];
  // Includes the full height, gait, and extended arms of the animated creature.
  private entityShadowBounds = this.entities.map(() => new THREE.Sphere(new THREE.Vector3(), 2.2));
  private navigation = new EntityNavigation();
  private encounters: Encounters;
  private playerSpeed = 0;
  private threat = 0;
  private deathHold = 0;
  private respawnFade = 0;
  private preview: "attack" | "stalk" | "pyramid" | "pair" | null = null;
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
  private drag: { x: number; y: number; id: number } | null = null;
  private touchMove = { x: 0, y: 0 };
  private gamepad = new GamepadInput();
  private gamepadConnected = false;
  private padMove = { x: 0, y: 0 };
  private padRun = false;
  private padInteract = false;
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
    this.audio = new BackroomsAudio(seed);
    this.encounters = new Encounters(seed, this.navigation);
    this.encounters.setEnabled(settings.entities);
    this.audio.setVolume(settings.volume);
    if (overlayCanvas) this.tapeOverlay = new TapeOverlay(overlayCanvas);
    this.scene.background = new THREE.Color("#9e9450");
    // Hide the outer edge of the bounded resident window, including along the
    // continuous corridor runs. The fluorescent haze has no visible end wall.
    this.scene.fog = new THREE.Fog("#9e9450", 32, SPAN - 1);
    // Ceiling panels dominate; warm carpet bounce still keeps the ceiling
    // readable. Less uniform fill lets the architectural contact shading show.
    this.scene.add(new THREE.HemisphereLight("#fff4cd", "#a39770", 1.15));
    this.scene.add(new THREE.AmbientLight("#fff5d6", 0.3));
    // Leave five texture slots for albedo, packed surface detail, the outage
    // mask, Three's BRDF lookup, and contact AO on baseline 16-texture GPUs.
    for (let i = 0; i < 11; i++) {
      const light = new THREE.SpotLight("#fff2c9", 28, 16, 1.32, 0.85, 2);
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
    this.shadows = new ShadowCache(this.lights);
    this.scene.add(this.flashlight, this.flashlight.target, ...this.entities);
    this.camera.rotation.order = "YXZ";
    if (process.env.NODE_ENV === "development") this.visitLandmark();
    this.stream();
    this.updateLights();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    void this.initialize();
  }
  /** Development only: `?visit=neighborhood` or `?visit=hotelCorridor` starts inside. */
  private visitLandmark() {
    const kind = new URLSearchParams(location.search).get("visit");
    if (!kind) return;
    for (let ring = 1; ring < 14; ring++)
      for (let z = -ring; z <= ring; z++)
        for (let x = -ring; x <= ring; x++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== ring) continue;
          if (landmarkKind(x, z, this.seed) !== (kind === "hotelCorridor" ? "corridor" : kind)) continue;
          const room = generateChunk(x, z, this.seed).landmark;
          if (kind === "hotelCorridor" && room.corridor !== "hotel") continue;
          this.position.set(
            x * SPAN + (room.x + room.width / 2) * CELL,
            1.66,
            z * SPAN + (room.z + 0.5) * CELL,
          );
          this.yaw = kind === "hotelCorridor" ? Math.PI / 2 : Math.PI;
          return;
        }
  }
  private async initialize() {
    try {
      const motor = await CharacterMotor.create(this.position);
      if (!this.alive) {
        motor.dispose();
        return;
      }
      this.motor = motor;
      for (const [key, data] of this.chunks) {
        const section = this.sections.get(key)!;
        motor.addSection(key, data, section.colliders, section.shapedColliders);
      }
      if (process.env.NODE_ENV === "development") {
        const mode = new URLSearchParams(location.search).get("monster");
        if (mode === "attack" || mode === "stalk" || mode === "pyramid" || mode === "pair") {
          this.preview = mode;
          this.previewEncounter();
        }
      }
      const renderer = await createRenderer(this.scene, this.camera, this.settings);
      if (!this.alive) {
        renderer.dispose();
        return;
      }
      this.renderer = renderer;
      // Preferences can change while the GPU initializes.
      renderer.updateSettings(this.settings);
      for (const section of this.sections.values()) this.prepareWater(section);
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
      this.computerScreens = new ComputerScreens(
        this.container,
        () => this.leaveComputer(),
        (powered) => this.audio.powerComputer(powered),
      );
      this.resize();
      this.bind();
      this.camera.position.copy(this.position);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      renderer.render(0, this.settings.tape, 0);
      this.callbacks.ready(renderer.backend);
      if (!document.hidden) this.frameId = requestAnimationFrame(this.tick);
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
    this.computerScreens?.resize(w, h);
    this.tapeOverlay?.resize(w, h);
  }
  private bind() {
    const signal = this.listeners.signal;
    // Capture also covers keyboard activation, HUD/settings, and CRT toolbars.
    this.container.parentElement?.addEventListener(
      "click",
      (event) => {
        const button = event.target instanceof Element
          ? event.target.closest("button")
          : null;
        if (!button || button.disabled || button.closest("[inert]")) return;
        if (button.classList.contains("crt-power-control") || button.dataset.sound === "flashlight") return;
        this.audio.playInterface();
      },
      { capture: true, signal },
    );
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
        // Dialog cancel and native fullscreen exit own Escape during browsing.
        if (this.focusedComputer) return;
        if (e.code === "KeyE" && !e.repeat && this.computerScreens?.nearest) {
          e.preventDefault();
          this.useComputer();
          return;
        }
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
        if (e.code === "Space" && !e.repeat && !this.keys.has(e.code))
          this.jump();
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
        if (this.locked && !locked && !this.focusedComputer) this.pause();
        this.locked = locked;
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          this.pause();
          cancelAnimationFrame(this.frameId);
          this.frameId = 0;
          this.lastTime = 0;
        } else if (this.alive && this.renderer && !this.frameId) {
          this.frameId = requestAnimationFrame(this.tick);
        }
      },
      { signal },
    );
    document.addEventListener(
      "fullscreenchange",
      () => {
        if (!this.focusedComputer) return;
        if (document.fullscreenElement) this.computerHadFullscreen = true;
        else if (this.computerHadFullscreen) this.leaveComputer();
      },
      { signal },
    );
    window.addEventListener(
      "blur",
      () => {
        if (this.active && !this.focusedComputer) this.pause();
      },
      { signal },
    );
    this.renderer!.canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.active || this.focusedComputer) return;
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
        if (
          !this.active ||
          this.focusedComputer ||
          this.locked ||
          this.drag?.id !== e.pointerId
        )
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
    if (this.encounters.attacking) return;
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
  start(lock = true) {
    if (!this.renderer || !this.alive) return;
    this.active = true;
    this.lastTime = 0;
    this.tapeBurst = 0.65;
    if (this.controls) this.controls.enabled = !this.encounters.attacking;
    this.hasStarted = true;
    if (lock) this.requestLock();
    this.callbacks.play();
    void this.audio
      .start()
      .catch(() =>
        this.callbacks.message(
          "Audio could not start. Check your browser sound permissions.",
        ),
      );
  }
  pause() {
    this.gamepad.suspend();
    this.padMove = { x: 0, y: 0 };
    this.padRun = false;
    this.padInteract = false;
    if (!this.active) return;
    this.active = false;
    if (this.focusedComputer) this.leaveComputer(false);
    this.tapeBurst = 0.65;
    if (this.controls) this.controls.enabled = false;
    this.keys.clear();
    this.motor?.clearJumpInput();
    this.touchMove = { x: 0, y: 0 };
    this.drag = null;
    this.audio.pause();
    if (document.pointerLockElement === this.renderer?.canvas)
      document.exitPointerLock();
    this.callbacks.pause();
  }
  useComputer(fullscreen = true) {
    const station = this.computerScreens?.nearest;
    if (!this.active || this.focusedComputer || !station || this.encounters.attacking) return;
    this.focusedComputer = station;
    if (this.computerScreens!.isPowered(station)) this.audio.playComputer();
    this.returnView = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      fov: this.camera.fov,
    };
    this.keys.clear();
    this.motor?.clearJumpInput();
    this.touchMove = { x: 0, y: 0 };
    this.drag = null;
    this.clipProgress = 0;
    this.gamepad.suspend();
    this.nearestPortal = null;
    if (this.controls) this.controls.enabled = false;
    if (document.pointerLockElement === this.renderer?.canvas)
      document.exitPointerLock();
    // Cross-origin frames own their keyboard events. Native fullscreen Escape
    // is observable by the parent even after a user clicks or types in the site.
    this.computerHadFullscreen = !!document.fullscreenElement;
    const surface = this.container.parentElement;
    if (fullscreen && !document.fullscreenElement && surface?.requestFullscreen) {
      this.ownsComputerFullscreen = true;
      void surface
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          if (!this.focusedComputer && document.fullscreenElement === surface)
            void document.exitFullscreen().catch(() => {});
          else if (this.focusedComputer === station)
            // Add the modal after fullscreen, keeping HTML above the canvas.
            this.computerScreens?.focus(station);
        })
        .catch(() => {
          this.ownsComputerFullscreen = false;
          if (this.focusedComputer === station) {
            this.computerScreens?.focus(station);
            this.computerScreens?.useButtonToExit();
          }
        });
    } else {
      this.computerScreens!.focus(station);
      if (!document.fullscreenElement) this.computerScreens?.useButtonToExit();
    }
  }
  leaveComputer(lock = true) {
    if (!this.focusedComputer) return;
    this.focusedComputer = null;
    this.audio.stopComputer();
    const exitFullscreen = this.ownsComputerFullscreen;
    this.ownsComputerFullscreen = false;
    this.computerHadFullscreen = false;
    if (exitFullscreen && document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    this.computerScreens?.leave();
    if (this.returnView) {
      this.camera.position.copy(this.returnView.position);
      this.camera.quaternion.copy(this.returnView.quaternion);
      this.camera.fov = this.returnView.fov;
      this.camera.updateProjectionMatrix();
    }
    this.returnView = null;
    this.keys.clear();
    this.lastScreens = -1;
    if (this.controls) this.controls.enabled = this.active;
    if (lock && this.active) this.requestLock();
  }
  updateSettings(settings: GameSettings) {
    this.settings = settings;
    this.renderer?.updateSettings(settings);
    this.encounters.setEnabled(settings.entities);
    if (!settings.entities) {
      this.entities.forEach((entity) => { entity.visible = false; });
      this.threat = this.stress = this.tapeBurst = this.deathHold = 0;
      if (this.controls) this.controls.enabled = this.active && !this.focusedComputer;
      this.audio.entityThreat(0, 0, this.seconds, 0);
    }
    if (this.controls) this.controls.pointerSpeed = settings.sensitivity;
    this.audio.setVolume(settings.volume);
  }
  move(x: number, y: number) {
    this.touchMove = { x, y };
  }
  jump() {
    if (this.active && !this.focusedComputer && this.encounters.attacker?.phase !== "dead") this.motor?.jump();
  }
  noclip(held: boolean) {
    if (held) this.keys.add("KeyE");
    else this.keys.delete("KeyE");
  }
  toggleFlashlight() {
    this.flashOn = !this.flashOn;
    this.audio.playFlashlight();
  }
  private pollGamepad(dt: number) {
    const input = this.gamepad.read(connectedGamepads(), !document.hidden && document.hasFocus());
    this.gamepadConnected = input.connected;
    this.padMove = { x: 0, y: 0 };
    this.padRun = false;
    this.padInteract = false;
    if (input.disconnected) {
      this.pause();
      this.callbacks.message("Controller disconnected. Recording paused.");
      return;
    }
    if (this.callbacks.gamepadMenu(input)) return;
    const pressed = input.pressed;
    if (pressed.has(PAD.settings)) {
      this.callbacks.settings();
      return;
    }
    if (pressed.has(PAD.menu)) {
      if (this.active) this.pause();
      else this.start(false);
      return;
    }
    if (pressed.has(PAD.mute)) this.callbacks.mute();
    if (this.focusedComputer) {
      if (pressed.has(PAD.back)) {
        this.leaveComputer(false);
        this.gamepad.suspend();
      }
      return;
    }
    if (pressed.has(PAD.back)) {
      this.pause();
      return;
    }
    if (!this.active) {
      if (pressed.has(PAD.interact)) this.start(false);
      return;
    }
    if (pressed.has(PAD.light)) this.toggleFlashlight();
    if (this.encounters.attacker?.phase === "grabbing" && pressed.has(PAD.interact)) {
      this.jump();
      return;
    }
    if (pressed.has(PAD.interact) && this.computerScreens?.nearest) {
      this.useComputer(false);
      return;
    }
    this.padMove = input.move;
    this.padRun = input.held.has(PAD.run) || input.held.has(PAD.sprint);
    this.padInteract = input.held.has(PAD.interact);
    // Match mouse sensitivity, with stick turning measured per second.
    this.look(input.look.x * 1100 * dt, input.look.y * 850 * dt);
  }
  private stream() {
    const cx = Math.floor(this.position.x / SPAN),
      cz = Math.floor(this.position.z / SPAN);
    if (cx === this.streamedX && cz === this.streamedZ) return;
    this.streamedX = cx;
    this.streamedZ = cz;
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        const key = `${x},${z}`;
        if (this.chunks.has(key)) continue;
        const data = generateChunk(x, z, this.seed, this.depth);
        this.chunks.set(key, data);
        const section = buildSection(data, this.materials, this.depth);
        this.prepareWater(section);
        this.sections.set(key, section);
        this.navigation.addSection(key, data, section.colliders);
        this.motor?.addSection(key, data, section.colliders, section.shapedColliders);
        this.scene.add(section.group);
      }
    for (const [key, data] of this.chunks)
      if (Math.abs(data.x - cx) > 1 || Math.abs(data.z - cz) > 1) {
        this.sections.get(key)?.dispose();
        this.motor?.removeSection(key);
        this.sections.delete(key);
        this.navigation.removeSection(key);
        this.chunks.delete(key);
      }
    this.shadows.invalidate();
    this.lastLights = -10;
    this.lastScreens = -1;
  }
  private prepareWater(section: Section) {
    if (this.renderer)
      for (const water of section.water)
        water.material = this.renderer.waterMaterial;
  }
  private updateLights() {
    const candidates = [...this.sections.values()]
      .flatMap((s) => [
        ...s.lights.map((position) => ({ position, lamp: false })),
        ...s.lampLights.map((position) => ({ position, lamp: true })),
      ])
      .sort(
        (a, b) =>
          a.position.distanceToSquared(this.position) -
          b.position.distanceToSquared(this.position),
      );
    const assigned = this.shadows.assign(candidates);
    const nextDistance =
      candidates[this.lights.length]?.position.distanceTo(this.position) ?? 16;
    this.lights.forEach((light, i) => {
      const p = assigned[i];
      light.visible = !!p;
      if (p) {
        light.userData.lamp = p.lamp;
        light.userData.strength = fixtureStrength(
          p.position.distanceTo(this.position),
          nextDistance,
        );
        light.userData.phase = fixturePhase(p.position.x, p.position.z);
        light.color.set(p.lamp ? "#ffdc97" : "#fff2c9");
      }
    });
  }
  private walk(dt: number) {
    let x =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0) +
      this.touchMove.x + this.padMove.x;
    let z =
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0) -
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) +
      this.touchMove.y + this.padMove.y;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    const running = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.padRun;
    const speed = running ? 4.1 : 2.35;
    const dx = (x * Math.cos(this.yaw) + z * Math.sin(this.yaw)) * speed * dt,
      dz = (-x * Math.sin(this.yaw) + z * Math.cos(this.yaw)) * speed * dt;
    const previousX = this.position.x,
      previousY = this.position.y,
      previousZ = this.position.z;
    const jumped = this.motor?.move(dx, dz, dt, this.position);
    if (jumped) this.audio.jump(this.position, jumped === 2);
    const inWater = footstepSurfaceAt(this.chunks, {
      x: this.position.x, y: this.position.y - 1.66, z: this.position.z,
    }) === "water";
    if (inWater && footstepSurfaceAt(this.chunks, {
      x: previousX, y: previousY - 1.66, z: previousZ,
    }) !== "water") {
      this.audio.enterWater(this.position);
      this.stepDistance = 0;
    }
    const moved = Math.hypot(
      this.position.x - previousX,
      this.position.z - previousZ,
    );
    this.playerSpeed = moved / Math.max(dt, 0.001);
    this.distance += moved;
    const grounded = this.motor?.grounded ?? false;
    if (grounded) this.stepDistance += moved;
    if (this.stepDistance > (running ? 1.15 : 0.94)) {
      this.stepDistance = 0;
      this.stepSide *= -1;
      this.audio.step(running, this.stepSide, this.position);
    }
    const bob = this.settings.reducedMotion || !grounded
      ? 0
      : Math.sin(this.distance * 6.7) *
        Math.min(moved / Math.max(dt, 0.001), 0.7) *
        0.029;
    this.camera.position.copy(this.position);
    this.camera.position.y += bob;
    this.camera.rotation.set(
      this.pitch,
      this.yaw,
      this.settings.reducedMotion || !grounded
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
    if (this.nearestPortal && (this.keys.has("KeyE") || this.padInteract)) {
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
    this.gamepad.suspend();
    this.padInteract = false;
    this.audio.resetSpace(this.seconds);
    this.rebuildWorld();
    this.callbacks.message(
      [
        "That was not an exit.",
        "You remember this place differently.",
        "The air is warmer here.",
        "There is no outside.",
      ][this.depth % 4],
    );
  }
  private rebuildWorld() {
    for (const section of this.sections.values()) section.dispose();
    this.sections.clear();
    this.chunks.clear();
    this.streamedX = this.streamedZ = NaN;
    this.navigation.clear();
    this.motor?.clearSections();
    this.position.set(CELL * 2.5, 1.66, CELL * 4.5);
    this.motor?.teleport(this.position);
    for (const entity of this.entities) entity.visible = false;
    this.encounters.reset();
    this.threat = 0;
    this.nearestPortal = null;
    this.playerSpeed = 0;
    this.stream();
    this.updateLights();
  }
  private respawn() {
    this.seed = nextLifeSeed(this.seed);
    this.depth = this.seconds = this.distance = this.stepDistance = this.clipProgress = 0;
    this.lastChange = this.mutation = 0;
    this.stress = this.tapeBurst = this.deathHold = 0;
    this.respawnFade = 1;
    this.keys.clear();
    this.touchMove = this.padMove = { x: 0, y: 0 };
    this.padRun = this.padInteract = false;
    this.gamepad.suspend();
    this.audio.resetSpace(0, this.seed);
    this.rebuildWorld();
    this.encounters = new Encounters(this.seed, this.navigation);
    this.encounters.setEnabled(this.settings.entities);
    this.yaw = -0.13;
    this.pitch = -0.025;
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
    if (this.controls) this.controls.enabled = this.active;
    this.callbacks.tape(this.seed);
    this.callbacks.message("You died. Another tape. The same nightmare.");
  }
  /** Development-only shortcut; replay from the camcorder OSD or reload the URL. */
  previewEncounter() {
    if (process.env.NODE_ENV !== "development" || !this.preview || !this.settings.entities) return;
    const starts = [this.position.clone().setY(1.66)];
    const ox = Math.floor(this.position.x / SPAN) * SPAN;
    const oz = Math.floor(this.position.z / SPAN) * SPAN;
    for (let z = 1; z < 10; z++) for (let x = 1; x < 10; x++)
      starts.push(new THREE.Vector3(ox + (x + 0.5) * CELL, 1.66, oz + (z + 0.5) * CELL));
    for (const player of starts) {
      if (!this.navigation.canOccupy(player)) continue;
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const monster = { x: player.x + dx * 5.5, z: player.z + dz * 5.5 };
        if (!this.navigation.canOccupy(monster) || !this.navigation.clearSegment(player, monster)) continue;
        const second = { x: monster.x + dz * 1.4, z: monster.z - dx * 1.4 };
        if (this.preview === "pair" &&
          (!this.navigation.canOccupy(second) || !this.navigation.clearSegment(player, second))) continue;
        this.position.copy(player);
        this.motor?.teleport(player);
        this.encounters.reset();
        const index = this.preview === "pyramid" ? 1 : 0;
        this.encounters.stalkers[index].stage(monster, player, this.preview !== "stalk");
        if (this.preview === "pair") {
          this.encounters.stalkers[1].stage(second, player, true);
        }
        this.entities.forEach((entity, i) => {
          const stalker = this.encounters.stalkers[i];
          entity.position.copy(stalker.position);
          entity.rotation.y = stalker.heading;
          entity.visible = stalker.present;
        });
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = 0;
        this.camera.position.copy(player);
        this.camera.rotation.set(0, this.yaw, 0);
        this.deathHold = this.respawnFade = this.threat = 0;
        this.audio.resetSpace(this.seconds);
        this.keys.clear();
        this.callbacks.message("");
        this.motor?.clearJumpInput();
        if (this.controls) this.controls.enabled = this.active;
        return;
      }
    }
    this.callbacks.message("No clear encounter preview here. Reload another tape.");
  }
  private alterUnseen() {
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw),
      0,
      -Math.cos(this.yaw),
    );
    for (const [key, data] of this.chunks) {
      if (
        this.encounters.stalkers.some((stalker) => stalker.present &&
          Math.floor(stalker.position.x / SPAN) === data.x &&
          Math.floor(stalker.position.z / SPAN) === data.z)
      )
        continue;
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
      this.prepareWater(section);
      this.sections.set(key, section);
      this.navigation.addSection(key, revised, section.colliders);
      this.motor?.addSection(key, revised, section.colliders, section.shapedColliders);
      this.scene.add(section.group);
      this.shadows.invalidate();
      this.lastScreens = -1;
      this.lastLights = -10;
      return;
    }
  }
  private updateEntity(dt: number) {
    const previousGait = this.encounters.stalkers.map((stalker) => stalker.renderGait);
    const wasAttacking = this.encounters.attacking;
    const caught = this.encounters.update(
      dt,
      {
        view: {
          position: this.camera.position,
          forward: this.audioForward
            .set(0, 0, -1)
            .applyQuaternion(this.camera.quaternion),
          up: this.audioUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion),
          fov: this.camera.fov,
          aspect: this.camera.aspect,
        },
        playerSpeed: this.playerSpeed,
      },
      (position, running) => this.audio.entityStep(position, running),
    );
    const attack = crushEnvelope(this.encounters.attackTime, this.settings.reducedMotion);
    let proximity = 0;
    this.entities.forEach((entity, i) => {
      const stalker = this.encounters.stalkers[i];
      entity.visible = stalker.present;
      stalker.renderPosition(entity.position);
      entity.rotation.y = stalker.heading;
      const distance = groundDistance(this.position, stalker.position);
      const clear = stalker.present && this.navigation.sight(
        this.position, { x: stalker.position.x, y: 1.5, z: stalker.position.z },
      );
      if (stalker.present)
        proximity = Math.max(proximity, Math.max(0, 1 - distance / 17) * (clear ? 1 : 0.18));
      const struggle = stalker.attacking ? Math.sin(stalker.attackTime * 34) * attack.shake : 0;
      entity.position.x += Math.cos(this.yaw) * struggle * 0.055;
      entity.position.z -= Math.sin(this.yaw) * struggle * 0.055;
      entity.position.y += Math.abs(struggle) * 0.025;
      entity.animate(
        stalker.renderGait,
        stalker.renderGait !== previousGait[i],
        stalker.speed,
        dt,
        stalker.attacking ? 1 : clear && stalker.phase !== "staggered" ? THREE.MathUtils.smoothstep(6 - distance, 0, 4.5) : 0,
        stalker.attacking ? attack.squeeze : 0,
        struggle,
      );
    });
    this.threat += (proximity - this.threat) * Math.min(1, dt * 4);
    this.stress = Math.max(this.stress, this.threat * 0.75);
    if (this.encounters.attacking && !wasAttacking) {
      this.keys.clear();
      this.motor?.clearJumpInput();
      this.touchMove = this.padMove = { x: 0, y: 0 };
      this.clipProgress = 0;
      this.nearestPortal = null;
      if (this.controls) this.controls.enabled = false;
      this.callbacks.message("It's holding you.");
    }
    this.audio.entityThreat(this.threat, this.encounters.attacking ? 0.25 + attack.squeeze * 0.75 : 0,
      this.encounters.attacking ? this.encounters.attackTime : this.seconds, attack.blackout);
    if (caught) {
      this.deathHold = DEATH_HOLD;
      this.callbacks.message("You died. Signal lost.");
    }
  }
  private attackCamera(dt: number) {
    const attack = crushEnvelope(this.encounters.attackTime, this.settings.reducedMotion);
    const attacker = this.encounters.attacker;
    if (!attacker) return;
    const targetYaw = Math.atan2(this.position.x - attacker.position.x, this.position.z - attacker.position.z);
    const turn = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
    this.yaw += THREE.MathUtils.clamp(turn, -dt * 1.4, dt * 1.4);
    this.pitch += (0.08 - this.pitch) * Math.min(1, dt * 3);
    this.camera.position.copy(this.position);
    this.camera.position.y -= attack.squeeze * 0.12;
    const shake = attack.shake;
    const struggle = Math.sin(this.encounters.attackTime * 34) * shake;
    this.camera.position.x += Math.cos(this.yaw) * struggle * 0.035;
    this.camera.position.z -= Math.sin(this.yaw) * struggle * 0.035;
    this.camera.position.y += Math.sin(this.encounters.attackTime * 29) * shake * 0.022;
    this.camera.rotation.set(
      this.pitch + Math.sin(this.encounters.attackTime * 29) * shake * 0.011,
      this.yaw + struggle * 0.01,
      struggle * 0.008,
    );
  }
  private struggle(dt: number) {
    // Keep Rapier's gravity and jump rules alive while horizontal walking is held.
    const jumped = this.motor?.move(0, 0, dt, this.position);
    if (!jumped || !this.encounters.escape()) return;
    this.audio.jump(this.position, jumped === 2);
    this.audio.entityThreat(0, 0, this.seconds, 0);
    this.threat = this.stress = this.tapeBurst = 0;
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    if (this.controls) this.controls.enabled = this.active;
    this.callbacks.message("You broke free. Run.");
  }
  private tick = (now: number) => {
    if (!this.alive) return;
    this.frameId = 0;
    if (document.hidden) {
      this.lastTime = 0;
      return;
    }
    // Standby keeps the VHS preview at tape cadence, without a full-rate scene.
    if (!this.active && this.lastTime && now - this.lastTime < 1000 / 30 - 1) {
      this.frameId = requestAnimationFrame(this.tick);
      return;
    }
    const frameMs = now - (this.lastTime || now);
    const dt = Math.min(frameMs / 1000, 0.045);
    this.lastTime = now;
    this.elapsed += dt;
    try {
      this.pollGamepad(dt);
      if (this.active && this.focusedComputer) {
        const view = computerFocus(this.focusedComputer, this.camera.aspect);
        const blend = this.settings.reducedMotion ? 1 : 1 - Math.exp(-dt * 14);
        this.camera.position.lerp(view.position, blend);
        this.camera.quaternion.slerp(view.quaternion, blend);
        this.camera.fov += (view.fov - this.camera.fov) * blend;
        this.camera.updateProjectionMatrix();
      } else if (this.active) {
        this.seconds += dt;
        this.respawnFade = Math.max(0, this.respawnFade - dt * 1.25);
        if (this.deathHold > 0) {
          this.deathHold = Math.max(0, this.deathHold - dt);
          if (!this.deathHold) this.respawn();
        } else if (this.encounters.attacker?.phase === "grabbing") {
          this.struggle(dt);
        } else if (!this.encounters.attacking) {
          this.walk(dt);
          this.stream();
          this.findPortal(dt);
          if (this.seconds - this.lastChange > 24) {
            this.lastChange = this.seconds;
            this.alterUnseen();
          }
        }
        if (this.encounters.attacking) this.attackCamera(dt);
        this.audio.update(
          this.seconds,
          this.camera.position,
          this.audioForward
            .set(0, 0, -1)
            .applyQuaternion(this.camera.quaternion),
          this.audioUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion),
          this.chunks,
          this.sections.values(),
          this.encounters.present,
        );
        this.updateEntity(dt);
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
          : Math.sin(this.elapsed * 8 + (light.userData.phase ?? 0)) * 0.012;
        // Taller halls retain the same oppressive fluorescent brightness.
        const heightCompensation = Math.min(
          3.2,
          Math.pow(light.position.y / 3, 1.5),
        );
        const intensity = light.userData.lamp
          ? 9
          : 28 * heightCompensation * (1 + jitter);
        light.intensity = intensity * (light.userData.strength ?? 0);
      }
      this.flashlight.position.copy(this.camera.position);
      this.flashlight.target.position
        .set(0, 0, -1)
        .applyQuaternion(this.camera.quaternion)
        .multiplyScalar(8)
        .add(this.camera.position);
      this.flashlight.intensity = this.flashOn ? 22 : 0;
      this.entities.forEach((entity, i) => {
        this.entityShadowBounds[i].center.copy(entity.position).y += 1.4;
      });
      this.shadows.update(
        this.active && !this.focusedComputer
          ? this.entityShadowBounds.filter((_, i) => this.entities[i].visible)
          : [],
      );
      this.stress = Math.max(0, this.stress - dt * 0.4);
      const tapeDamage = !this.settings.tapeEffects ? 0 : this.settings.reducedMotion
        ? Math.min(0.18, this.settings.tape)
        : this.settings.tape;
      const attack = crushEnvelope(this.encounters.attackTime, this.settings.reducedMotion);
      // Proximity feeds horizontal tape loss continuously, without camera wobble.
      const tapeAnomaly = !this.settings.tapeEffects || this.settings.reducedMotion
        ? 0
        : Math.max(
            this.tapeBurst,
            this.threat * this.threat * 0.75,
            this.encounters.attacking ? 0.7 + attack.squeeze * 0.3 : 0,
          );
      if (this.elapsed - this.lastScreens > 0.1) {
        this.computerScreens?.update(
          this.camera,
          this.sections.values(),
          this.active,
        );
        this.lastScreens = this.elapsed;
      }
      // Keep the DOM and mesh projections aligned; the separate VHS overlay stays.
      const hasScreen = this.computerScreens?.visible;
      this.renderer?.recordFrame(frameMs, this.active && !this.focusedComputer);
      this.renderer?.render(
        this.settings.reducedMotion ? 0 : this.elapsed,
        hasScreen ? 0 : tapeDamage,
        hasScreen ? 0 : tapeAnomaly,
      );
      this.computerScreens?.render(this.camera);
      this.tapeOverlay?.render(
        this.elapsed,
        tapeDamage,
        tapeAnomaly,
        this.settings.reducedMotion,
        this.encounters.attacking ? attack.red : 0,
        Math.max(this.encounters.attacking ? attack.blackout : 0, this.respawnFade),
      );
      this.tapeBurst = Math.max(0, this.tapeBurst - dt * 5);
      if (this.elapsed - this.lastStats > 0.12) {
        this.lastStats = this.elapsed;
        this.callbacks.stats({
          seconds: this.seconds,
          distance: this.distance,
          depth: this.depth,
          nearPortal: !!this.nearestPortal,
          nearComputer: !this.encounters.attacking && !!this.computerScreens?.nearest,
          browsing: !!this.focusedComputer,
          noclipProgress: this.clipProgress,
          signal: Math.max(
            8,
            Math.round(98 - this.stress * 68 - this.depth * 2),
          ),
          flashlight: this.flashOn,
          backend: this.renderer?.backend ?? "",
          gamepad: this.gamepadConnected,
          attacking: this.encounters.attacking,
          canEscape: this.encounters.attacker?.phase === "grabbing",
          encounter: this.preview ? this.encounters.stalkers.map((stalker, i) => `${this.entities[i].name.toUpperCase()} ${stalker.phase.toUpperCase()} · ${groundDistance(this.position, stalker.position).toFixed(1)} M`).join(" / ") : undefined,
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
    if (this.ownsComputerFullscreen && document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    this.resizeObserver.disconnect();
    if (document.pointerLockElement === this.renderer?.canvas)
      document.exitPointerLock();
    this.audio.dispose();
    this.controls?.dispose();
    this.computerScreens?.dispose();
    this.motor?.dispose();
    for (const s of this.sections.values()) s.dispose();
    for (const entity of this.entities) entity.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    });
    this.entityMaterial.dispose();
    this.lights.forEach((light) => light.dispose());
    this.materials.dispose();
    this.tapeOverlay?.dispose();
    this.renderer?.dispose();
    this.renderer?.canvas.remove();
  }
}
