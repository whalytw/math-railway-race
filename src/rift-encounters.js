import * as THREE from 'three';
import {clamp, lerp, smoothstep} from './core.js?v=13.0.0';

const MAX_SHIPS = 6;
const TRAIL_STEPS = 22;
const TRAIL_SPACING = .112;
const FLIGHT_SECONDS = 7.6;
const FORMATION = [[0, 0, 0], [-5.4, -.7, -6.5], [5.4, .8, -6.5], [-10.6, -1.8, -12], [10.6, .8, -12], [0, 2.2, -17]];
const TRAIL_COLOURS = ['#69dcff', '#a8faff', '#ffbf87', '#dfacff'];
const UP = new THREE.Vector3(0, 1, 0);
const PROBE_RADIUS = 14.5;
const PROBE_SHIFT_SECONDS = .12;

function fleetPose(camera, side, t, position) {
  const depth = 32 + 37 * t + 94 * t * t;
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth;
  const across = side * lerp(1.52, -1.28, smoothstep(.05, .87, t));
  const height = .37 + .19 * Math.sin(Math.PI * t) + .20 * t * t;
  return position.set(across * halfHeight * camera.aspect, height * halfHeight, -depth)
    .applyQuaternion(camera.quaternion).add(camera.position);
}

export function vesselInstances(parent, source, count, own) {
  source.root.updateMatrixWorld(true);
  const trim = new THREE.Matrix4().makeScale(1 / source.span, 1 / source.span, 1 / source.span)
    .multiply(new THREE.Matrix4().makeTranslation(-source.centre.x, -source.centre.y, -source.centre.z));
  const parts = [];
  source.root.traverse(node => {
    if (!node.isMesh) return;
    const geometry = own(node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(trim, node.matrixWorld)));
    const mesh = own(new THREE.InstancedMesh(geometry, node.material, count));
    parts.push(mesh);
    parent.add(mesh);
  });
  return parts;
}

export class FlightFormation {
  constructor(parent, source, bounds, layer, own) {
    this.group = new THREE.Group();
    this.group.name = 'RiftFormation' + layer;
    this.group.layers.set(layer);
    this.group.visible = false;
    parent.add(this.group);
    this.parts = vesselInstances(this.group, source, MAX_SHIPS, own);
    for (const mesh of this.parts) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.layers.set(layer);
    }

    const points = MAX_SHIPS * TRAIL_STEPS * 2;
    const trails = own(new THREE.BufferGeometry());
    this.vertices = new THREE.BufferAttribute(new Float32Array(points * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colours = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
    trails.setAttribute('position', this.vertices);
    trails.setAttribute('color', this.colours);
    const material = own(new THREE.LineBasicMaterial({vertexColors: true, transparent: true, opacity: .83,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false}));
    this.trails = new THREE.LineSegments(trails, material);
    this.trails.layers.set(layer);
    this.trails.frustumCulled = false;
    this.group.add(this.trails);
    this.pose = new THREE.Object3D();
    this.point = new THREE.Vector3();
    this.next = new THREE.Vector3();
    this.history = Array.from({length: TRAIL_STEPS + 2}, () => ({position: new THREE.Vector3(),
      forward: new THREE.Vector3(), right: new THREE.Vector3()}));
    this.sample = {position: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3()};
    this.head = 0;
    this.tint = new THREE.Color();
    const cart = bounds.getSize(this.point);
    const {x, y, z} = source.size;
    const normalizedVolume = x * y * z / source.span ** 3;
    this.size = clamp(Math.cbrt(10 * cart.x * cart.y * cart.z / normalizedVolume), 5.7, 9.2);
  }

  reset(plan) {
    this.group.visible = false;
    this.plan = plan;
    this.started = null;
    this.lastTrailAt = null;
    this.head = 0;
    if (!plan) return;
    for (const mesh of this.parts) mesh.count = plan.count;
    const colour = this.tint.set(TRAIL_COLOURS[Math.floor(plan.colour * TRAIL_COLOURS.length)]);
    let vertex = 0;
    for (let ship = 0; ship < plan.count; ship++) {
      for (let i = 0; i < TRAIL_STEPS; i++) {
        for (const end of [0, 1]) {
          const weight = .94 * (1 - (i + end) / TRAIL_STEPS) ** 1.27;
          this.colours.setXYZ(vertex++, colour.r * weight, colour.g * weight, colour.b * weight);
        }
      }
    }
    this.colours.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, vertex);
  }

