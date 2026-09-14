import RAPIER from "@dimforge/rapier3d-compat";
import type { Box3, Vector3 } from "three";
import {
  CELL,
  CHUNK,
  HEIGHT,
  N,
  SPAN,
  W,
  ceilingAt,
  poolBounds,
  type ChunkData,
} from "./maze";

let initialization: Promise<void> | undefined;
const BODY_HEIGHT = 0.89;
const EYE_OFFSET = 0.77;

/** Rapier owns capsule sweeps, wall sliding, small steps, and floor contact. */
export class CharacterMotor {
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private controller = this.world.createCharacterController(0.015);
  private body: RAPIER.RigidBody;
  private capsule: RAPIER.Collider;
  private sections = new Map<string, RAPIER.Collider[]>();
  private fallSpeed = 0;
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
      RAPIER.ColliderDesc.capsule(0.65, 0.22),
      this.body,
    );
    this.controller.enableAutostep(0.28, 0.25, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
    this.controller.setMinSlopeSlideAngle(Math.PI / 6);
    this.controller.setSlideEnabled(true);
  }
  addSection(key: string, data: ChunkData, obstacles: Box3[]) {
    this.removeSection(key);
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
    const floor = (x: number, z: number, w: number, d: number, y = 0) =>
      box(ox + x + w / 2, y - 0.06, oz + z + d / 2, w / 2, 0.06, d / 2);
    if (basin) {
      floor(0, 0, SPAN, basin.z);
      floor(0, basin.z + basin.length, SPAN, SPAN - basin.z - basin.length);
      floor(0, basin.z, basin.x, basin.length);
      floor(
        basin.x + basin.width,
        basin.z,
        SPAN - basin.x - basin.width,
        basin.length,
      );
      floor(basin.x, basin.z, basin.width, basin.length, -1.4);
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
            (CELL + 0.18) / 2,
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
            (CELL + 0.18) / 2,
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
    for (const b of obstacles)
      box(
        (b.min.x + b.max.x) / 2,
        (b.min.y + b.max.y) / 2,
        (b.min.z + b.max.z) / 2,
        (b.max.x - b.min.x) / 2,
        (b.max.y - b.min.y) / 2,
        (b.max.z - b.min.z) / 2,
      );
    this.sections.set(key, colliders);
    this.world.step();
  }
  removeSection(key: string) {
    for (const collider of this.sections.get(key) ?? [])
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
    this.world.step();
  }
  move(dx: number, dz: number, dt: number, position: Vector3) {
    if (dt <= 0) return;
    this.fallSpeed = Math.max(this.fallSpeed - 9.81 * dt, -18);
    this.controller.computeColliderMovement(this.capsule, {
      x: dx,
      y: this.fallSpeed * dt,
      z: dz,
    });
    const movement = this.controller.computedMovement(),
      current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    this.world.timestep = dt;
    this.world.step();
    const next = this.body.translation();
    position.set(next.x, next.y + EYE_OFFSET, next.z);
    if (this.controller.computedGrounded()) this.fallSpeed = 0;
  }
  dispose() {
    this.world.removeCharacterController(this.controller);
    this.world.free();
  }
}
