import * as THREE from 'three';
import {clamp, GRAVITY, lerp, smoothstep, TAU} from './core.js?v=13.0.0';
import {footprintMaximum} from './grounding.js?v=24';
import {AircraftShadow} from './aircraft-shadow.js?v=24';
import {AirshowSmoke, SMOKE_LIFETIME} from './airshow-smoke.js?v=23';

export const BIPLANE_ASSET = 'AirshowBiplane';

const APPROACH_SPEED = 110 / 3.6;
const APPROACH_HOLD = 2.2;
const APPROACH_RAMP = 3.6;
const EXIT_SPEED = 238 / 3.6;
const EXIT_RAMP = 5.5;
const MAX_GRADE = 0.23;
const ENTRY_FRAME = 18;
const ARC_SAMPLES = 8;
const HEADING_LOOKAHEAD = 29;
const BANK_STEP = 0.10;
const BANK_RATE = 1.4;
const PLANNING_BUDGET_MS = 3;
const SMOOTHING = [1, 8, 28, 56, 70, 56, 28, 8, 1];

function ease(t) {
  const u = clamp(t, 0, 1);
  return u ** 3 * (10 + u * (-15 + 6 * u));
}

const windowed = (u, from = 0, to = 1) => Math.sin(Math.PI * clamp((u - from) / (to - from), 0, 1)) ** 2;
const wave = (u, cycles) => windowed(u) * Math.sin(TAU * u * cycles);
const cross = (u, from, to) => ease((u - from) / (to - from));

const SHOW = [
  {
    seconds: 20, progress: 0, entry: -54, lead: 52, pace: 35.5, climb: 4,
    routines: [
      {name: 'diagonal', height: 12, span: 232},
      {
        name: 'low-wave', height: 12.4, span: 246,
        lift: u => 3.8 * windowed(u, .05, .64) - 1.8 * windowed(u, .60, .96),
      },
      {
        name: 'sweeping-arc', height: 12.75, span: 264, sweep: [.12, .89],
        across: u => 11 * windowed(u, 0, .53) - 9 * windowed(u, .52, 1),
        lift: u => 2.7 * windowed(u, .28, .88),
      },
    ],
  },
  {
    seconds: 0, progress: .40, entry: -64, lead: 66, pace: 40.5, climb: 5,
    routines: [
      {
        name: 'double-s', height: 13.6, span: 282,
        across: u => 24 * wave(u, 1.35),
        lift: u => 4 * windowed(u, .24, .85),
      },
      {
        name: 'climb-and-dive', height: 14, span: 296, mirror: true, sweep: [.10, .88],
        across: u => 8 * windowed(u, .5, 1),
        lift: u => 10.5 * windowed(u, .09, .68) - 2.4 * windowed(u, .66, .99),
      },
      {
        name: 'wing-rock', height: 14.45, span: 310,
        across: u => 17 * wave(u, 1.1),
        lift: u => 5.5 * windowed(u, .2, .93),
        roll: u => .32 * wave(u, 2.25),
      },
    ],
  },
  {
    seconds: 0, progress: .80, entry: -70, lead: 72, pace: 43, climb: 6,
    routines: [
      {
        name: 'barrel-roll', height: 16, span: 324, fullRoll: true,
        across: u => 14 * windowed(u, .23, .76),
        lift: u => 8 * windowed(u, .19, .89),
        roll: u => TAU * cross(u, .17, .83),
      },
      {
        name: 'paired-wingovers', height: 16.5, span: 343, mirror: true, sweep: [.05, .92],
        across: u => 30 * wave(u, 1.6),
        lift: u => 7.5 * windowed(u, .08, .48) + 9 * windowed(u, .47, .94),
        roll: u => .5 * wave(u, 1.65),
      },
      {
        name: 'climbing-corkscrew', height: 17, span: 365, fullRoll: true,
        across: u => {
          const angle = TAU * cross(u, .18, .82);
          return 12 * Math.sin(angle) * windowed(u, .06, .97);
        },
        lift: u => {
          const angle = TAU * cross(u, .18, .82);
          return (3 + 6 * (1 - Math.cos(angle))) * windowed(u, .12, .96);
        },
        roll: u => -TAU * cross(u, .14, .86),
      },
    ],
  },
];

