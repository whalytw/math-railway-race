import * as THREE from 'three';
import {clamp, lerp, smoothstep} from './core.js?v=13.0.0';
import {AircraftShadow} from './aircraft-shadow.js?v=21';
import {AirshowSmoke} from './airshow-smoke.js?v=21';

export const BIPLANE_ASSET = 'AirshowBiplane';
const OPENING_TIME = 20;
const FINAL_PASS_PROGRESS = 0.75;
const APPROACH_SPEED = 110 / 3.6;
const EXIT_ACCELERATION = 4.6;
const ACCELERATION_TIME = 8;
const GRAVITY = 9.81;
const MAX_GRADE = 0.15;

function nearbyGroup(active) {
  if (active.length < 2) return [active];
  const centre = active[Math.floor(active.length / 2)];
  const p = centre.rig.track.sample(centre.state.distance);
  const close = active.every(view => {
    const s = view.rig.track.sample(view.state.distance);
    return Math.hypot(s.x - p.x, s.z - p.z) < 110 && p.tx * s.tx + p.tz * s.tz > 0.8;
  });
  // A spread-out field sees the same choreography along each local stretch.
  return close ? [active] : active.map(view => [view]);
}

function planPass(world, group, finalPass) {
  const reference = group[Math.floor(group.length / 2)];
  const {track} = reference.rig;
  const start = reference.state.distance;
  const p = track.sample(start);
  const laneOffsets = group.map(view => {
    const s = view.rig.track.sample(view.state.distance);
    return (s.x - p.x) * p.nx + (s.z - p.z) * p.nz;
  });
  // Use the rightmost and leftmost player columns when the rails run together.
  const rightSide = Math.sign(laneOffsets.at(-1) - laneOffsets[0]) || -1;
  const rankedOffsets = laneOffsets.map(offset => offset * rightSide);
  const right = Math.max(22, ...rankedOffsets) + (finalPass ? 17 : 12);
  const left = Math.min(-20, ...rankedOffsets) - (finalPass ? 7 : 9);
  const begin = finalPass ? -76 : -62;
  const sweepStart = finalPass ? 55 : 76;
  const sweepEnd = sweepStart + Math.max(finalPass ? 295 : 270, (right - left) * 4.1);
  const end = sweepEnd + Math.max(500, Math.min(800, world.config.viewDistance * 1.15));
  const clearance = finalPass ? 20 : 15;
  const station = track.sample(start + sweepEnd);
  const points = [];
  const sample = {};
  function addPoint(along) {
    const d = start + Math.min(along, sweepEnd);
    track.sample(d, sample);
    const {nx, nz, x, y, z} = sample;
    const extra = world.route.lanes ? d - clamp(d, 0, track.length) : 0;
    const extension = Math.max(along - sweepEnd, 0);
    const u = clamp((along - sweepStart) / (sweepEnd - sweepStart), 0, 1);
    const easing = u ** 3 * (10 + u * (-15 + 6 * u));
    const across = rightSide * lerp(right, left, easing);
    const px = x + sample.tx * extra + station.tx * extension + nx * across;
    const pz = z + sample.tz * extra + station.tz * extension + nz * across;
    const ground = Math.max(
      world.groundHeight(px, pz),
      world.groundHeight(px + nx * 5, pz + nz * 5),
      world.groundHeight(px - nx * 5, pz - nz * 5),
    );
    const climbing = 5 * smoothstep(sweepEnd, end, along);
    points.push(new THREE.Vector3(px, Math.max(y, ground) + clearance + climbing, pz));
  }
  function segment(from, to) {
    const steps = Math.ceil((to - from) / 9);
    for (let i = 1; i <= steps; i++) addPoint(lerp(from, to, i / steps));
  }
  addPoint(begin);
  segment(begin, sweepEnd);
  const endSweepIndex = points.length - 1;
  segment(sweepEnd, end);

  // A slope-limited clearance envelope lets the aircraft climb before hills.
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i], b = points[i + 1];
    a.y = Math.max(a.y, b.y - MAX_GRADE * Math.hypot(a.x - b.x, a.z - b.z));
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    b.y = Math.max(b.y, a.y - MAX_GRADE * Math.hypot(a.x - b.x, a.z - b.z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  curve.arcLengthDivisions = (points.length - 1) * 12;
  const lengths = curve.getLengths();
  const sweepDistance = lengths[endSweepIndex * 12];
  const length = lengths.at(-1);
  const accelerateAt = sweepDistance / APPROACH_SPEED;
  const accelerationDistance = APPROACH_SPEED * ACCELERATION_TIME
    + 0.5 * EXIT_ACCELERATION * ACCELERATION_TIME ** 2;
  const remaining = length - sweepDistance;
  const exitSpeed = APPROACH_SPEED + EXIT_ACCELERATION * ACCELERATION_TIME;
  const after = remaining <= accelerationDistance
    ? (Math.sqrt(APPROACH_SPEED ** 2 + 2 * EXIT_ACCELERATION * remaining) - APPROACH_SPEED) / EXIT_ACCELERATION
    : ACCELERATION_TIME + (remaining - accelerationDistance) / exitSpeed;
  return {curve, length, accelerateAt, duration: accelerateAt + after};
}

function makePose() {
  return {position: new THREE.Vector3(), rotation: new THREE.Quaternion(), yaw: 0, fade: 1};
}

class BiplanePass {
  constructor(world) {
    this.model = world.store.get(BIPLANE_ASSET).root.clone(true);
    this.model.name = 'AirshowBiplane';
    this.model.updateMatrixWorld(true);
    this.propeller = this.model.getObjectByName('Propeller');
    const tips = ['SmokePort', 'SmokeStarboard'].map(name =>
      this.model.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
    this.smoke = new AirshowSmoke(world, tips);
    this.shadow = world.config.planeShadow ? new AircraftShadow(world, 10.6, 8.7, true) : null;
    this.materials = new Map();
    this.model.traverse(node => {
      if (!node.isMesh) return;
      node.receiveShadow = false;
      if (!this.materials.has(node.material)) {
        const material = node.material.clone();
        this.materials.set(node.material, material);
        world.ownedMaterials.push(material);
      }
      node.material = this.materials.get(node.material);
    });
    world.group.add(this.model);
    this.model.visible = false;
    this.pose = makePose();
    this.trailPose = makePose();
    this.tangent = new THREE.Vector3();
    this.tangentBefore = new THREE.Vector3();
    this.tangentAfter = new THREE.Vector3();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.sampleTrail = time => this.sample(time, this.trailPose);
  }

  start(world, group, seconds, finalPass) {
    this.plan = planPass(world, group, finalPass);
    this.startsAt = seconds;
    this.smoke.clear();
    const mask = group.reduce((layers, view) => layers | (view.camera.layers.mask & ~1), 0);
    this.model.traverse(node => { node.layers.mask = mask; });
    this.smoke.mesh.layers.mask = mask;
    if (this.shadow) this.shadow.mesh.layers.mask = mask;
  }

  sample(time, pose) {
    const {curve, length, accelerateAt} = this.plan;
    const powered = Math.max(0, time - accelerateAt);
    const acceleration = Math.min(ACCELERATION_TIME, powered);
    const speed = APPROACH_SPEED + EXIT_ACCELERATION * acceleration;
    const distance = Math.min(length, APPROACH_SPEED * time
      + EXIT_ACCELERATION * acceleration * (powered - 0.5 * acceleration));
    const u = distance / length;
    curve.getPointAt(u, pose.position);
    const forward = curve.getTangentAt(u, this.tangent);
    const oldDistance = Math.max(0, distance - 9);
    const newDistance = Math.min(length, distance + 9);
    const before = curve.getTangentAt(oldDistance / length, this.tangentBefore);
    const after = curve.getTangentAt(newDistance / length, this.tangentAfter);
    const angle = Math.atan2(before.z * after.x - before.x * after.z, before.x * after.x + before.z * after.z);
    const curvature = angle / Math.max(1, newDistance - oldDistance);
    const roll = clamp(-Math.atan(speed ** 2 * curvature / GRAVITY), -0.80, 0.80);
    const pitch = -Math.atan2(forward.y, Math.hypot(forward.x, forward.z));
    pose.yaw = Math.atan2(forward.x, forward.z);
    pose.rotation.setFromEuler(this.euler.set(pitch, pose.yaw, roll));
    pose.fade = 1 - smoothstep(0.88, 1, u);
    return pose;
  }

  clear() {
    this.plan = null;
    this.model.visible = false;
    this.shadow?.hide();
    this.smoke.clear();
  }

  update(world, seconds, viewportHeight) {
    if (!this.plan) return;
    const time = seconds - this.startsAt;
    const {duration} = this.plan;
    this.model.visible = time < duration;
    this.shadow?.hide();
    if (this.model.visible) {
      const pose = this.sample(time, this.pose);
      this.model.position.copy(pose.position);
      this.model.quaternion.copy(pose.rotation);
      this.propeller.rotation.z = time * 48;
      for (const material of this.materials.values()) {
        const transparent = pose.fade < 1;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = pose.fade;
      }
      this.shadow?.update(world, pose.position, pose.yaw, pose.fade);
    }
    this.smoke.update(time, duration, viewportHeight, this.sampleTrail);
  }
}

export class Airshow {
  constructor(world) {
    this.world = world;
    this.flights = [];
    this.openingPlayed = false;
    this.finishPassPlayed = false;
  }

  updateRace(views, seconds) {
    if (!this.openingPlayed && seconds + 1e-8 >= OPENING_TIME) {
      this.openingPlayed = true;
      this.start(views, seconds, false);
    }
    if (!this.finishPassPlayed && views.some(({quiz, rig}) => quiz.distance >= rig.raceLength * FINAL_PASS_PROGRESS)) {
      this.finishPassPlayed = true;
      this.start(views, seconds, true);
    }
  }

  start(views, seconds, finalPass) {
    const groups = nearbyGroup(views);
    for (const flight of this.flights) flight.clear();
    for (const [i, group] of groups.entries()) {
      const flight = this.flights[i] ??= new BiplanePass(this.world);
      flight.start(this.world, group, seconds, finalPass);
    }
  }

  draw(seconds, viewportHeight) {
    for (const flight of this.flights) flight.update(this.world, seconds, viewportHeight);
  }

  clear() {
    for (const flight of this.flights) flight.clear();
  }
}
