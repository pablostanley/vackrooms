import { PropSoundGate, type PropMaterial, type PropSound } from "./prop-sounds";
import RAPIER from "@dimforge/rapier3d-compat";
import { Box3, Sphere, Vector3, type Object3D } from "three";
import {
  CELL,
  CHUNK,
  HEIGHT,
  PLAYER_RADIUS,
  N,
  SPAN,
  W,
  ceilingAt,
  poolBounds,
  courtyardBounds,
  type ChunkData,
  type PoolBounds,
} from "./maze";

let initialization: Promise<void> | undefined;
const BODY_HEIGHT = 0.89;
const EYE_OFFSET = 0.77;
const GRAVITY = 18;
const JUMP_SPEED = 5.6;
const DOUBLE_JUMP_SPEED = 8.8;
// Gives one press enough height and airtime to clear the 1.84m pool rim.
const POOL_JUMP_SPEED = 9.6;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;

/** A navigation bound whose player collision follows separate convex parts. */
export interface ShapedObstacle {
  bounds: Box3;
  parts: Float32Array[];
  movable?: { object: Object3D; mass: number; material?: PropMaterial };
}

interface PhysicalProp {
  body: RAPIER.RigidBody;
  object: Object3D;
  bounds: Box3;
  localBounds: Box3;
  shadow: Sphere;
  sound: PropSoundGate;
  material: PropMaterial;
}

