import * as THREE from 'three';
import {clamp, TAU} from './core.js?v=13.0.0';
import {groundMaximum} from './grounding.js?v=24';
import {flightElevations, flightSample} from './flight-clearance.js?v=30';

export const MIN_CLOUD_FLIGHT_SECONDS = 12;
export const cloudFlightDuration = random => 12.8 + random() * 1.9;

const VISIT_FRACTIONS = [.23, .48, .73];
const CLOUD_RADIUS = 3.92;
const CLOUD_CLEARANCE = 2.72;
const SAMPLE_SECONDS = .10;
const TURN_RATE = .95;

// Lateral sway, lift and bank for the three variations in each flight leg.
const MANEUVERS = [
  [[7, 2.1, -.34], [-6, 3.4, .46], [5, 1, .24]],
  [[7, 2.4, .44], [-8, 4.6, -.40], [9, 2.7, .37]],
  [[-7, 2.2, -.44], [8, 5.1, .56], [9, 3.5, .42]],
  [[-11, 4.4, -.40], [12, 6.3, .52], [10, 3.5, .37]],
];

export function chooseCloudManeuvers(random) {
  return MANEUVERS.map(options => Math.floor(options.length * random()));
}

export class CloudPath {
  constructor(world, order, maneuvers, side, duration) {
    const first = order[0], last = order.at(-1), middle = order[1] ?? first;
    this.world = world;
    this.maneuvers = maneuvers;
    this.side = side;
    this.duration = duration;
    this.visits = VISIT_FRACTIONS.map(fraction => duration * fraction);
    this.times = [0, ...this.visits, duration];
    const nodes = [
      [first, -44, side * 14, 8.3],
      [first, 2, 0, 6],
      [middle, 5, side * 2.8, 6.7],
      [last, 11, -side * 2.6, 7.2],
      [last, 153, side * 21, 20],
    ];
    this.nodes = nodes.map(([view, along, across, height], index) => {
      const {track} = view.rig;
      const distance = view.state.distance + along + view.state.speed * (this.times[index] + .25);
      const p = track.sample(distance);
      const extra = world.route.lanes ? distance - clamp(distance, 0, track.length) : 0;
      return new THREE.Vector3(p.x + p.tx * extra + p.nx * across,
        p.y + p.ty * extra + height, p.z + p.tz * extra + p.nz * across);
    });
    this.curve = new THREE.CatmullRomCurve3(this.nodes, false, 'centripetal');
    // Match the incoming and outgoing speeds at each timed flyover.
    const step = .001;
    const near = new THREE.Vector3();
    const legSpeeds = this.times.slice(1).map((end, leg) => {
      const measure = (offset, node) => {
        this.curve.getPoint((leg + offset) / 4, near);
        return Math.hypot(near.x - node.x, near.z - node.z) / (step * (end - this.times[leg]));
      };
      return [measure(step, this.nodes[leg]), measure(1 - step, this.nodes[leg + 1])];
    });
    this.slopes = legSpeeds.map(([incoming, outgoing], leg) => {
      const start = Math.min(legSpeeds[leg - 1]?.[1] ?? incoming, incoming);
      const end = Math.min(legSpeeds[leg + 1]?.[0] ?? outgoing, outgoing);
      return [incoming > .01 ? start / incoming : 1, outgoing > .01 ? end / outgoing : 1];
    });
    this.before = new THREE.Vector3();
    this.after = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  phaseAt(time) {
    if (time <= this.visits[0]) return 0;
    if (time <= this.visits[1]) return 1;
    return time <= this.visits[2] ? 2 : 3;
  }

  phaseProgress(time, phase) {
    return clamp((time - this.times[phase]) / (this.times[phase + 1] - this.times[phase]), 0, 1);
  }

  rawPosition(time, out) {
    const phase = this.phaseAt(time), t = this.phaseProgress(time, phase);
    const [sway, lift] = MANEUVERS[phase][this.maneuvers[phase]];
    const start = this.nodes[phase], end = this.nodes[phase + 1];
    const heading = Math.atan2(end.x - start.x, end.z - start.z);
    const weight = Math.sin(Math.PI * t) ** 4;
    const lateral = this.side * sway * weight * Math.sin(TAU * t);
    const [startSlope, endSlope] = this.slopes[phase];
    const fraction = t + t * (1 - t) * ((startSlope - 1) * (1 - t) + (1 - endSlope) * t);
    this.curve.getPoint((phase + fraction) / 4, out);
    out.x += lateral * Math.cos(heading);
    out.z -= lateral * Math.sin(heading);
    out.y += lift * weight;
  }

  *planClearance() {
    const count = Math.ceil(this.duration / SAMPLE_SECONDS);
    this.sampleSeconds = this.duration / count;
    const positions = [], floors = new Float64Array(count + 1), steps = new Float64Array(count + 1);
    const {world} = this;
    for (let i = 0; i <= count; i++) {
      const pos = new THREE.Vector3();
      this.rawPosition(i * this.sampleSeconds, pos);
      positions.push(pos);
      yield;
    }
    for (let i = 0; i <= count; i++) {
      const {x, y, z} = positions[i];
      const previous = positions[Math.max(0, i - 1)], next = positions[Math.min(count, i + 1)];
      steps[i] = Math.hypot(x - previous.x, z - previous.z);
      const radius = CLOUD_RADIUS + Math.max(steps[i], Math.hypot(next.x - x, next.z - z)) * .70;
      const terrain = groundMaximum(world.terrainGrid, x, z, radius);
      const top = world.airspace.obstacleTop(x, z, radius, terrain);
      const floor = Math.max(y, top + CLOUD_CLEARANCE);
      floors[i] = world.rift?.clearance(x, floor, z, radius) ?? floor;
      yield;
    }
    this.heights = flightElevations(floors, .34, .28, steps);
    const yaws = new Float64Array(count + 1);
    for (let i = 0; i <= count; i++) {
      const a = positions[Math.max(0, i - 3)], b = positions[Math.min(count, i + 3)];
      const dx = b.x - a.x, dz = b.z - a.z;
      if (i === 0) yaws[i] = Math.atan2(dx, dz);
      else {
        const previous = yaws[i - 1], delta = Math.atan2(dx, dz) - previous;
        const limit = TURN_RATE * this.sampleSeconds;
        yaws[i] = Math.hypot(dx, dz) < .25 ? previous
          : previous + clamp(Math.atan2(Math.sin(delta), Math.cos(delta)), -limit, limit);
      }
    }
    this.yaws = yaws;
  }

  positionAt(time, out) {
    this.rawPosition(time, out);
    out.y = flightSample(this.heights, time / this.sampleSeconds);
  }

  sample(time, pose) {
    const yaw = flightSample(this.yaws, time / this.sampleSeconds);
    this.positionAt(time, pose.position);
    this.positionAt(Math.max(0, time - .12), this.before);
    this.positionAt(Math.min(this.duration, time + .12), this.after);
    const dx = this.after.x - this.before.x, dz = this.after.z - this.before.z;
    const phase = this.phaseAt(time), t = this.phaseProgress(time, phase);
    const [, , bank] = MANEUVERS[phase][this.maneuvers[phase]];
    const roll = this.side * bank * Math.sin(Math.PI * t) ** 2 * Math.cos((t - .26) * TAU);
    const pitch = clamp(-.55 * Math.atan2(this.after.y - this.before.y, Math.hypot(dx, dz)), -.34, .34);
    pose.rotation.setFromEuler(this.euler.set(pitch, yaw, roll));
    pose.yaw = yaw;
    return pose;
  }
}
