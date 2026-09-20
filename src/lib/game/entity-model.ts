import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { sculptEntitySkin, type Tissue } from "./entity-skin";
import {
  gaitUrgency,
  LEG_LENGTH,
  solveEntityLeg,
  stepLength,
} from "./entity-gait";

/** Soft, continuous anatomy keeps the original long, narrow silhouette. */
export class EntityModel extends THREE.Group {
  private hips = new THREE.Bone();
  private chest = new THREE.Bone();
  private head = new THREE.Bone();
  private legs: { hip: THREE.Bone; knee: THREE.Bone; ankle: THREE.Bone }[] =
    [];
  private arms: {
    shoulder: THREE.Bone;
    elbow: THREE.Bone;
    hand: THREE.Bone;
  }[] = [];
  private variant: "stalker" | "pyramid";
  private fingers: { bone: THREE.Bone; side: number; index: number }[] = [];
  private motion = 0;
  private reach = 0;
  private down = new THREE.Vector3(0, -1, 0);
  private upper = new THREE.Vector3();
  private lower = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  private armPose = new THREE.Quaternion();
  constructor(material: THREE.Material, variant: "stalker" | "pyramid" = "stalker") {
    super();
    this.variant = variant;
    const anatomy: Tissue[] = [];
    const tissue = (parent: THREE.Bone, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      anatomy.push({ bone: parent, center: new THREE.Vector3(x, y, z), radii: new THREE.Vector3(sx, sy, sz) });
    };
    const skin = (parent: THREE.Bone, length: number, radius: number, curve = 0.01, blend = 0.026) => {
      anatomy.push({ bone: parent,
        center: new THREE.Vector3(0, -length / 2, 0),
        radii: new THREE.Vector3(radius + Math.abs(curve), length / 2 + radius, radius),
        length, radius, curve, blend,
      });
    };
    this.name = variant;
    this.hips.position.y = 1.33;
    this.add(this.hips);
    tissue(this.hips, 0, 0, 0, 0.145, 0.14, 0.085);
    this.chest.position.set(0.025, 0.86, 0);
    this.hips.add(this.chest);
    skin(this.chest, 0.86, 0.093, -0.022);
    tissue(this.chest, -0.01, -0.17, 0, 0.115, 0.25, 0.075);
    tissue(this.chest, 0, -0.028, -0.009, 0.245, 0.098, 0.081);
    for (const side of [-1, 1]) {
      // Sloping trapezius and swept shoulder blades erase the horizontal bar.
      tissue(this.chest, side * 0.085, 0.025, -0.012, 0.098, 0.086, 0.058);
      tissue(this.chest, side * 0.076, -0.16, -0.034, 0.063, 0.155, 0.06);
    }
    const neck = new THREE.Bone();
    neck.position.set(0.025, 0.17, 0.01);
    this.chest.add(neck);
    skin(neck, 0.17, 0.044, -0.008);
    this.head.position.set(0.015, 0.13, 0.015);
    if (variant === "pyramid") {
      // A broad, faceted head with a forward-leaning apex; still fits the doors.
      // Truncated ridges catch only a hairline of light. The primary planes stay
      // severe, with an off-axis apex and an asymmetric, undercut lower rim.
      const corners = [
        new THREE.Vector3(-0.318, -0.34, -0.356),
        new THREE.Vector3(0.318, -0.34, -0.356),
        new THREE.Vector3(0.318, -0.36, 0.356),
        new THREE.Vector3(-0.318, -0.36, 0.356),
        new THREE.Vector3(0.024, 0.36, 0.16),
      ];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]];
      const bevel = edges.flatMap(([a, b]) => [
        corners[a].clone().lerp(corners[b], 0.024),
        corners[b].clone().lerp(corners[a], 0.024),
      ]);
      const geometry = new ConvexGeometry(bevel);
      const skull = new THREE.Mesh(geometry, material);
      skull.castShadow = skull.receiveShadow = true;
      this.head.add(skull);
      skull.name = "pyramid-head";
      skull.position.y = 0.02;
    } else {
      // A continuous cranial envelope: narrow jaw, swept occiput, no face.
      tissue(this.head, 0, 0.025, -0.018, 0.125, 0.207, 0.116);
      tissue(this.head, -0.015, -0.11, 0.017, 0.086, 0.105, 0.082);
    }
    neck.add(this.head);
    for (const side of [-1, 1]) {
      const hip = new THREE.Bone(),
        knee = new THREE.Bone(),
        ankle = new THREE.Bone();
      hip.name = side < 0 ? "left-hip" : "right-hip";
      knee.name = side < 0 ? "left-knee" : "right-knee";
      ankle.name = side < 0 ? "left-ankle" : "right-ankle";
      hip.position.x = side * 0.13;
      skin(hip, LEG_LENGTH, 0.053, side * 0.008);
      knee.position.y = -LEG_LENGTH;
      skin(knee, LEG_LENGTH, 0.036, -side * 0.008);
      tissue(knee, 0, 0, 0.006, 0.035, 0.04, 0.034);
      ankle.position.y = -LEG_LENGTH;
      tissue(ankle, 0, -0.005, 0.063, 0.052, 0.045, 0.145);
      knee.add(ankle);
      hip.add(knee);
      this.hips.add(hip);
      this.legs.push({ hip, knee, ankle });
      const shoulder = new THREE.Bone(),
        elbow = new THREE.Bone(),
        hand = new THREE.Bone();
      shoulder.position.x = side * 0.24;
      shoulder.rotation.z = side * 0.14;
      shoulder.name = side < 0 ? "left-shoulder" : "right-shoulder";
      hand.name = side < 0 ? "left-hand" : "right-hand";
      // Shoulder roots grow inward into the clavicle instead of ball sockets.
      tissue(shoulder, -side * 0.038, -0.012, -0.003, 0.089, 0.075, 0.062);
      skin(shoulder, 0.65, 0.04, side * 0.016);
      elbow.position.y = -0.65;
      skin(elbow, 0.79, 0.028, -side * 0.013);
      tissue(elbow, 0, 0.014, -0.008, 0.032, 0.054, 0.032);
      hand.position.y = -0.79;
      tissue(hand, 0, -0.055, 0.005, 0.029, 0.083, 0.022);
      for (let finger = -1; finger <= 1; finger++) {
        const joint = new THREE.Bone();
        joint.position.set(finger * 0.021, -0.1, 0.006);
        joint.rotation.z = finger * 0.19;
        this.fingers.push({ bone: joint, side, index: finger });
        hand.add(joint);
        skin(joint, 0.135 - Math.abs(finger) * 0.024, 0.011, finger * 0.014, 0.006);
      }
      elbow.add(hand);
      shoulder.add(elbow);
      this.chest.add(shoulder);
      this.arms.push({ shoulder, elbow, hand });
    }
    this.updateMatrixWorld(true);
    const bones: THREE.Bone[] = [];
    this.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
    this.add(sculptEntitySkin(anatomy, bones, material));
    this.visible = false;
    this.animate(0, false, 0, 1);
  }
  animate(gait: number, moving: boolean, speed: number, dt: number, reach = 0, squeeze = 0, struggle = 0) {
    this.motion += ((moving ? 1 : 0) - this.motion) * Math.min(1, dt * 8);
    this.reach += (reach - this.reach) * Math.min(1, dt * 4);
    const rush = gaitUrgency(speed);
    const heavy = this.variant === "pyramid";
    // Rise over the supporting foot instead of walking in a permanent crouch.
    const stance = ((((gait + Math.PI / 2) / Math.PI) % 1) + 1) % 1;
    const plantedZ = (0.5 - stance) * stepLength(speed) * this.motion;
    const supportHeight =
      Math.sqrt((LEG_LENGTH * 2 - 0.008) ** 2 - plantedZ ** 2) + 0.05;
    const hipHeight = 1.33 + (supportHeight - 1.33) * this.motion;
    this.hips.position.y = hipHeight;
    this.legs.forEach(({ hip, knee, ankle }, i) => {
      const phase = gait + i * Math.PI;
      const pose = solveEntityLeg(phase, speed, this.motion, hipHeight);
      hip.rotation.x = pose.hip;
      knee.rotation.x = pose.knee;
      ankle.rotation.x = pose.ankle;
      const arm = this.arms[i],
        lag = Math.sin(phase - (heavy ? 0.58 : 0.28));
      arm.shoulder.rotation.x = -lag * (0.25 + rush * 0.32) * this.motion;
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
    this.chest.rotation.x = (heavy ? 0.095 : 0.035) + rush * 0.16 + squeeze * 0.22 + Math.abs(struggle) * 0.09;
    this.chest.rotation.y = Math.sin(gait - (heavy ? 0.5 : 0.25)) * (heavy ? 0.065 : 0.045) * this.motion;
    this.chest.rotation.z = -Math.sin(gait) * 0.028 * this.motion + struggle * 0.075;
    this.head.rotation.z =
      -0.09 - Math.sin(gait * 0.5 - 0.5) * 0.025 * this.motion - struggle * 0.09;
    this.head.rotation.x = -rush * 0.1 + this.reach * 0.18 + squeeze * 0.12
      + Math.sin(gait * 2 - (heavy ? 0.8 : 0.3)) * (heavy ? 0.028 : 0.012) * this.motion;
    this.head.rotation.y = -this.chest.rotation.y * 0.7;
    for (const { bone, side, index } of this.fingers) {
      bone.rotation.x = -0.16 - Math.abs(index) * 0.16 - this.reach * (0.24 + squeeze * 0.55)
        + Math.sin(gait - 0.9 + index * 0.55 + side) * 0.08 * this.motion;
      bone.rotation.z = index * (0.13 + this.reach * 0.12);
    }
  }
}
