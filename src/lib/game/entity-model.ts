import * as THREE from "three";
import {
  gaitUrgency,
  LEG_LENGTH,
  solveEntityLeg,
  stepLength,
} from "./entity-gait";

/** Soft, continuous anatomy keeps the original long, narrow silhouette. */
export class EntityModel extends THREE.Group {
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }[] =
    [];
  private arms: {
    shoulder: THREE.Group;
    elbow: THREE.Group;
    hand: THREE.Group;
  }[] = [];
  private motion = 0;
  private reach = 0;
  private down = new THREE.Vector3(0, -1, 0);
  private upper = new THREE.Vector3();
  private lower = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  private armPose = new THREE.Quaternion();
  constructor(material: THREE.Material, variant: "stalker" | "pyramid" = "stalker") {
    super();
    const mesh = (parent: THREE.Group, geometry: THREE.BufferGeometry) => {
      const result = new THREE.Mesh(geometry, material);
      result.castShadow = result.receiveShadow = true;
      parent.add(result);
      return result;
    };
    const skin = (
      parent: THREE.Group,
      length: number,
      radius: number,
      curve = 0.01,
    ) => {
      const geometry = new THREE.CapsuleGeometry(radius, length, 8, 16);
      geometry.translate(0, -length / 2, 0);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i),
          t = THREE.MathUtils.clamp(-y / length, 0, 1);
        // Slightly bowed, tapered tissue, with overlapping rounded ends at each joint.
        const fullness = 0.72 + Math.sin(t * Math.PI) * 0.2 + (1 - t) * 0.12;
        positions.setXYZ(
          i,
          positions.getX(i) * fullness + Math.sin(t * Math.PI) * curve,
          y,
          positions.getZ(i) *
            fullness *
            (0.87 + 0.08 * Math.sin(t * Math.PI * 2)),
        );
      }
      geometry.computeVertexNormals();
      return mesh(parent, geometry);
    };
    const tissue = (
      parent: THREE.Group,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
    ) => {
      const result = mesh(parent, new THREE.SphereGeometry(1, 24, 18));
      result.position.set(x, y, z);
      result.scale.set(sx, sy, sz);
      return result;
    };
    this.name = variant;
    this.hips.position.y = 1.33;
    this.add(this.hips);
    tissue(this.hips, 0, 0, 0, 0.145, 0.14, 0.085);
    this.chest.position.set(0.025, 0.86, 0);
    this.hips.add(this.chest);
    skin(this.chest, 0.86, 0.093, -0.022);
    tissue(this.chest, -0.01, -0.17, 0, 0.115, 0.25, 0.075);
    tissue(this.chest, 0, 0, 0, 0.29, 0.095, 0.082);
    const neck = new THREE.Group();
    neck.position.set(0.025, 0.17, 0.01);
    this.chest.add(neck);
    skin(neck, 0.17, 0.044, -0.008);
    this.head.position.set(0.04, 0.3, 0.025);
    if (variant === "pyramid") {
      // A broad, faceted head with a forward-leaning apex; still fits the doors.
      const geometry = new THREE.ConeGeometry(0.45, 0.72, 4, 1);
      geometry.rotateY(Math.PI / 4);
      const vertices = geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const height = (vertices.getY(i) + 0.36) / 0.72;
        vertices.setZ(i, vertices.getZ(i) * 1.12 + height * 0.16);
      }
      geometry.computeVertexNormals();
      const skull = mesh(this.head, geometry);
      skull.name = "pyramid-head";
      skull.position.y = 0.02;
    } else {
      const skull = tissue(this.head, 0, 0, 0, 0.132, 0.232, 0.126);
      const vertices = skull.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const y = vertices.getY(i);
        const taper = 0.88 + (0.12 * (y + 1)) / 2;
        vertices.setX(i, vertices.getX(i) * taper + 0.035 * Math.sin(y * 2.5));
        vertices.setZ(i, vertices.getZ(i) * taper - 0.035 * y);
      }
      skull.geometry.computeVertexNormals();
    }
    this.chest.add(this.head);
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(),
        knee = new THREE.Group(),
        ankle = new THREE.Group();
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
      const shoulder = new THREE.Group(),
        elbow = new THREE.Group(),
        hand = new THREE.Group();
      shoulder.position.x = side * 0.24;
      shoulder.name = side < 0 ? "left-shoulder" : "right-shoulder";
      hand.name = side < 0 ? "left-hand" : "right-hand";
      shoulder.rotation.z = side * 0.075;
      skin(shoulder, 0.65, 0.04, side * 0.016);
      elbow.position.y = -0.65;
      skin(elbow, 0.79, 0.028, -side * 0.013);
      hand.position.y = -0.79;
      tissue(hand, 0, -0.055, 0.005, 0.029, 0.083, 0.022);
      for (let finger = -1; finger <= 1; finger++) {
        const joint = new THREE.Group();
        joint.position.set(finger * 0.017, -0.11, 0.006);
        joint.rotation.x = -0.12 - Math.abs(finger) * 0.12;
        hand.add(joint);
        skin(joint, 0.065 - Math.abs(finger) * 0.013, 0.008, finger * 0.004);
      }
      elbow.add(hand);
      shoulder.add(elbow);
      this.chest.add(shoulder);
      this.arms.push({ shoulder, elbow, hand });
    }
    this.visible = false;
    this.animate(0, false, 0, 1);
  }
  animate(gait: number, moving: boolean, speed: number, dt: number, reach = 0, squeeze = 0, struggle = 0) {
    this.motion += ((moving ? 1 : 0) - this.motion) * Math.min(1, dt * 8);
    this.reach += (reach - this.reach) * Math.min(1, dt * 4);
    const rush = gaitUrgency(speed);
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
        lag = Math.sin(phase - 0.22);
      arm.shoulder.rotation.x = -lag * (0.25 + rush * 0.32) * this.motion;
      arm.shoulder.rotation.y = 0;
      arm.shoulder.rotation.z = (i ? 1 : -1) * 0.075;
      arm.elbow.rotation.set(0, 0, 0);
      arm.elbow.rotation.x =
        -0.13 - rush * 0.6 - Math.max(0, -lag) * 0.13 * this.motion;
      arm.hand.rotation.x = 0.06 + Math.sin(phase - 0.5) * 0.09 * this.motion;
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
    this.chest.rotation.x = 0.035 + rush * 0.16 + squeeze * 0.22 + Math.abs(struggle) * 0.09;
    this.chest.rotation.y = Math.sin(gait - 0.25) * 0.045 * this.motion;
    this.chest.rotation.z = -Math.sin(gait) * 0.028 * this.motion + struggle * 0.075;
    this.head.rotation.z =
      -0.09 - Math.sin(gait * 0.5 - 0.5) * 0.025 * this.motion - struggle * 0.09;
    this.head.rotation.x = -rush * 0.1 + this.reach * 0.18 + squeeze * 0.12;
  }
}
