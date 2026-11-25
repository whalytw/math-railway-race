import {groundMaximum} from './grounding.js?v=24';
import {flightElevations, flightSample} from './flight-clearance.js?v=30';
import {AircraftShadow} from './aircraft-shadow.js?v=24';
import * as THREE from 'three';
import {clamp, lerp, randomGenerator, smoothstep} from './core.js?v=13.0.0';

export const CAMERA_DRONE_ASSET = 'CameraDrone';
const START_FOLLOW = 8;
const FALL_BACK = 3.2;
const APPROACH = 3.2;
const FILM = 10;
const FLY_AHEAD = 7;
const VISIT_LENGTH = APPROACH + FILM + FLY_AHEAD;
const FOLLOW_BEHIND = -4.6;
const FOLLOW_HEIGHT = 4.3;
const SCALE = 2.45;
const SAMPLE_DISTANCE = 8;

export class CameraDrone {
  constructor(world, index, camera) {
    const asset = world.store.get(CAMERA_DRONE_ASSET);
    this.root = asset.root.clone(true);
    // A sphere around the model covers tilted rotors and the camera gimbal.
    const bounds = asset.bounds;
    this.radius = SCALE * Math.hypot(
      Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
      Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)),
      Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
    this.flightPlans = new Map();
    this.root.name = 'CameraDrone_' + (index + 1);
    this.root.scale.setScalar(SCALE);
    this.root.rotation.order = 'YXZ';
    this.root.visible = false;
    this.rotors = ['Rotor_1', 'Rotor_2', 'Rotor_3', 'Rotor_4'].map(name => this.root.getObjectByName(name));
    this.gimbal = this.root.getObjectByName('Camera_gimbal');
    this.gimbal.rotation.order = 'YXZ';
    // Each split-screen camera sees its assigned drone on a separate layer.
    const layer = index + 1;
    this.root.traverse(node => {
      node.layers.set(layer);
      if (node.isMesh) node.receiveShadow = false;
    });
    camera.layers.enable(layer);
    world.group.add(this.root);
    this.shadow = world.config.droneShadow ? new AircraftShadow(world, 2.10, 1.90) : null;
    this.shadow?.mesh.layers.set(layer);

    this.random = randomGenerator(world.config.seed + ':camera-drone:' + index);
    this.startSide = index === 0 ? 1 : -1;
    this.exitLead = Math.min(340, world.config.viewDistance - 28);
    this.trackFrame = {};
    this.reset();
  }

  reset() {
    this.visitAt = 0;
    this.scheduleVisit();
  }

  scheduleVisit() {
    this.visitAt += 45 + 15 * this.random();
    this.visitSide = (this.random() < 0.5 ? -1 : 1) * (4.0 + this.random() * 0.8);
  }

  prepare(world, rig) {
    const hasRift = world.rift?.draw.result === true;
    this.flightPlan = this.flightPlans.get(hasRift);
    if (this.flightPlan) return;

    const first = rig.departure - 260;
    const end = rig.departure + rig.raceLength + this.exitLead + 180;
    const floors = new Float64Array(Math.ceil((end - first) / SAMPLE_DISTANCE) + 1);
    const radius = this.radius + 7.5 + SAMPLE_DISTANCE * .65;
    for (let i = 0; i < floors.length; i++) {
      const {flightX: x, flightY: y, flightZ: z} =
        this.flightPoint(world, rig, first + i * SAMPLE_DISTANCE, 0, this.trackFrame);
      const terrain = groundMaximum(world.terrainGrid, x, z, radius);
      const top = world.airspace.obstacleTop(x, z, radius, terrain);
      const floor = Math.max(y + FOLLOW_HEIGHT, top + this.radius + 1.5);
      floors[i] = hasRift ? world.rift.clearance(x, floor, z, radius) : floor;
    }
    const heights = flightElevations(floors, .26, .21, SAMPLE_DISTANCE);
    this.flightPlan = {first, heights};
    this.flightPlans.set(hasRift, this.flightPlan);
  }

  flightPoint(world, rig, distance, across, frame) {
    rig.track.sample(distance, frame);
    const padding = world.route.lanes ? distance - clamp(distance, 0, rig.track.length) : 0;
    frame.flightX = frame.x + frame.tx3 * padding + frame.nx * across;
    frame.flightY = frame.y + frame.ty * padding;
    frame.flightZ = frame.z + frame.tz3 * padding + frame.nz * across;
    return frame;
  }

  update(world, view) {
    const {quiz, rig, motion, state} = view;
    this.root.visible = false;
    this.shadow?.hide();
    if (quiz.finished !== null || view.riftTrack) return;

    const time = quiz.clock;
    while (time >= this.visitAt + VISIT_LENGTH) this.scheduleVisit();
    const visitTime = time - this.visitAt;
    const opening = time < START_FOLLOW + FALL_BACK;
    if (!opening && visitTime < 0) return;

    let along = FOLLOW_BEHIND;
    let across = opening ? this.startSide * 4.35 : this.visitSide;
    let altitude = FOLLOW_HEIGHT, pitch = 0.04, aim = 1;
    const side = Math.sign(across);
    if (opening) {
      const drop = clamp((time - START_FOLLOW) / FALL_BACK, 0, 1);
      along = lerp(along, -29, drop ** 2);
      across += side * drop * 1.8;
      altitude += drop * 0.5;
      pitch -= drop * 0.18;
    } else if (visitTime < APPROACH) {
      const t = visitTime / APPROACH;
      along = lerp(-52, along, 1 - (1 - t) ** 2);
      across += side * (1 - t) ** 2 * 1.6;
      altitude += (1 - t) * 0.8;
      pitch += (1 - t) * 0.17;
    } else if (visitTime >= APPROACH + FILM) {
      const t = (visitTime - APPROACH - FILM) / FLY_AHEAD;
      // Gain relative speed from zero before departing toward the horizon.
      const run = t ** 2 * (1.85 - 0.85 * t);
      along = lerp(along, this.exitLead, run);
      across += side * t * 1.8;
      altitude += 7 * run;
      pitch += 0.20 * Math.sin(Math.PI * t);
      aim = 1 - smoothstep(0, 0.32, t);
    }
    across += Math.sin(time * 1.52) * 0.23;
    altitude += Math.sin(time * 2.2) * 0.16;

    const distance = motion.distance + along;
    const p = this.flightPoint(world, rig, distance, across, this.trackFrame);
    const {flightX: x, flightZ: z} = p;
    const {first, heights} = this.flightPlan;
    const sample = (distance - first) / SAMPLE_DISTANCE;
    const height = flightSample(heights, sample);
    const grade = (flightSample(heights, sample + .4) - flightSample(heights, sample - .4)) / (.8 * SAMPLE_DISTANCE);
    this.root.position.set(x, height + altitude - FOLLOW_HEIGHT, z);
    this.root.rotation.set(pitch - .68 * Math.atan(grade), p.yaw, Math.sin(time * 1.52) * .075);
    const cart = rig.root.position;
    const dx = cart.x - x, dz = cart.z - z;
    const targetYaw = Math.atan2(dx, dz) - p.yaw;
    this.gimbal.rotation.y = clamp(Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw)), -1.2, 1.2) * aim;
    this.gimbal.rotation.x = (Math.atan2(this.root.position.y - cart.y - 1.4, Math.hypot(dx, dz)) - pitch) * aim;
    for (const [i, rotor] of this.rotors.entries()) {
      rotor.rotation.y = state.elapsed * (i % 2 ? -51 : 51) + i * 0.8;
    }
    this.root.visible = true;
    this.shadow?.update(world, this.root.position, p.yaw);
  }
}
