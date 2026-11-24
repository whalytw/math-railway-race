import * as THREE from 'three';
import {clamp, lerp, TAU} from './core.js?v=13.0.0';

import {groundMaximum} from './grounding.js?v=24';

export const MIN_CLOUD_FLIGHT_SECONDS = 12;
export const cloudFlightDuration = random => 12.8 + random() * 1.9;

const VISIT_FRACTIONS = [.23, .48, .73];
const CLOUD_RADIUS = 3.92;
const CLOUD_CLEARANCE = 2.52;
const FLIGHT_SAMPLE_SECONDS = .12;
const CLIMB_GRADE = .65;
const DESCENT_GRADE = .56;

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

export class CloudPath {
  constructor(world, order, maneuvers, side, duration) {
    const first = order[0], last = order.at(-1);
    const middle = order[1] ?? first;
    this.world = world;
    this.maneuvers = maneuvers;
    this.side = side;
    this.duration = duration;
    this.visits = VISIT_FRACTIONS.map(fraction => duration * fraction);
    this.times = [0, ...this.visits, duration];
    this.nodes = [
      {view: first, along: -38, across: side * 13.5, height: 7.6, speed: 17},
      {view: first, along: 0, across: 0, height: 5.6, speed: 8},
      {view: middle, along: 3, across: side * 1.8, height: 6.0, speed: 9},
      {view: last, along: 7, across: -side * 1.85, height: 6.45, speed: 12},
      {view: last, along: 133, across: side * 13, height: 16, speed: 63},
    ];
    this.a = {};
    this.b = {};
    this.before = new THREE.Vector3();
    this.after = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  phaseAt(time) {
    if (time <= this.visits[0]) return 0;
    if (time <= this.visits[1]) return 1;
    return time <= this.visits[2] ? 2 : 3;
  }

  clearanceAt(x, z) {
    const terrain = groundMaximum(this.world.terrainGrid, x, z, CLOUD_RADIUS);
    const altitude = this.world.airspace.obstacleTop(x, z, CLOUD_RADIUS, terrain, 18) + CLOUD_CLEARANCE;
    return this.world.rift?.clearance(x, altitude, z, CLOUD_RADIUS) ?? altitude;
  }

  *planClearance() {
    const initial = new Map(this.nodes.map(({view}) => [view, {distance: view.state.distance, speed: view.state.speed}]));
    const count = Math.ceil(this.duration / FLIGHT_SAMPLE_SECONDS);
    this.floorStep = this.duration / count;
    const point = new THREE.Vector3(), previous = new THREE.Vector3();
    const floors = new Float64Array(count + 1), steps = new Float64Array(count + 1);
    for (let i = 0; i <= count; i++) {
      this.rawPosition(i * this.floorStep, 0, false, point, initial);
      floors[i] = this.clearanceAt(point.x, point.z);
      steps[i] = Math.hypot(point.x - previous.x, point.z - previous.z);
      previous.copy(point);
      yield;
    }
    // Use distance along the route so a ridge between separated carts does
    // not lift the cloud too early at either cart's low flyover.
    for (let i = count - 1; i >= 0; i--) floors[i] = Math.max(floors[i], floors[i + 1] - steps[i + 1] * CLIMB_GRADE);
    for (let i = 1; i <= count; i++) floors[i] = Math.max(floors[i], floors[i - 1] - steps[i] * DESCENT_GRADE);
    this.floors = floors;
  }

  readNode(node, delta, interpolated, out, initial) {
    const {view, along, across, height} = node, {track} = view.rig;
    const cart = initial?.get(view) ?? (interpolated ? view.motion : view.state);
    const distance = cart.distance + along + delta * cart.speed;
    track.sample(distance, out);
    const extra = this.world.route.lanes ? distance - clamp(distance, 0, track.length) : 0;
    out.x += out.tx * extra + out.nx * across;
    out.z += out.tz * extra + out.nz * across;
    out.y += out.ty * extra + height;
  }

  rawPosition(time, now, interpolated, out, initial) {
    const phase = this.phaseAt(time), t0 = this.times[phase], duration = this.times[phase + 1] - t0;
    const u = clamp((time - t0) / duration, 0, 1);
    const i = this.maneuvers[phase], [sway, lift] = MANEUVERS[phase][i];
    const a = this.a, b = this.b, from = this.nodes[phase], to = this.nodes[phase + 1];
    this.readNode(from, time - now, interpolated, a, initial);
    this.readNode(to, time - now, interpolated, b, initial);
    const mix = smooth(u), u3 = u ** 3, u4 = u3 * u, u5 = u4 * u;
    // The same endpoint position and velocity join every pair of maneuvers.
    const v0 = duration * (u - 6 * u3 + 8 * u4 - 3 * u5) * from.speed;
    const v1 = duration * (-4 * u3 + 7 * u4 - 3 * u5) * to.speed;
    const window = Math.sin(Math.PI * u) ** 4;
    const lateral = this.side * sway * window * Math.sin(TAU * u * SWEEP_CYCLES[phase][i]);
    const yaw = a.yaw + mix * Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
    out.x = lerp(a.x, b.x, mix) + a.tx * v0 + b.tx * v1 + lateral * Math.cos(yaw);
    out.z = lerp(a.z, b.z, mix) + a.tz * v0 + b.tz * v1 - lateral * Math.sin(yaw);
    const rise = i === 1 ? .35 - .85 * Math.cos(TAU * u * 1.12) : 1;
    out.y = lerp(a.y, b.y, mix) + lift * window * rise;
    return yaw;
  }

  positionAt(time, now, interpolated, out) {
    const yaw = this.rawPosition(time, now, interpolated, out);
    // Use the planned climb as well as the exact live footprint when the carts
    // change speeds after launch.
    let floor = this.clearanceAt(out.x, out.z);
    if (this.floors) {
      const i = Math.min(this.floors.length - 2, Math.floor(time / this.floorStep));
      floor = Math.max(floor, lerp(this.floors[i], this.floors[i + 1], clamp(time / this.floorStep - i, 0, 1)));
    }
    const overlap = Math.max(0, 1.8 - Math.abs(out.y - floor));
    out.y = Math.max(out.y, floor) + overlap * overlap / 7.2;
    return yaw;
  }

  sample(time, now, interpolated, pose) {
    const yawHint = this.positionAt(time, now, interpolated, pose.position);
    this.positionAt(Math.max(0, time - .108), now, interpolated, this.before);
    this.positionAt(Math.min(this.duration, time + .108), now, interpolated, this.after);
    const dx = this.after.x - this.before.x, dz = this.after.z - this.before.z;
    const horizontal = Math.hypot(dx, dz);
    const yaw = horizontal > .12 ? Math.atan2(dx, dz) : yawHint;
    const phase = this.phaseAt(time);
    const u = clamp((time - this.times[phase]) / (this.times[phase + 1] - this.times[phase]), 0, 1);
    const [, , bank, spin] = MANEUVERS[phase][this.maneuvers[phase]];
    const envelope = Math.sin(Math.PI * u) ** 4;
    const tilt = Math.sin(Math.PI * u) ** 2 * Math.cos((u - .26) * TAU);
    const roll = this.side * bank * tilt;
    const yawTurn = Math.abs(spin) > Math.PI ? spin * smooth(clamp((u - .12) / .77, 0, 1)) : spin * envelope;
    const pitch = clamp(-.6 * Math.atan2(this.after.y - this.before.y, horizontal), -.34, .34);
    pose.rotation.setFromEuler(this.euler.set(pitch, yaw + this.side * yawTurn, roll));
    pose.yaw = yaw;
    return pose;
  }
}
