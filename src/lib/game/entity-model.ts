import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import {
  FINGERS,
  restHip,
  rollEntityBody,
  type EntityBody,
  type EntityHead,
  type EntityVariant,
} from "./entity-anatomy";
import {
  sculptEntitySurface,
  skinEntitySurface,
  type EntitySurface,
  type Tissue,
} from "./entity-skin";
import {
  gaitUrgency,
  solveEntityLeg,
  stepLength,
} from "./entity-gait";

type Leg = { hip: THREE.Bone; knee: THREE.Bone; ankle: THREE.Bone; length: number };
type Arm = { shoulder: THREE.Bone; elbow: THREE.Bone; hand: THREE.Bone };
type Head = { bone: THREE.Bone; jaw?: THREE.Bone; head: EntityHead; phase: number };
type Rig = {
  hips: THREE.Bone;
  chest: THREE.Bone;
  heads: Head[];
  legs: Leg[];
  arms: Arm[];
  fingers: { bone: THREE.Bone; side: number; index: number }[];
  anatomy: Tissue[];
};

/** Bones and smooth tissue for one body. Needs no material, so workers can sculpt it. */
function rigEntity(parent: THREE.Object3D, body: EntityBody, material?: THREE.Material): Rig {
  const anatomy: Tissue[] = [];
  const tissue = (bone: THREE.Bone, x: number, y: number, z: number, sx: number, sy: number, sz: number, blend?: number) => {
    anatomy.push({ bone, center: new THREE.Vector3(x, y, z), radii: new THREE.Vector3(sx, sy, sz), blend });
  };
  const skin = (bone: THREE.Bone, length: number, radius: number, curve = 0.01, blend = 0.026) => {
    anatomy.push({ bone,
      center: new THREE.Vector3(0, -length / 2, 0),
      radii: new THREE.Vector3(radius + Math.abs(curve), length / 2 + radius, radius),
      length, radius, curve, blend,
    });
  };
  const { build: b, limbs: g, torso } = body;
  const t = torso / 0.86;
  const w = body.shoulders / 0.24;
  const hips = new THREE.Bone(), chest = new THREE.Bone();
  hips.position.y = restHip(body);
  parent.add(hips);
  // Trunk masses melt together with a wide blend: no segmented, insect waist.
  const trunk = 0.07;
  // Pelvis with iliac crests and a slack seat, so the legs root into a mass.
  tissue(hips, 0, 0.01, 0, 0.13 * b, 0.12, 0.08 * b, trunk);
  for (const side of [-1, 1]) {
    tissue(hips, side * 0.095 * b, 0.05, 0.01, 0.05, 0.05, 0.05, trunk);
    tissue(hips, side * 0.066 * b, -0.055, -0.04, 0.068 * b, 0.08, 0.06 * b, 0.04);
  }
  chest.position.set(0.025, torso, 0);
  hips.add(chest);
  skin(chest, torso, 0.084 * b, -0.022, trunk);
  // Ribcage over a narrow waist, and a belly that only sags on some bodies.
  tissue(chest, -0.005, -0.22 * t, 0.012, 0.13 * b, 0.23 * t, 0.092 * b, trunk);
  tissue(chest, 0, -0.66 * t, 0.012 + body.belly * 0.035,
    (0.088 + body.belly * 0.04) * b, (0.15 + body.belly * 0.04) * t, (0.062 + body.belly * 0.05) * b, trunk);
  tissue(chest, 0, -0.028, -0.009, 0.235 * w, 0.094, 0.079 * b);
  for (const side of [-1, 1]) {
    // Sloping trapezius and swept shoulder blades erase the horizontal bar.
    tissue(chest, side * 0.085 * w, 0.025, -0.012, 0.098, 0.086, 0.058);
    tissue(chest, side * 0.078 * w, -0.16, -0.036, 0.066, 0.155, 0.058);
    // Flat, wasted pectorals over the ribs.
    tissue(chest, side * 0.075 * w, -0.1, 0.045 * b, 0.078, 0.06, 0.036);
    // Clavicles run from the throat to each shoulder.
    tissue(chest, side * 0.12 * w, 0.012, 0.035, 0.1 * w, 0.018, 0.02, 0.012);
  }
  if (body.spine > 0.35) {
    // A vertebral ridge shows through the back of the thinnest bodies.
    const knuckle = 0.013 + body.spine * 0.01;
    for (let bone = 0; bone < 6; bone++)
      tissue(chest, 0, -0.06 - bone * 0.11 * t, -0.078 * b - 0.004, knuckle, knuckle * 1.1, knuckle, 0.01);
  }
  const heads: Head[] = [];
  body.heads.forEach((head, index) => {
    const s = head.size, st = head.stretch;
    const neck = new THREE.Bone(), bone = new THREE.Bone();
    const offset = body.heads.length > 1 ? (index ? -1 : 1) * 0.075 * w : 0;
    // The neck bone sits at the head end; its skin runs back down to the chest.
    neck.position.set(0.025 + offset + Math.sin(head.splay) * head.neck, Math.cos(head.splay) * head.neck, 0.01);
    neck.rotation.z = -head.splay;
    chest.add(neck);
    skin(neck, head.neck, (head.kind === "bulb" || head.kind === "pin" ? 0.036 : 0.044) * Math.sqrt(g), -0.008);
    bone.position.set(0.015, 0.13, 0.015);
    bone.name = index ? `head-${index}` : "head";
    neck.add(bone);
    let jaw: THREE.Bone | undefined;
    // A throat bridges the neck to even the smallest head.
    if (head.kind !== "pyramid") tissue(bone, 0, -0.075, 0.008, 0.034, 0.075, 0.033);
    switch (head.kind) {
      case "pyramid": {
        // A broad, faceted head with a forward-leaning apex; still fits the doors.
        // Truncated ridges catch only a hairline of light. The primary planes stay
        // severe, with an off-axis apex and an asymmetric, undercut lower rim.
        if (!material) break;
        const corners = [
          new THREE.Vector3(-0.318, -0.34, -0.356),
          new THREE.Vector3(0.318, -0.34, -0.356),
          new THREE.Vector3(0.318, -0.36, 0.356),
          new THREE.Vector3(-0.318, -0.36, 0.356),
          new THREE.Vector3(0.024, 0.36, 0.16),
        ].map(corner => corner.multiplyScalar(s));
        const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]];
        const bevel = edges.flatMap(([a, c]) => [
          corners[a].clone().lerp(corners[c], 0.024),
          corners[c].clone().lerp(corners[a], 0.024),
        ]);
        const skull = new THREE.Mesh(new ConvexGeometry(bevel), material);
        skull.castShadow = skull.receiveShadow = true;
        skull.name = "pyramid-head";
        skull.position.y = 0.02;
        bone.add(skull);
        break;
      }
      case "skull":
        // A continuous cranial envelope: narrow jaw, swept occiput, no face.
        tissue(bone, 0, 0.025, -0.018, 0.125 * s, 0.207 * s * st, 0.116 * s);
        tissue(bone, -0.015, -0.11 * s, 0.017, 0.086 * s, 0.105 * s, 0.082 * s);
        break;
      case "bulb":
        // Swollen cranium over a small receding chin.
        tissue(bone, 0, 0.08 * s, -0.03, 0.17 * s, 0.19 * s, 0.18 * s);
        tissue(bone, 0, -0.08 * s, 0.035, 0.058 * s, 0.075 * s, 0.058 * s);
        break;
      case "long": {
        // A tall, backswept egg of a skull.
        const crown = new THREE.Bone();
        crown.rotation.x = -0.38;
        bone.add(crown);
        tissue(crown, 0, 0.13 * s * st, -0.02, 0.092 * s, 0.28 * s * st, 0.1 * s);
        tissue(bone, 0, -0.07 * s, 0.025, 0.074 * s, 0.1 * s, 0.07 * s);
        break;
      }
      case "jaw":
        // Cranium with an unhinged lower jaw hanging open beneath it.
        tissue(bone, 0, 0.05 * s, -0.02, 0.12 * s, 0.165 * s * st, 0.118 * s);
        jaw = new THREE.Bone();
        jaw.position.set(0, -0.05 * s, -0.05 * s);
        jaw.rotation.x = 0.55;
        bone.add(jaw);
        // Hinged at the back of the skull, the long jaw gapes forward.
        tissue(jaw, 0, -0.03 * s, 0.1 * s, 0.068 * s, 0.03 * s, 0.11 * s, 0.006);
        break;
      case "pin":
        // A head far too small for the body.
        tissue(bone, 0, 0, 0, 0.062 * s, 0.085 * s, 0.066 * s);
        break;
      case "slab":
        // A flat, faceless board of a head.
        tissue(bone, 0, 0.03, 0, 0.16 * s, 0.19 * s * st, 0.048 * s);
        tissue(bone, 0, -0.13 * s, 0.01, 0.085 * s, 0.06 * s, 0.045 * s);
        break;
    }
    heads.push({ bone, jaw, head, phase: index * 2.1 + body.seed % 7 });
  });
  const legs: Leg[] = [], arms: Arm[] = [], fingers: Rig["fingers"] = [];
  for (const side of [-1, 1]) {
    const L = body.legs[side < 0 ? 0 : 1];
    const hip = new THREE.Bone(), knee = new THREE.Bone(), ankle = new THREE.Bone();
    hip.name = side < 0 ? "left-hip" : "right-hip";
    knee.name = side < 0 ? "left-knee" : "right-knee";
    ankle.name = side < 0 ? "left-ankle" : "right-ankle";
    hip.position.x = side * 0.13 * (0.9 + b * 0.1);
    skin(hip, L, 0.05 * g, side * 0.008);
    // Quadriceps and hamstrings taper the thigh toward the knee.
    tissue(hip, side * 0.004, -0.3 * L, 0.014, 0.056 * g, 0.26 * L, 0.054 * g);
    tissue(hip, 0, -0.45 * L, -0.016, 0.044 * g, 0.21 * L, 0.042 * g);
    knee.position.y = -L;
    skin(knee, L, 0.034 * g, -side * 0.008);
    tissue(knee, 0, 0, 0.012, 0.036 * g, 0.042, 0.032);
    tissue(knee, 0, -0.28 * L, -0.022, 0.043 * g, 0.17 * L, 0.044 * g);
    ankle.position.y = -L;
    // Heel, long sole and a narrow instep.
    tissue(ankle, 0, -0.012, -0.012, 0.038, 0.04, 0.048);
    tissue(ankle, 0, -0.018, 0.085, 0.05, 0.032, 0.13);
    knee.add(ankle);
    hip.add(knee);
    hips.add(hip);
    legs.push({ hip, knee, ankle, length: L });
    const plan = body.arms[side < 0 ? 0 : 1];
    const U = plan.upper, F = plan.fore, p = plan.palm;
    const shoulder = new THREE.Bone(), elbow = new THREE.Bone(), hand = new THREE.Bone();
    shoulder.position.set(side * body.shoulders, -plan.droop, 0);
    shoulder.rotation.z = side * 0.14;
    shoulder.name = side < 0 ? "left-shoulder" : "right-shoulder";
    hand.name = side < 0 ? "left-hand" : "right-hand";
    // Shoulder roots grow inward into the clavicle instead of ball sockets.
    tissue(shoulder, -side * 0.038, -0.012, -0.003, 0.089, 0.075, 0.062);
    tissue(shoulder, side * 0.01, -0.07, 0, 0.056 * g, 0.105, 0.054 * g);
    skin(shoulder, U, 0.038 * g, side * 0.016);
    tissue(shoulder, 0, -0.5 * U, 0.012, 0.039 * g, 0.2 * U, 0.037 * g);
    elbow.position.y = -U;
    skin(elbow, F, 0.026 * g, -side * 0.013);
    tissue(elbow, 0, 0.014, -0.008, 0.032, 0.054, 0.032);
    tissue(elbow, 0, -0.2 * F, 0.004, 0.036 * g, 0.19 * F, 0.031 * g);
    hand.position.y = -F;
    const count = FINGERS[plan.hand];
    if (plan.hand === "mitten") {
      // A swollen, fused paddle.
      tissue(hand, 0, -0.1 * p, 0.01, 0.05 * p, 0.12 * p, 0.034 * p);
    } else {
      const wide = plan.hand === "splay" ? 0.038 : plan.hand === "claw" ? 0.026 : 0.03;
      tissue(hand, 0, -0.055 * p, 0.005, wide * p, 0.083 * p, 0.022 * p);
    }
    for (let finger = 0; finger < count; finger++) {
      const index = finger - (count - 1) / 2;
      const joint = new THREE.Bone();
      const spacing = plan.hand === "splay" ? 0.016 : plan.hand === "claw" ? 0.017 : 0.02;
      joint.position.set(index * spacing * p, -0.1 * p, 0.006);
      joint.rotation.z = index * (plan.hand === "splay" ? 0.2 : 0.17);
      fingers.push({ bone: joint, side, index });
      hand.add(joint);
      const [length, radius, curve] =
        plan.hand === "claw" ? [0.21, 0.012, 0.03]
        : plan.hand === "twig" ? [0.23 - Math.abs(index) * 0.02, 0.0105, 0.018]
        : plan.hand === "splay" ? [0.15 - Math.abs(index) * 0.018, 0.0095, 0.012]
        : [0.135 - Math.abs(index) * 0.024, 0.011, 0.014];
      skin(joint, length * p, radius, index * curve + (plan.hand === "claw" ? side * 0.012 : 0), 0.006);
    }
    elbow.add(hand);
    shoulder.add(elbow);
    chest.add(shoulder);
    arms.push({ shoulder, elbow, hand });
  }
  return { hips, chest, heads, legs, arms, fingers, anatomy };
}