/** Rapier owns capsule sweeps, wall sliding, small steps, and floor contact. */
export class CharacterMotor {
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private controller = this.world.createCharacterController(0.015);
  private body: RAPIER.RigidBody;
  private capsule: RAPIER.Collider;
  private sections = new Map<string, {
    colliders: RAPIER.Collider[];
    props: PhysicalProp[];
    basin: PoolBounds | null;
  }>();
  readonly movingPropShadows: Sphere[] = [];
  readonly propSounds: PropSound[] = [];
  private fallSpeed = 0;
  private onGround = false;
  private timeSinceGround = Infinity;
  private jumps = 0;
  private jumpPresses = 0;
  private jumpBuffer = 0;
  get grounded() {
    return this.onGround;
  }
  /** Call on a fresh press only; holding the key never repeats a jump. */
  jump() {
    this.jumpPresses = Math.min(this.jumpPresses + 1, 2);
    this.jumpBuffer = JUMP_BUFFER;
  }
  clearJumpInput() {
    this.jumpPresses = 0;
    this.jumpBuffer = 0;
  }
  static async create(position: { x: number; z: number }) {
    initialization ??= RAPIER.init();
    await initialization;
    return new CharacterMotor(position);
  }
  private constructor(position: { x: number; z: number }) {
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        position.x,
        BODY_HEIGHT,
        position.z,
      ),
    );
    this.capsule = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.65, PLAYER_RADIUS),
      this.body,
    );
    this.controller.enableAutostep(0.28, 0.25, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
    this.controller.setMinSlopeSlideAngle(Math.PI / 4);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(75);
  }
  addSection(
    key: string,
    data: ChunkData,
    obstacles: Box3[],
    shapedObstacles: ShapedObstacle[] = [],
  ) {
    this.removeSection(key);
    const props: PhysicalProp[] = [];
    const colliders: RAPIER.Collider[] = [],
      ox = data.x * SPAN,
      oz = data.z * SPAN;
    const box = (
      x: number,
      y: number,
      z: number,
      hx: number,
      hy: number,
      hz: number,
    ) =>
      colliders.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z),
        ),
      );
    const basin = poolBounds(data.landmark);
    const court = courtyardBounds(data.landmark);
    const recess = basin ?? (court && court.floorY < 0 ? court : null);
    const floor = (x: number, z: number, w: number, d: number, y = 0) =>
      box(ox + x + w / 2, y - 0.06, oz + z + d / 2, w / 2, 0.06, d / 2);
    if (recess) {
      floor(0, 0, SPAN, recess.z);
      floor(0, recess.z + recess.length, SPAN, SPAN - recess.z - recess.length);
      floor(0, recess.z, recess.x, recess.length);
      floor(
        recess.x + recess.width,
        recess.z,
        SPAN - recess.x - recess.width,
        recess.length,
      );
      floor(
        recess.x, recess.z, recess.width, recess.length,
        basin ? -1.4 : court!.floorY,
      );
    } else floor(0, 0, SPAN, SPAN);
    for (let z = 0; z < CHUNK; z++)
      for (let x = 0; x < CHUNK; x++) {
        const bits = data.cells[z * CHUNK + x];
        const height = ceilingAt(data, x, z);
        box(
          ox + (x + 0.5) * CELL,
          height + 0.06,
          oz + (z + 0.5) * CELL,
          CELL / 2,
          0.06,
          CELL / 2,
        );
        const northHeight = Math.max(height, ceilingAt(data, x, z - 1));
        const westHeight = Math.max(height, ceilingAt(data, x - 1, z));
        if (!(bits & N))
          box(
            ox + (x + 0.5) * CELL,
            northHeight / 2,
            oz + z * CELL,
            CELL / 2,
            northHeight / 2,
            0.09,
          );
        if (!(bits & W))
          box(
            ox + x * CELL,
            westHeight / 2,
            oz + (z + 0.5) * CELL,
            0.09,
            westHeight / 2,
            CELL / 2,
          );
        // Match the soffit above open transitions into taller halls.
        if (bits & N && height !== ceilingAt(data, x, z - 1))
          box(
            ox + (x + 0.5) * CELL,
            (northHeight + HEIGHT) / 2,
            oz + z * CELL,
            CELL / 2,
            (northHeight - HEIGHT) / 2,
            0.09,
          );
        if (bits & W && height !== ceilingAt(data, x - 1, z))
          box(
            ox + x * CELL,
            (westHeight + HEIGHT) / 2,
            oz + (z + 0.5) * CELL,
            0.09,
            (westHeight - HEIGHT) / 2,
            CELL / 2,
          );
      }
    const shapedBounds = new Set(shapedObstacles.map(({ bounds }) => bounds));
    for (const b of obstacles) {
      if (shapedBounds.has(b)) continue;
      box(
        (b.min.x + b.max.x) / 2,
        (b.min.y + b.max.y) / 2,
        (b.min.z + b.max.z) / 2,
        (b.max.x - b.min.x) / 2,
        (b.max.y - b.min.y) / 2,
        (b.max.z - b.min.z) / 2,
      );
    }
    for (const obstacle of shapedObstacles) {
      const moving = obstacle.movable;
      const center = obstacle.bounds.getCenter(new Vector3());
      const body = moving ? this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(center.x, center.y, center.z)
          .setLinearDamping(1.8).setAngularDamping(3)
          .setCcdEnabled(true).setSleeping(true),
      ) : undefined;
      if (body && moving) props.push({
        body, object: moving.object, bounds: obstacle.bounds,
        localBounds: obstacle.bounds.clone().translate(center.clone().negate()),
        shadow: new Sphere(),
        sound: new PropSoundGate(), material: moving.material ?? "wood",
      });
      for (const vertices of obstacle.parts) {
        const local = body ? vertices.slice() : vertices;
        if (body) for (let i = 0; i < local.length; i += 3) {
          local[i] -= center.x;
          local[i + 1] -= center.y;
          local[i + 2] -= center.z;
        }
        const shape = RAPIER.ColliderDesc.convexHull(local);
        if (!shape) throw new Error("Invalid convex furniture collider");
        if (moving) shape.setMass(moving.mass / obstacle.parts.length)
          .setFriction(0.65).setRestitution(0);
        const collider = this.world.createCollider(shape, body);
        if (!body) colliders.push(collider);
      }
    }
    this.sections.set(key, {
      colliders,
      props,
      basin: basin ? { ...basin, x: ox + basin.x, z: oz + basin.z } : null,
    });
    this.world.step();
  }
  removeSection(key: string) {
    for (const { body } of this.sections.get(key)?.props ?? [])
      this.world.removeRigidBody(body);
    for (const collider of this.sections.get(key)?.colliders ?? [])
      this.world.removeCollider(collider, true);
    this.sections.delete(key);
  }
  clearSections() {
    for (const key of this.sections.keys()) this.removeSection(key);
  }
  teleport(position: { x: number; z: number }) {
    this.body.setTranslation(
      { x: position.x, y: BODY_HEIGHT, z: position.z },
      true,
    );
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: BODY_HEIGHT,
      z: position.z,
    });
    this.fallSpeed = 0;
    this.onGround = false;
    this.timeSinceGround = Infinity;
    this.jumps = 0;
    this.clearJumpInput();
    this.world.step();
  }
  move(dx: number, dz: number, dt: number, position: Vector3) {
    this.propSounds.length = 0;
    if (dt <= 0) return 0;
    let jumped: 0 | 1 | 2 = 0;
    // Bound sweeps at low frame rates without dropping input or elapsed time.
    const steps = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < steps; i++) {
      const accepted = this.step(dx / steps, dz / steps, dt / steps);
      if (accepted) jumped = accepted;
    }
    this.syncProps();
    const next = this.body.translation();
    position.set(next.x, next.y + EYE_OFFSET, next.z);
    return jumped;
  }
  private samplePropSounds(dt: number) {
    const listener = this.body.translation();
    for (const { props } of this.sections.values()) for (const prop of props) {
      const body = prop.body, p = body.translation();
      if (body.isSleeping() || Math.hypot(p.x - listener.x, p.y - listener.y, p.z - listener.z) > 12) {
        prop.sound.sample(dt, 0, 0, false);
        continue;
      }
      let impulse = 0, supported = false;
      for (let c = 0; c < body.numColliders(); c++) {
        const collider = body.collider(c);
        this.world.contactPairsWith(collider, (other) => {
          // The capsule's sweep already applies pushing impulses; do not count
          // its own contact as carpet support or scrape in midair.
          if (other.handle === this.capsule.handle || other.parent()?.handle === body.handle) return;
          this.world.contactPair(collider, other, (manifold) => {
            let contactImpulse = 0;
            for (let i = 0; i < manifold.numContacts(); i++)
              contactImpulse += manifold.contactImpulse(i);
            impulse += contactImpulse;
            if (contactImpulse > 0 && Math.abs(manifold.normal().y) > 0.5) supported = true;
          });
        });
      }
      const v = body.linvel();
      // Subtract ordinary weight support so resting contacts remain silent.
      const event = prop.sound.sample(dt, Math.hypot(v.x, v.z),
        Math.max(0, impulse / body.mass() - 9.81 * dt), supported);
      if (event && this.propSounds.length < 8)
        this.propSounds.push({ ...event, material: prop.material, position: { x: p.x, y: p.y, z: p.z } });
    }
  }
  private syncProps() {
    this.movingPropShadows.length = 0;
    for (const { props } of this.sections.values()) for (const prop of props) {
      const p = prop.body.translation(), q = prop.body.rotation();
      if (prop.object.position.x === p.x && prop.object.position.y === p.y && prop.object.position.z === p.z &&
          prop.object.quaternion.x === q.x && prop.object.quaternion.y === q.y &&
          prop.object.quaternion.z === q.z && prop.object.quaternion.w === q.w) continue;
      prop.object.position.set(p.x, p.y, p.z);
      prop.object.quaternion.set(q.x, q.y, q.z, q.w);
      prop.object.updateMatrixWorld(true);
      // Navigation retains this Box3 by reference, so it follows the moved prop.
      prop.bounds.copy(prop.localBounds).applyMatrix4(prop.object.matrixWorld);
      this.movingPropShadows.push(prop.bounds.getBoundingSphere(prop.shadow));
    }
  }
  private takeoffSpeed() {
    const position = this.body.translation();
    // Dry decks and the top of the coping retain the ordinary jump height.
    if (position.y < BODY_HEIGHT - 0.1) {
      for (const { basin } of this.sections.values()) {
        if (
          basin &&
          position.x >= basin.x && position.x <= basin.x + basin.width &&
          position.z >= basin.z && position.z <= basin.z + basin.length
        ) return POOL_JUMP_SPEED;
      }
    }
    return JUMP_SPEED;
  }
  private step(dx: number, dz: number, dt: number) {
    let jumped: 0 | 1 | 2 = 0;
    if (this.onGround) this.timeSinceGround = 0;
    else this.timeSinceGround += dt;
    while (this.jumpPresses > 0 && this.jumpBuffer > 0) {
      if (
        this.onGround ||
        (this.jumps === 0 && this.timeSinceGround <= COYOTE_TIME)
      ) {
        this.fallSpeed = this.takeoffSpeed();
        this.jumps = 1;
        jumped = 1;
      } else if (this.jumps < 2 && this.timeSinceGround !== Infinity) {
        // A quick second tap must not reduce the stronger pool takeoff.
        this.fallSpeed = Math.max(this.fallSpeed, DOUBLE_JUMP_SPEED);
        this.jumps = 2;
        jumped = 2;
      } else break;
      this.onGround = false;
      this.timeSinceGround = Math.max(this.timeSinceGround, COYOTE_TIME);
      this.jumpPresses--;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (!this.jumpBuffer) this.jumpPresses = 0;
    // Autostep and snapping are walking aids; in air they can pull the capsule
    // onto a chair back or keep it glued to the lip it is trying to leave.
    if (this.onGround) {
      this.controller.enableAutostep(0.28, 0.25, false);
      this.controller.enableSnapToGround(0.3);
    } else {
      this.controller.disableAutostep();
      this.controller.disableSnapToGround();
    }
    const dy = this.fallSpeed * dt - 0.5 * GRAVITY * dt * dt;
    this.fallSpeed = Math.max(this.fallSpeed - GRAVITY * dt, -18);
    this.world.timestep = dt;
    this.controller.computeColliderMovement(this.capsule, {
      x: dx,
      y: dy,
      z: dz,
    });
    const movement = this.controller.computedMovement(),
      current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    this.world.step();
    this.samplePropSounds(dt);
    this.onGround = this.fallSpeed <= 0 && this.controller.computedGrounded();
    if (this.onGround) {
      this.fallSpeed = 0;
      this.jumps = 0;
      this.timeSinceGround = 0;
    } else if (this.fallSpeed > 0) {
      for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
        if ((this.controller.computedCollision(i)?.normal1.y ?? 0) < -0.5) {
          this.fallSpeed = 0;
          break;
        }
      }
    }
    return jumped;
  }
  dispose() {
    this.world.removeCharacterController(this.controller);
    this.world.free();
  }
}
