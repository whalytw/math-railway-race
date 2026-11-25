import * as THREE from 'three';
import {clamp, lerp, smoothstep} from './core.js?v=13.0.0';
import {ESCORT_EXITS} from './rift-rules.js?v=30';

const APPROACH_SECONDS = 3.1;
const DEPARTURE_SECONDS = 4.6;
const UP = new THREE.Vector3(0, 1, 0);

const paths = [
  // Accelerating barrel roll and an outward full roll.
  [[0, 0, 0], [0, 1, 22], [2, 4, 56], [4, 8, 102], [8, 15, 182]],
  [[0, 0, 0], [8, 2, 15], [28, 6, 39], [55, 14, 72], [112, 26, 131]],
  // High arc, outward dive and recovery, and an ascending S turn.
  [[0, 0, 0], [2, 18, 17], [12, 41, 46], [27, 55, 88], [47, 48, 158]],
  [[0, 0, 0], [15, -4, 14], [37, -14, 34], [68, -5, 70], [107, 29, 141]],
  [[0, 0, 0], [18, 8, 17], [-12, 18, 46], [22, 27, 77], [52, 39, 155]],
  // A rising helix, a shallow diagonal sweep, and a high banking hook.
  [[0, 0, 0], [14, 15, 13], [-7, 35, 31], [-25, 19, 52], [12, 12, 85], [57, 45, 140]],
  [[0, 0, 0], [12, 3, 19], [36, 10, 49], [78, 25, 94], [163, 55, 158]],
  [[0, 0, 0], [15, 13, 14], [45, 26, 29], [39, 39, 56], [4, 46, 91], [-52, 56, 155]],
];
const banks = [0, 0, .27, -.31, .36, .40, .32, .47];
const flightPaths = paths.map(points => new THREE.CatmullRomCurve3(
  points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal'));

export class SpacecraftEscort {
  constructor(parent, model, layer) {
    this.root = new THREE.Group();
    this.root.name = 'RiftEscort' + layer;
    this.root.add(model);
    this.root.traverse(node => node.layers.set(layer));
    parent.add(this.root);
    this.origin = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.reset(null);
  }

  reset(plan) {
    this.plan = plan;
    this.started = null;
    this.leaving = false;
    this.root.visible = false;
  }

  departing(time, out) {
    const fraction = clamp(time / DEPARTURE_SECONDS, 0, 1);
    const t = fraction * fraction * (2 - fraction);
    flightPaths[this.plan.exit].getPoint(t, out);
    out.x *= this.plan.side;
    return out.applyAxisAngle(UP, this.yaw).add(this.origin).addScaledVector(this.forward, time * this.speed);
  }

  update(view, seconds, reducedMotion) {
    const {plan, root} = this, track = view.riftTrack;
    root.visible = false;
    if (!plan || !track || view.motion.distance < track.start + plan.start * track.length) return;
    this.started ??= seconds;
    const age = seconds - this.started;
    const exitTime = age - APPROACH_SECONDS - plan.follow;
    if (exitTime >= DEPARTURE_SECONDS) return;
    const {rig} = view, yaw = rig.sample.yaw;
    if (exitTime < 0 || !this.leaving) {
      const approach = smoothstep(0, APPROACH_SECONDS, age);
      root.position.set(plan.side * lerp(plan.entryOffset, 11, approach),
        lerp(8, 5.5, approach), lerp(-58, 10, approach))
        .applyAxisAngle(UP, yaw).add(rig.root.position);
      root.rotation.set(0, yaw - plan.side * (1 - approach) * .12, plan.side * .12 * (1 - approach), 'YXZ');
    }
    if (exitTime >= 0) {
      if (!this.leaving) {
        this.leaving = true;
        this.yaw = yaw;
        this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
        this.speed = Math.max(0, view.motion.speed);
        this.origin.copy(root.position).addScaledVector(this.forward, -exitTime * this.speed);
      }
      this.departing(exitTime, root.position);
      this.departing(Math.min(DEPARTURE_SECONDS, exitTime + .05), this.look);
      root.lookAt(this.look);
      const t = exitTime / DEPARTURE_SECONDS;
      const roll = plan.exit === ESCORT_EXITS.barrel || plan.exit === ESCORT_EXITS.outward
        ? (plan.exit === ESCORT_EXITS.barrel ? -1 : 1) * Math.PI * 2 * smoothstep(.16, .76, t)
        : banks[plan.exit] * Math.sin(Math.PI * t) * Math.cos(t * Math.PI);
      if (!reducedMotion) root.rotateZ(roll * plan.side);
    }
    root.scale.setScalar(1 - .99 * smoothstep(DEPARTURE_SECONDS - 1.05, DEPARTURE_SECONDS, exitTime));
    root.visible = true;
  }
}
