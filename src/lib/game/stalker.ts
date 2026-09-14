import { Vector3 } from "three";
import { stepLength } from "./entity-gait";
import { CELL, random } from "./maze";
import { wallsBetween } from "./acoustics";
import {
  EntityNavigation,
  groundDistance,
  type EntityView,
  type GroundPoint,
} from "./entity-navigation";

export type StalkerPhase =
  | "isolated"
  | "stalking"
  | "pursuing"
  | "searching"
  | "retreating";
export interface StalkerInput {
  view: EntityView;
  playerSpeed: number;
}
const STEP = 1 / 30;

/** Seeded opportunities use active game time, never timers or audio randomness. */
export class EncounterSchedule {
  private rng: () => number;
  private opening = true;
  next: number;
  constructor(seed: number) {
    this.rng = random(seed ^ 0x7374616c);
    this.next = 75 + this.rng() * 60;
  }
  rest(time: number) {
    this.next = time + 105 + this.rng() * 105;
  }
  retry(time: number) {
    this.next = time + 12 + this.rng() * 16;
  }
  poll(time: number) {
    if (time < this.next) return false;
    this.retry(time);
    const opening = this.opening;
    this.opening = false;
    // Sometimes nothing happens at all, even when a suitable route exists.
    if (this.rng() < 0.2 && !opening) {
      this.rest(time);
      return false;
    }
    return true;
  }
}