  update(view, seconds) {
    this.group.visible = false;
    const {plan} = this, track = view.riftTrack;
    if (!plan || !track) return;
    if (view.motion.distance < track.start + track.length * plan.start) return;
    this.started ??= seconds;
    const elapsed = seconds - this.started;
    if (elapsed >= FLIGHT_SECONDS) {
      this.group.visible = elapsed < FLIGHT_SECONDS + TRAIL_STEPS * TRAIL_SPACING;
      for (const part of this.parts) part.visible = false;
      if (!this.group.visible) return;
    } else this.group.visible = true;
    const {position, forward, right} = this.sample;
    const t = Math.min(1, elapsed / FLIGHT_SECONDS);
    fleetPose(view.camera, plan.side, t, position);
    fleetPose(view.camera, plan.side, t + .003, forward).sub(position).normalize();
    right.crossVectors(UP, forward).normalize();
    // The flyby stays readable through rail turns while its sampled trail
    // remains in world space and drifts naturally relative to the camera.
    if (this.lastTrailAt === null) {
      for (const sample of this.history) {
        sample.position.copy(position); sample.forward.copy(forward); sample.right.copy(right);
      }
      this.lastTrailAt = seconds;
    } else if (elapsed < FLIGHT_SECONDS && seconds - this.lastTrailAt >= TRAIL_SPACING) {
      this.head = (this.head + 1) % this.history.length;
      const sample = this.history[this.head];
      sample.position.copy(position); sample.forward.copy(forward); sample.right.copy(right);
      this.lastTrailAt = seconds;
    }
    const fading = clamp(1 - (elapsed - FLIGHT_SECONDS) / (TRAIL_STEPS * TRAIL_SPACING), 0, 1);
    this.trails.material.opacity = .83 * fading;
    const {pose, point, next} = this;
    let vertex = 0;
    for (let i = 0; i < plan.count; i++) {
      const [across, y, back] = FORMATION[i];
      if (elapsed < FLIGHT_SECONDS) {
        pose.position.copy(position).addScaledVector(right, across).addScaledVector(forward, back);
        pose.position.y += y;
        pose.lookAt(next.copy(pose.position).add(forward));
        pose.rotateZ(.16 * Math.sin(elapsed * 1.57 + i * .24) * plan.side);
        pose.scale.setScalar(this.size);
        pose.updateMatrix();
        for (const part of this.parts) {
          part.visible = true;
          part.setMatrixAt(i, pose.matrix);
        }
      }
      for (let k = 0; k < TRAIL_STEPS; k++) {
        for (const end of [0, 1]) {
          const offset = k + end;
          const past = offset === 0 && elapsed < FLIGHT_SECONDS ? this.sample
            : this.history[(this.head - Math.max(0, offset - 1) + this.history.length) % this.history.length];
          point.copy(past.position).addScaledVector(past.right, across).addScaledVector(past.forward, back - this.size * .51);
          this.vertices.setXYZ(vertex++, point.x, point.y + y, point.z);
        }
      }
    }
    if (elapsed < FLIGHT_SECONDS) for (const part of this.parts) part.instanceMatrix.needsUpdate = true;
    this.vertices.needsUpdate = true;
  }
}

export class ReconnaissanceProbe {
  constructor(parent, models, layer) {
    this.root = new THREE.Group();
    this.root.name = 'RiftScout' + layer;
    parent.add(this.root);
    this.models = models;
    for (const model of models) if (model) this.root.add(model);
    this.root.traverse(node => node.layers.set(layer));
    this.offset = new THREE.Vector3();
  }

  reset(plan) {
    this.plan = plan;
    this.started = null;
    this.root.visible = false;
    for (const [i, model] of this.models.entries()) if (model) model.visible = Boolean(plan && plan.shape === i);
  }

  update(view, seconds, reducedMotion) {
    const {plan, root} = this, track = view.riftTrack;
    root.visible = false;
    if (!plan || !track || !this.models[plan.shape] || view.motion.distance < track.start + plan.start * track.length) return;
    this.started ??= seconds;
    const age = seconds - this.started;
    if (age >= plan.duration) return;

    const margin = Math.min(.95, plan.duration * .10);
    const encounter = smoothstep(0, margin, age) * (1 - smoothstep(plan.duration - margin, plan.duration, age));
    const {waypoints} = plan;
    const index = waypoints.findLastIndex(point => point.time <= age);
    const to = waypoints[index], from = waypoints[Math.max(0, index - 1)];
    const shift = smoothstep(0, reducedMotion ? .42 : PROBE_SHIFT_SECONDS, age - to.time);
    const azimuth = lerp(from.azimuth, to.azimuth, shift);
    const elevation = lerp(from.elevation, to.elevation, shift);
    const horizontal = PROBE_RADIUS * Math.cos(elevation);
    const {sample, root: cart} = view.rig;

    // Fixed angles in the cart's heading frame keep the probe level and at a
    // constant radius as the cart accelerates, climbs or banks.
    this.offset.set(Math.sin(azimuth) * horizontal, Math.sin(elevation) * PROBE_RADIUS,
      Math.cos(azimuth) * horizontal).applyAxisAngle(UP, sample.yaw);
    root.position.copy(cart.position).add(this.offset);
    root.rotation.set(.12, sample.yaw + azimuth, 0, 'YXZ');
    root.scale.setScalar(Math.max(.02, encounter));
    root.visible = true;
  }
}