function nearbyGroup(active) {
  if (active.length < 2) return active.length ? [active] : [];
  const centre = active[Math.floor(active.length / 2)];
  const p = centre.rig.track.sample(centre.state.distance);
  const close = active.every(view => {
    const s = view.rig.track.sample(view.state.distance);
    return Math.hypot(s.x - p.x, s.z - p.z) < 110 && p.tx * s.tx + p.tz * s.tz > 0.8;
  });
  // Spread-out carts see the same routine along each local stretch.
  return close ? [active] : active.map(view => [view]);
}

// Integral of the smooth speed ramp, continuing at full speed afterwards.
function rampDistance(time, duration) {
  const u = clamp(time / duration, 0, 1);
  return duration * u ** 3 * (1 - u / 2) + Math.max(0, time - duration);
}

function timeForDistance(distanceAt, distance, minSpeed) {
  let low = 0, high = distance / minSpeed;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (distanceAt(mid) < distance) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function smoothClearance(points) {
  for (const direction of [-1, 1]) {
    for (let i = direction > 0 ? 1 : points.length - 2; i >= 0 && i < points.length; i += direction) {
      const a = points[i - direction], b = points[i];
      b.y = Math.max(b.y, a.y - MAX_GRADE * Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
  const heights = points.map(p => p.y);
  for (let i = 2; i < points.length - 2; i++) {
    const eased = (heights[i - 2] + 4 * heights[i - 1] + 6 * heights[i] + 4 * heights[i + 1] + heights[i + 2]) / 16;
    points[i].y = Math.max(points[i].y, eased);
  }
}

function* planPass(world, group, stage, routine, aircraftRadius) {
  const reference = group[Math.floor(group.length / 2)];
  const {track} = reference.rig, start = reference.state.distance;
  const p = track.sample(start);
  const laneOffsets = group.map(view => {
    const s = view.rig.track.sample(view.state.distance);
    return (s.x - p.x) * p.nx + (s.z - p.z) * p.nz;
  });
  const rightSide = Math.sign(laneOffsets.at(-1) - laneOffsets[0]) || -1;
  const ranked = laneOffsets.map(offset => offset * rightSide);
  const right = Math.max(21, ...ranked) + 11;
  const left = Math.min(-20, ...ranked) - 10;
  const acrossStart = routine.mirror ? left : right;
  const acrossEnd = routine.mirror ? right : left;
  const direction = routine.mirror ? -1 : 1;
  const fastest = Math.max(...group.map(view => view.state.speed));
  const pace = Math.max(stage.pace, fastest + 11);
  const sweepStart = stage.lead + Math.max(0, fastest - 18) * 3.8;
  const sweepEnd = sweepStart + Math.max(routine.span, (right - left) * 3.65);
  const end = sweepEnd + Math.max(470, Math.min(800, world.config.viewDistance * 1.04));
  const radius = aircraftRadius + 4;
  const footprint = {min: [-radius, 0, -radius], max: [radius, 0, radius]};
  const groundPoint = {x: 0, z: 0, yaw: 0};
  const points = [], exit = {}, frame = {}, before = {}, after = {};
  const [sweepFrom, sweepTo] = routine.sweep ?? [0, 1];

  function readTrack(distance, target) {
    track.sample(distance, target);
    if (world.route.lanes) {
      const extra = distance - clamp(distance, 0, track.length);
      target.x += target.tx * extra;
      target.z += target.tz * extra;
      target.y += target.ty * extra;
    }
  }

  function readFrame(along, target) {
    const distance = start + along;
    readTrack(distance, target);
    readTrack(distance - ENTRY_FRAME, before);
    readTrack(distance + ENTRY_FRAME, after);
    const dx = after.x - before.x, dz = after.z - before.z;
    const length = Math.hypot(dx, dz);
    target.tx = dx / length;
    target.tz = dz / length;
  }

  readFrame(sweepEnd, exit);
  function addPoint(along) {
    const extension = Math.max(0, along - sweepEnd);
    if (extension) Object.assign(frame, exit);
    else readFrame(along, frame);
    const u = clamp((along - sweepStart) / (sweepEnd - sweepStart), 0, 1);
    const across = rightSide * (lerp(acrossStart, acrossEnd, cross(u, sweepFrom, sweepTo))
      + direction * (routine.across?.(u) ?? 0));
    const x = frame.x + frame.tx * extension + frame.tz * across;
    const z = frame.z + frame.tz * extension - frame.tx * across;
    const lift = (routine.lift?.(u) ?? 0) + stage.climb * cross(along, sweepEnd, end);
    points.push({x, z, railHeight: frame.y, lift});
  }

  function segment(from, to) {
    const steps = Math.ceil((to - from) / 5.5);
    for (let i = 1; i <= steps; i++) addPoint(lerp(from, to, i / steps));
  }

  addPoint(stage.entry);
  segment(stage.entry, sweepStart);
  const beginIndex = points.length - 1;
  segment(sweepStart, sweepEnd);
  const endIndex = points.length - 1;
  segment(sweepEnd, end);

  const halfWindow = Math.floor(SMOOTHING.length / 2);
  const path = [];
  for (const [index, point] of points.entries()) {
    let {x, z} = point;
    const {railHeight, lift} = point;
    // Smooth the track chord and lane offsets before measuring flight clearance.
    if (index >= halfWindow && index < points.length - halfWindow) {
      x = 0; z = 0;
      for (const [i, weight] of SMOOTHING.entries()) {
        const point = points[index + i - halfWindow];
        x += point.x * weight / 256;
        z += point.z * weight / 256;
      }
    }
    groundPoint.x = x; groundPoint.z = z;
    const ground = world.groundHeight(x, z);
    const terrainTop = footprintMaximum(world.terrainGrid, groundPoint, footprint);
    const objectTop = world.airspace.obstacleTop(x, z, radius);
    const clearance = Math.max(terrainTop, objectTop) + aircraftRadius + 1.5;
    const preferredHeight = Math.max(ground, railHeight) + routine.height + lift;
    path.push(new THREE.Vector3(x, Math.max(clearance, preferredHeight), z));
    yield;
  }
  smoothClearance(path);

  const curve = new THREE.CatmullRomCurve3(path);
  curve.arcLengthDivisions = (points.length - 1) * ARC_SAMPLES;
  const lengths = curve.getLengths();
  const maneuverStart = lengths[beginIndex * ARC_SAMPLES];
  const maneuverEnd = lengths[endIndex * ARC_SAMPLES];
  const length = lengths.at(-1);
  const approachDistance = time => APPROACH_SPEED * time + (pace - APPROACH_SPEED) * rampDistance(time - APPROACH_HOLD, APPROACH_RAMP);
  const exitDistance = time => pace * time + (EXIT_SPEED - pace) * rampDistance(time, EXIT_RAMP);
  const accelerateAt = timeForDistance(approachDistance, maneuverEnd, APPROACH_SPEED);
  const duration = accelerateAt + timeForDistance(exitDistance, length - maneuverEnd, pace);
  return {curve, length, approachDistance, exitDistance, maneuverStart, maneuverEnd, accelerateAt, duration, pace, routine, rightSide};
}

function makePose() {
  return {position: new THREE.Vector3(), rotation: new THREE.Quaternion(), yaw: 0, fade: 1};
}

class BiplanePass {
  constructor(world) {
    const {root, bounds} = world.store.get(BIPLANE_ASSET);
    this.world = world;
    this.model = root.clone(true);
    this.radius = Math.hypot(...bounds.max.toArray().map((v, axis) => Math.max(Math.abs(v), Math.abs(bounds.min.getComponent(axis)))));
    this.model.name = 'AirshowBiplane';
    this.model.updateMatrixWorld(true);
    this.propeller = this.model.getObjectByName('Propeller');
    const tips = ['SmokePort', 'SmokeStarboard'].map(name =>
      this.model.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
    this.smoke = new AirshowSmoke(world, tips);
    this.shadow = world.config.planeShadow ? new AircraftShadow(world, 10.6, 8.7, 'plane') : null;
    this.materials = new Map();
    this.model.traverse(node => {
      if (!node.isMesh) return;
      node.receiveShadow = false;
      if (!this.materials.has(node.material)) {
        const material = node.material.clone();
        material.transparent = true;
        this.materials.set(node.material, material);
        world.ownedMaterials.push(material);
      }
      node.material = this.materials.get(node.material);
    });
    world.group.add(this.model);
    this.model.visible = false;
    this.pose = makePose();
    this.trailPose = makePose();
    this.before = new THREE.Vector3();
    this.after = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.sampleTrail = time => this.sample(time, this.trailPose);
  }

  *prepare(world, group, stage, routine) {
    this.plan = yield* planPass(world, group, stage, routine, this.radius);
    this.bankHistory = yield* this.buildBankHistory();
  }

  start(group, seconds) {
    this.preparing = false;
    this.startsAt = seconds;
    this.endsAt = seconds + this.plan.duration + SMOKE_LIFETIME;
    const mask = group.reduce((layers, view) => layers | (view.camera.layers.mask & ~1), 0);
    this.model.traverse(node => { node.layers.mask = mask; });
    this.smoke.mesh.layers.mask = mask;
    if (this.shadow) this.shadow.mesh.layers.mask = mask;
  }

  distanceAt(time) {
    const {length, accelerateAt, approachDistance, exitDistance} = this.plan;
    return Math.min(length, approachDistance(Math.min(time, accelerateAt)) + exitDistance(Math.max(0, time - accelerateAt)));
  }

  readHeading(distance, position) {
    const {curve, length} = this.plan;
    curve.getPointAt(distance / length, position);
    const start = Math.max(0, distance - HEADING_LOOKAHEAD);
    const end = Math.min(length, distance + HEADING_LOOKAHEAD);
    curve.getPointAt(start / length, this.before);
    curve.getPointAt(end / length, this.after);
    const rift = this.world.rift;
    if (rift?.active) {
      for (const point of [position, this.before, this.after]) {
        point.y = rift.clearance(point.x, point.y, point.z, this.radius + 2);
      }
    }
    return end - start;
  }

  *buildBankHistory() {
    const {duration, pace, accelerateAt, length} = this.plan;
    const values = new Float32Array(Math.ceil(duration / BANK_STEP) + 1);
    const position = new THREE.Vector3();
    const limit = BANK_STEP * BANK_RATE;
    for (let i = 1; i < values.length; i++) {
      const time = Math.min(duration, i * BANK_STEP);
      const distance = this.distanceAt(time);
      const width = this.readHeading(distance, position);
      const ax = position.x - this.before.x, az = position.z - this.before.z;
      const bx = this.after.x - position.x, bz = this.after.z - position.z;
      const turn = Math.atan2(az * bx - ax * bz, ax * bx + az * bz);
      const speed = APPROACH_SPEED
        + (pace - APPROACH_SPEED) * smoothstep(0, APPROACH_RAMP, time - APPROACH_HOLD)
        + (EXIT_SPEED - pace) * smoothstep(0, EXIT_RAMP, time - accelerateAt);
      const strength = smoothstep(0, 23, Math.min(distance, length - distance));
      const desired = -0.85 * Math.tanh(2 * speed ** 2 * turn / (0.85 * GRAVITY * width)) * strength;
      // Rate-limit banking to avoid abrupt rolls at changes in path curvature.
      values[i] = values[i - 1] + clamp((desired - values[i - 1]) * .55, -limit, limit);
      if (i % 8 === 0) yield;
    }
    return values;
  }

  sample(time, pose) {
    const {length, maneuverStart, maneuverEnd, routine, rightSide} = this.plan;
    const distance = this.distanceAt(time);
    this.readHeading(distance, pose.position);
    const dx = this.after.x - this.before.x, dz = this.after.z - this.before.z;
    const index = Math.min(this.bankHistory.length - 2, Math.floor(time / BANK_STEP));
    const bank = lerp(this.bankHistory[index], this.bankHistory[index + 1], clamp(time / BANK_STEP - index, 0, 1));
    const phase = clamp((distance - maneuverStart) / (maneuverEnd - maneuverStart), 0, 1);
    const steady = routine.fullRoll ? 1 - .7 * windowed(phase, .08, .92) : 1;
    const roll = bank * steady + rightSide * (routine.roll?.(phase) ?? 0);
    const pitch = -Math.atan2(this.after.y - this.before.y, Math.hypot(dx, dz));
    pose.yaw = Math.atan2(dx, dz);
    pose.rotation.setFromEuler(this.euler.set(pitch, pose.yaw, roll));
    pose.fade = 1 - smoothstep(0.88, 1, distance / length);
    return pose;
  }

  clear() {
    this.preparing = false;
    this.plan = null;
    this.model.visible = false;
    this.shadow?.hide();
    this.smoke.clear();
  }

  update(world, seconds, viewportHeight) {
    if (this.preparing || !this.plan) return;
    if (seconds >= this.endsAt) {
      this.clear();
      return;
    }
    const time = seconds - this.startsAt;
    const {duration} = this.plan;
    this.model.visible = time < duration;
    this.shadow?.hide();
    if (this.model.visible) {
      const pose = this.sample(time, this.pose);
      this.model.position.copy(pose.position);
      this.model.quaternion.copy(pose.rotation);
      this.propeller.rotation.z = time * 48;
      for (const material of this.materials.values()) material.opacity = pose.fade;
      this.shadow?.update(world, pose.position, pose.yaw, pose.fade);
    }
    this.smoke.update(time, duration, viewportHeight, this.sampleTrail);
  }
}

export class Airshow {
  constructor(world, random = Math.random) {
    this.world = world;
    this.random = random;
    this.flights = world.carts.map(() => new BiplanePass(world));
    this.reset();
  }

  reset() {
    this.next = 0;
    this.pending = [];
    this.routines = SHOW.map(({routines}) => routines[Math.floor(this.random() * routines.length)]);
    for (const flight of this.flights) flight.clear();
  }

  updateRace(views, seconds) {
    const stage = SHOW[this.next];
    if (!stage || seconds + 1e-8 < stage.seconds) return;
    if (!views.some(({quiz, rig}) => quiz.distance >= rig.raceLength * stage.progress)) return;
    const routine = this.routines[this.next++];
    const active = views.filter(view => view.quiz.finished === null && !this.world.rift?.inside(view));
    for (const group of nearbyGroup(active)) {
      let flight = this.flights.find(candidate => !candidate.preparing && (!candidate.plan || seconds >= candidate.endsAt));
      if (!flight) {
        flight = new BiplanePass(this.world);
        this.flights.push(flight);
      }
      flight.clear();
      flight.preparing = true;
      this.pending.push({flight, group, steps: flight.prepare(this.world, group, stage, routine)});
    }
  }

  draw(seconds, viewportHeight) {
    const until = performance.now() + PLANNING_BUDGET_MS;
    while (this.pending.length && performance.now() < until) {
      const {flight, group, steps} = this.pending[0];
      if (!steps.next().done) continue;
      this.pending.shift();
      const visibleTo = group.filter(view => view.quiz.finished === null && !this.world.rift?.inside(view));
      if (visibleTo.length) flight.start(visibleTo, seconds);
      else flight.clear();
    }
    for (const flight of this.flights) flight.update(this.world, seconds, viewportHeight);
  }
}