export class Stalker {
  readonly position = new Vector3();
  private previousPosition = new Vector3();
  private previousGait = 0;
  phase: StalkerPhase = "isolated";
  speed = 0;
  heading = 0;
  gait = 0;
  observed = false;
  private rng: () => number;
  private schedule: EncounterSchedule;
  private time = 0;
  private accumulator = 0;
  private age = 0;
  private phaseAge = 0;
  private grace = 0;
  private lifetime = 0;
  private glimpseOnly = false;
  private attention = 0;
  private lastSensed = -Infinity;
  private sensedSpeed = 0;
  private canSeePlayer = false;
  private canHearPlayer = false;
  private lastKnown: GroundPoint | null = null;
  private destination: GroundPoint | null = null;
  private path: GroundPoint[] = [];
  private nextPlan = 0;
  private nextSense = 0;
  private nextDestination = 0;
  private navRevision = -1;
  private side = 1;
  private stuck = 0;
  constructor(
    seed: number,
    private nav: EntityNavigation,
  ) {
    this.rng = random(seed ^ 0x63726565);
    this.schedule = new EncounterSchedule(seed);
  }
  get present() {
    return this.phase !== "isolated";
  }
  reset() {
    this.phase = "isolated";
    this.speed = 0;
    this.observed = false;
    this.lastKnown = this.destination = null;
    this.path = [];
    this.schedule.rest(this.time);
  }
  renderPosition(out: Vector3) {
    return out.lerpVectors(
      this.previousPosition,
      this.position,
      Math.max(0, this.accumulator / STEP),
    );
  }
  get renderGait() {
    return (
      this.previousGait +
      (this.gait - this.previousGait) * Math.max(0, this.accumulator / STEP)
    );
  }
  update(
    dt: number,
    input: StalkerInput,
    footstep: (position: Vector3, running: boolean) => void,
  ) {
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator + 1e-9 >= STEP) {
      this.accumulator -= STEP;
      this.time += STEP;
      this.previousPosition.copy(this.position);
      this.previousGait = this.gait;
      const wasPresent = this.present;
      if (this.tick(input, footstep)) return true;
      if (!wasPresent || !this.present) {
        this.previousPosition.copy(this.position);
        this.previousGait = this.gait;
      }
    }
    return false;
  }
  private change(phase: StalkerPhase) {
    this.phase = phase;
    this.phaseAge = 0;
    this.nextPlan = this.nextDestination = 0;
    this.destination = null;
    this.path = [];
  }
  private candidates(view: EntityView, min: number, max: number) {
    const points: { point: GroundPoint; score: number }[] = [];
    // Sample a local lattice, independent of section insertion order.
    const spacing = CELL / 2,
      player = view.position;
    for (
      let z = Math.floor((player.z - max) / spacing);
      z <= Math.ceil((player.z + max) / spacing);
      z++
    )
      for (
        let x = Math.floor((player.x - max) / spacing);
        x <= Math.ceil((player.x + max) / spacing);
        x++
      ) {
        const point = { x: (x + 0.5) * spacing, z: (z + 0.5) * spacing };
        const distance = groundDistance(point, player);
        if (
          distance < min ||
          distance > max ||
          !this.nav.canOccupy(point) ||
          this.nav.visible(point, view)
        )
          continue;
        const dot =
          ((point.x - player.x) * view.forward.x +
            (point.z - player.z) * view.forward.z) /
          distance;
        // Favor side doorways and the edge of vision over directly behind the player.
        const partitions = wallsBetween(this.nav.chunks, player, {
          ...point,
          y: 1.7,
        });
        if (partitions > 1) continue;
        points.push({
          point,
          score:
            Math.abs(dot - 0.35) * 8 +
            Math.abs(distance - 18) * 0.2 +
            this.rng() * 3,
        });
      }
    return points.sort((a, b) => a.score - b.score);
  }
  private appear(input: StalkerInput) {
    for (const { point } of this.candidates(input.view, 14, 26).slice(0, 6)) {
      const route = this.nav.route(point, input.view.position);
      if (!route.length) continue;
      const length = route.reduce(
        (total, p, i) => total + groundDistance(i ? route[i - 1] : point, p),
        0,
      );
      if (length > 48) continue;
      this.position.set(point.x, 0, point.z);
      this.heading = Math.atan2(route[0].x - point.x, route[0].z - point.z);
      this.age = this.attention = this.gait = this.speed = this.stuck = 0;
      this.grace = 18 + this.rng() * 14;
      this.glimpseOnly = this.rng() < 0.3;
      this.lifetime = this.glimpseOnly
        ? 28 + this.rng() * 18
        : 65 + this.rng() * 25;
      this.side = this.rng() < 0.5 ? -1 : 1;
      this.lastKnown = { x: input.view.position.x, z: input.view.position.z };
      this.lastSensed = this.time;
      this.nextSense = 0;
      this.observed = false;
      this.change("stalking");
      return;
    }
  }
  private perceive(input: StalkerInput) {
    const player = input.view.position,
      distance = groundDistance(player, this.position);
    const eyes = { x: this.position.x, y: 2.55, z: this.position.z };
    this.canSeePlayer =
      distance < 29 &&
      [0, -0.55].some((offset) =>
        this.nav.sight(eyes, {
          x: player.x,
          y: player.y + offset,
          z: player.z,
        }),
      );
    const partitions = wallsBetween(this.nav.chunks, eyes, player);
    const hearing =
      input.playerSpeed > 3 ? 24 : input.playerSpeed > 0.25 ? 10 : 0;
    this.canHearPlayer =
      hearing > 0 &&
      partitions < 3 &&
      distance < hearing / (1 + partitions * 1.25);
    if (this.canSeePlayer || this.canHearPlayer) {
      this.lastKnown = { x: player.x, z: player.z };
      this.lastSensed = this.time;
      this.sensedSpeed = input.playerSpeed;
    }
  }
  private chooseDestination(input: StalkerInput) {
    if (this.phase === "retreating") {
      for (const { point } of this.candidates(input.view, 18, 29).slice(0, 4)) {
        const path = this.nav.route(this.position, point);
        if (path.length) {
          this.destination = point;
          this.path = path;
          return;
        }
      }
      return;
    }
    if (!this.lastKnown) return;
    if (this.phase === "stalking" && this.age < this.grace) {
      // Seek a side approach around the last *perceived* position, then hold distance.
      const dx = this.lastKnown.x - this.position.x,
        dz = this.lastKnown.z - this.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const flank = {
        x: this.lastKnown.x - (dz / d) * this.side * 6,
        z: this.lastKnown.z + (dx / d) * this.side * 6,
      };
      if (this.nav.canOccupy(flank)) {
        const path = this.nav.route(this.position, flank);
        if (path.length) {
          this.destination = flank;
          this.path = path;
          return;
        }
      }
    }
    // Searching follows memory. It never gets a new target from a hidden, quiet player.
    this.destination = { ...this.lastKnown };
  }
  private tick(
    input: StalkerInput,
    footstep: (position: Vector3, running: boolean) => void,
  ) {
    if (!this.present) {
      if (this.schedule.poll(this.time)) this.appear(input);
      return false;
    }
    this.age += STEP;
    this.phaseAge += STEP;
    // Gaze is immediate; hearing and memory can use the slower perception cadence.
    this.observed = this.nav.visible(this.position, input.view);
    if (this.time >= this.nextSense) {
      this.perceive(input);
      this.nextSense = this.time + 0.2;
    }
    const distance = groundDistance(input.view.position, this.position);
    const sensed = this.canSeePlayer || this.canHearPlayer;
    const unseenFor = this.time - this.lastSensed;
    if (!this.nav.canOccupy(this.position) || distance > 48) {
      // Resident geometry can disappear behind the camera; never teleport an observed figure.
      if (!this.nav.visible(this.position, input.view)) this.reset();
      return false;
    }
    if (this.phase === "stalking") {
      const stimulus = sensed
        ? this.sensedSpeed > 3
          ? 1.1
          : distance < 4.5
            ? 0.75
            : this.sensedSpeed > 0.25
              ? 0.13
              : -0.3
        : -0.45;
      this.attention = Math.max(
        0,
        Math.min(8, this.attention + stimulus * STEP),
      );
      if (
        this.age >= this.grace &&
        !this.glimpseOnly &&
        this.attention > 4.5 &&
        sensed
      )
        this.change("pursuing");
      else if (this.age > this.lifetime || unseenFor > 18)
        this.change("retreating");
    } else if (this.phase === "pursuing") {
      if (unseenFor > 4.5) this.change("searching");
      else if (this.phaseAge > 32) this.change("retreating");
    } else if (this.phase === "searching") {
      if (sensed) this.change("pursuing");
      else if (this.phaseAge > 13) this.change("retreating");
    }
    if (this.age > this.lifetime + 35 && this.phase !== "retreating")
      this.change("retreating");
    if (
      this.phase === "retreating" &&
      this.phaseAge > 3 &&
      !this.nav.visible(this.position, input.view)
    ) {
      this.reset();
      return false;
    }
    if (this.navRevision !== this.nav.revision) {
      this.navRevision = this.nav.revision;
      this.path = [];
      this.nextPlan = this.nextDestination = 0;
    }
    if (this.time >= this.nextDestination) {
      this.chooseDestination(input);
      this.nextDestination =
        this.time + (this.phase === "stalking" ? 3.5 : 0.9);
      this.nextPlan = 0;
    }
    if (this.time >= this.nextPlan) {
      if (this.destination)
        this.path = this.nav.route(this.position, this.destination);
      this.nextPlan = this.time + (this.phase === "pursuing" ? 0.9 : 1.8);
    }
    let desired =
      this.phase === "pursuing"
        ? unseenFor < 0.5 && this.sensedSpeed > 3
          ? 4.65
          : this.sensedSpeed > 0.25
            ? 2.85
            : 1.55
        : this.phase === "searching"
          ? 1.1
          : this.phase === "retreating"
            ? 1.35
            : this.observed
              ? 0.38
              : sensed && this.sensedSpeed > 3
                ? 1.65
                : 0.85;
    if (
      this.phase === "stalking" &&
      distance < (this.age < this.grace ? 6.5 : 3.6)
    )
      desired = 0;
    if (!this.path.length) desired = 0;
    // The opening encounter teaches a rule, then quietly breaks it: watching
    // stops the early stalk, but loses its protection after the grace interval.
    const frozen =
      this.phase === "stalking" && this.age < this.grace && this.observed;
    if (frozen) {
      desired = 0;
      this.speed = 0;
    }
    this.speed += Math.max(
      -2.8 * STEP,
      Math.min(1.65 * STEP, desired - this.speed),
    );
    let remaining = this.speed * STEP,
      moved = 0;
    while (remaining > 0.00001 && this.path.length) {
      const target = this.path[0],
        distance = groundDistance(this.position, target);
      if (distance < 0.025) {
        this.path.shift();
        continue;
      }
      const travel = Math.min(remaining, distance);
      const next = {
        x: this.position.x + ((target.x - this.position.x) / distance) * travel,
        z: this.position.z + ((target.z - this.position.z) / distance) * travel,
      };
      if (!this.nav.clearSegment(this.position, next)) {
        this.path = [];
        break;
      }
      const angle = Math.atan2(
        next.x - this.position.x,
        next.z - this.position.z,
      );
      this.heading +=
        Math.atan2(
          Math.sin(angle - this.heading),
          Math.cos(angle - this.heading),
        ) * Math.min(1, STEP * 7);
      this.position.set(next.x, 0, next.z);
      remaining -= travel;
      moved += travel;
      if (travel >= distance) this.path.shift();
    }
    const previousBeat = Math.floor((this.gait + Math.PI / 2) / Math.PI);
    this.gait += (moved * Math.PI) / stepLength(this.speed);
    if (Math.floor((this.gait + Math.PI / 2) / Math.PI) > previousBeat)
      footstep(this.position.clone(), this.phase === "pursuing");
    this.stuck = moved < 0.001 && desired > 0 ? this.stuck + STEP : 0;
    if (
      this.phase !== "retreating" &&
      (this.stuck > 5 || (!this.path.length && unseenFor > 8))
    )
      this.change("retreating");
    // Contact needs a fresh, unobstructed body ray and capsule route: no grabs through desks/walls.
    return (
      this.phase === "pursuing" &&
      groundDistance(input.view.position, this.position) < 1.05 &&
      this.nav.sight(
        { x: this.position.x, y: 1.45, z: this.position.z },
        input.view.position,
      ) &&
      this.nav.clearSegment(this.position, input.view.position)
    );
  }
}