function bonesOf(root: THREE.Object3D) {
  const bones: THREE.Bone[] = [];
  root.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
  return bones;
}

/** Worker entry: the whole skinned surface for one appearance, as plain arrays. */
export function sculptEntity(variant: EntityVariant, seed: number) {
  const root = new THREE.Group();
  const rig = rigEntity(root, rollEntityBody(variant, seed));
  root.updateMatrixWorld(true);
  return sculptEntitySurface(rig.anatomy, bonesOf(root));
}

/** Soft, continuous anatomy; each seed grows a different long, narrow relative. */
export class EntityModel extends THREE.Group {
  readonly body: EntityBody;
  readonly variant: EntityVariant;
  /** False until a surface exists; the skeleton alone is invisible. */
  readonly sculpted: boolean;
  private hips: THREE.Bone;
  private chest: THREE.Bone;
  private heads: Head[];
  private legs: Leg[];
  private arms: Arm[];
  private fingers: Rig["fingers"];
  private motion = 0;
  private reach = 0;
  private down = new THREE.Vector3(0, -1, 0);
  private upper = new THREE.Vector3();
  private lower = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  private armPose = new THREE.Quaternion();
  /**
   * @param seed 0 grows the canonical body.
   * @param surface Pre-sculpted bind-pose surface; `null` leaves the model unskinned.
   */
  constructor(material: THREE.Material, variant: EntityVariant = "stalker", seed = 0, surface?: EntitySurface | null) {
    super();
    this.variant = variant;
    this.name = variant;
    this.body = rollEntityBody(variant, seed);
    const rig = rigEntity(this, this.body, material);
    ({ hips: this.hips, chest: this.chest, heads: this.heads, legs: this.legs, arms: this.arms, fingers: this.fingers } = rig);
    this.updateMatrixWorld(true);
    const bones = bonesOf(this);
    if (surface === undefined) surface = sculptEntitySurface(rig.anatomy, bones);
    this.sculpted = surface !== null;
    if (surface) this.add(skinEntitySurface(surface, bones, material));
    this.visible = false;
    this.animate(0, false, 0, 1);
  }
  get seed() {
    return this.body.seed;
  }
  animate(gait: number, moving: boolean, speed: number, dt: number, reach = 0, squeeze = 0, struggle = 0) {
    this.motion += ((moving ? 1 : 0) - this.motion) * Math.min(1, dt * 8);
    this.reach += (reach - this.reach) * Math.min(1, dt * 4);
    const rush = gaitUrgency(speed);
    const heavy = this.variant === "pyramid";
    const { hunch, lean } = this.body;
    // Rise over the supporting foot instead of walking in a permanent crouch.
    // The shorter leg sets the height; a longer one stays bent, and limps.
    const leg = Math.min(...this.body.legs);
    const rest = restHip(this.body);
    const stance = ((((gait + Math.PI / 2) / Math.PI) % 1) + 1) % 1;
    const plantedZ = (0.5 - stance) * stepLength(speed) * this.motion;
    const supportHeight =
      Math.sqrt((leg * 2 - 0.008) ** 2 - plantedZ ** 2) + 0.05;
    const hipHeight = rest + (supportHeight - rest) * this.motion;
    this.hips.position.y = hipHeight;
    this.hips.rotation.z = (this.body.legs[1] - this.body.legs[0]) * 0.5 * this.motion
      * Math.sin(gait);
    this.legs.forEach(({ hip, knee, ankle, length }, i) => {
      const phase = gait + i * Math.PI;
      const pose = solveEntityLeg(phase, speed, this.motion, hipHeight, length);
      hip.rotation.x = pose.hip;
      knee.rotation.x = pose.knee;
      ankle.rotation.x = pose.ankle;
      const arm = this.arms[i],
        lag = Math.sin(phase - (heavy ? 0.58 : 0.28));
      // A dropped shoulder drags its arm with less swing.
      const drag = 1 - this.body.arms[i].droop * 5;
      arm.shoulder.rotation.x = -lag * (0.25 + rush * 0.32) * this.motion * drag - hunch * 1.05;
      arm.shoulder.rotation.y = Math.sin(phase - 0.6) * 0.065 * this.motion;
      arm.shoulder.rotation.z = (i ? 1 : -1) * (0.065 + (1 + Math.sin(phase - 0.4)) * 0.022 * this.motion);
      arm.elbow.rotation.set(0, 0, 0);
      arm.elbow.rotation.x =
        -0.13 - rush * (heavy ? 0.42 : 0.6) - Math.max(0, -lag) * 0.19 * this.motion;
      arm.hand.rotation.x = 0.06 + Math.sin(phase - 0.5) * 0.09 * this.motion;
      arm.elbow.rotation.y = Math.sin(phase - 0.5) * (heavy ? 0.055 : 0.095) * this.motion;
      arm.hand.rotation.z = Math.sin(phase - 0.85) * 0.075 * this.motion;
      if (this.reach > 0.001) {
        const side = i ? 1 : -1;
        // Open elbows and forward palms become an enclosing, inward forearm arc.
        this.upper.set(side * (0.62 - squeeze * 0.05), -0.3 - squeeze * 0.15, 0.66 - squeeze * 0.2).normalize();
        this.armPose.setFromUnitVectors(this.down, this.upper);
        arm.shoulder.quaternion.slerp(this.armPose, this.reach);
        this.lower.set(side * (0.08 - squeeze * 0.98), -0.27, 0.9 - squeeze * 0.45).normalize();
        this.inverse.copy(arm.shoulder.quaternion).invert();
        this.lower.applyQuaternion(this.inverse);
        this.armPose.setFromUnitVectors(this.down, this.lower);
        arm.elbow.quaternion.slerp(this.armPose, this.reach);
        arm.hand.rotation.x = -0.22 - squeeze * 0.65;
      }
    });
    this.chest.rotation.x = hunch * (1 - this.reach * 0.5) + (heavy ? 0.095 : 0.035) + rush * 0.16
      + squeeze * 0.22 + Math.abs(struggle) * 0.09;
    this.chest.rotation.y = Math.sin(gait - (heavy ? 0.5 : 0.25)) * (heavy ? 0.065 : 0.045) * this.motion;
    this.chest.rotation.z = lean - Math.sin(gait) * 0.028 * this.motion + struggle * 0.075;
    for (const { bone, jaw, head, phase } of this.heads) {
      // Each head lolls on its own; the chest's hunch is mostly looked past.
      bone.rotation.z = head.tilt - (head.splay ? 0 : 0.09)
        - Math.sin(gait * 0.5 - 0.5 + phase) * 0.025 * this.motion - struggle * 0.09;
      bone.rotation.x = -hunch * 0.8 - rush * 0.1 + this.reach * 0.18 + squeeze * 0.12
        + Math.sin(gait * 2 - (heavy ? 0.8 : 0.3) + phase) * (heavy ? 0.028 : 0.012) * this.motion;
      bone.rotation.y = -this.chest.rotation.y * 0.7 + (this.heads.length > 1 ? Math.sin(phase) * 0.2 : 0);
      if (jaw) jaw.rotation.x = 0.55 + this.reach * 0.3 + squeeze * 0.2
        + Math.sin(gait * 3 + phase) * 0.03 * this.motion;
    }
    for (const { bone, side, index } of this.fingers) {
      bone.rotation.x = -0.16 - Math.abs(index) * 0.16 - this.reach * (0.24 + squeeze * 0.55)
        + Math.sin(gait - 0.9 + index * 0.55 + side) * 0.08 * this.motion;
      bone.rotation.z = index * (0.13 + this.reach * 0.12);
    }
  }
}
