import * as THREE from 'three';
import {clamp, lerp, TAU} from './core.js?v=13.0.0';

export const CLOUD_VISITS = [1.60, 3.43, 5.17];
export const CLOUD_FLIGHT_SECONDS = 7.52;
const TIMES = [0, ...CLOUD_VISITS, CLOUD_FLIGHT_SECONDS];

// Each row contributes a lateral flourish, height change, bank, and yaw turn.
const MANEUVERS = [
  [[8, 2.1, -.34, .32], [-7, 3.4, .46, -.44], [5, 1, .24, TAU]],
  [[8, 2.4, .44, .22], [-10, 4.6, -.40, -.24], [10, 2.7, .37, -TAU]],
  [[-8, 2.2, -.44, .26], [9, 5.1, .56, -.82], [11, 3.5, .42, TAU]],
  [[-12, 4.4, -.40, -.34], [15, 6.3, .52, TAU], [11, 3.5, .37, -.48]],
];
const SWEEP_CYCLES = [
  [0.5, 0.8, 0.5], [0.5, 1.45, 0.5], [1.2, 0.5, 1.05], [0.5, 0.82, 1.25],
];

export function chooseCloudManeuvers(random) {
  return MANEUVERS.map(options => Math.floor(options.length * random()));
}

function smooth(u) {
  return u ** 3 * (10 - 15 * u + 6 * u * u);
}

function phaseAt(time) {
  if (time <= TIMES[1]) return 0;
  if (time <= TIMES[2]) return 1;
  return time <= TIMES[3] ? 2 : 3;
}

export class CloudPath {
  constructor(world, order, maneuvers, side) {
    const first = order[0], last = order.at(-1);
    const middle = order[1] ?? first;
    this.world = world;
    this.maneuvers = maneuvers;
    this.side = side;
    this.nodes = [
      {view: first, along: -41, across: side * 14, height: 7.8, speed: 26},
      {view: first, along: 0, across: 0, height: 5.6, speed: 12},
      {view: middle, along: 3, across: side * 1.8, height: 6.0, speed: 13},
      {view: last, along: 7, across: -side * 1.85, height: 6.45, speed: 19},
      {view: last, along: 147, across: side * 13, height: 14.5, speed: 96},
    ];
    this.a = {};
    this.b = {};
    this.before = new THREE.Vector3();
    this.after = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  readNode(node, delta, interpolated, out) {
    const {view, along, across, height} = node, {track} = view.rig;
    const cart = interpolated ? view.motion : view.state;
    const distance = cart.distance + along + delta * cart.speed;
    track.sample(distance, out);
    const extra = this.world.route.lanes ? distance - clamp(distance, 0, track.length) : 0;
    out.x += out.tx * extra + out.nx * across;
    out.z += out.tz * extra + out.nz * across;
    out.y += out.ty * extra + height;
  }

  positionAt(time, now, interpolated, out) {
    const phase = phaseAt(time), t0 = TIMES[phase], duration = TIMES[phase + 1] - t0;
    const u = clamp((time - t0) / duration, 0, 1);
    const i = this.maneuvers[phase], [sway, lift] = MANEUVERS[phase][i];
    const a = this.a, b = this.b, from = this.nodes[phase], to = this.nodes[phase + 1];
    this.readNode(from, time - now, interpolated, a);
    this.readNode(to, time - now, interpolated, b);
    const mix = smooth(u), u3 = u ** 3, u4 = u3 * u, u5 = u4 * u;
    // The same endpoint position and velocity join every pair of maneuvers.
    const v0 = duration * (u - 6 * u3 + 8 * u4 - 3 * u5) * from.speed;
    const v1 = duration * (-4 * u3 + 7 * u4 - 3 * u5) * to.speed;
    const window = Math.sin(Math.PI * u) ** 4;
    const lateral = this.side * sway * window * Math.sin(TAU * u * SWEEP_CYCLES[phase][i]);
    const yaw = a.yaw + mix * Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    out.x = lerp(a.x, b.x, mix) + a.tx * v0 + b.tx * v1 + lateral * Math.cos(yaw);
    out.z = lerp(a.z, b.z, mix) + a.tz * v0 + b.tz * v1 - lateral * Math.sin(yaw);
    const desired = lerp(a.y, b.y, mix) + lift * window;
    const radius = 2.9, x = out.x, z = out.z;
    const ground = Math.max(this.world.groundHeight(x, z),
      this.world.groundHeight(x - radius, z), this.world.groundHeight(x + radius, z),
      this.world.groundHeight(x, z - radius), this.world.groundHeight(x, z + radius));
    const obstacle = this.world.airspace.obstacleTop(x, z, radius, ground, 16);
    const floor = Math.max(ground, obstacle) + 2;
    // Blend onto the clearance envelope instead of abruptly changing altitude.
    const overlap = Math.max(0, 1.8 - Math.abs(desired - floor));
    out.y = Math.max(desired, floor) + overlap * overlap / 7.2;
    return yaw;
  }

  sample(time, now, interpolated, pose) {
    const yawHint = this.positionAt(time, now, interpolated, pose.position);
    this.positionAt(Math.max(0, time - .108), now, interpolated, this.before);
    this.positionAt(Math.min(CLOUD_FLIGHT_SECONDS, time + .108), now, interpolated, this.after);
    const dx = this.after.x - this.before.x, dz = this.after.z - this.before.z;
    const horizontal = Math.hypot(dx, dz);
    const yaw = horizontal > .12 ? Math.atan2(dx, dz) : yawHint;
    const phase = phaseAt(time), u = clamp((time - TIMES[phase]) / (TIMES[phase + 1] - TIMES[phase]), 0, 1);
    const [, , bank, spin] = MANEUVERS[phase][this.maneuvers[phase]];
    const envelope = Math.sin(Math.PI * u) ** 4;
    const roll = this.side * bank * envelope * Math.cos(Math.PI * u);
    const yawTurn = Math.abs(spin) > Math.PI ? spin * smooth(clamp((u - .12) / .77, 0, 1)) : spin * envelope;
    const pitch = clamp(-.6 * Math.atan2(this.after.y - this.before.y, horizontal), -.34, .34);
    pose.rotation.setFromEuler(this.euler.set(pitch, yaw + this.side * yawTurn, roll));
    pose.yaw = yaw;
    return pose;
  }
}
