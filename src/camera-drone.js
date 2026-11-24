import {footprintMaximum} from './grounding.js?v=24';
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
const LOOK_AHEAD = [5, 12, 22, 36, 53];

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
    this.footprint = {min: [-this.radius, 0, -this.radius], max: [this.radius, 0, this.radius]};
    this.groundPoint = {x: 0, z: 0, yaw: 0};
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
    this.lookFrame = {};
    this.reset();
  }

  reset() {
    this.visitAt = 0;
    this.lastFlightTime = null;
    this.scheduleVisit();
  }

  scheduleVisit() {
    this.visitAt += 45 + 15 * this.random();
    this.visitSide = (this.random() < 0.5 ? -1 : 1) * (4.0 + this.random() * 0.8);
  }

  altitudeAt(world, x, z, exact = false) {
    const radius = this.radius;
    const point = this.groundPoint;
    point.x = x; point.z = z;
    const centre = world.groundHeight(x, z);
    const ground = exact && world.terrainGrid
      ? Math.max(centre, footprintMaximum(world.terrainGrid, point, this.footprint))
      : Math.max(centre, world.groundHeight(x + radius, z), world.groundHeight(x - radius, z),
        world.groundHeight(x, z + radius), world.groundHeight(x, z - radius));
    // The indexed obstacle tops include tunnel portals, trees and structures.
    return (world.airspace?.obstacleTop(x, z, radius, ground, exact ? 2.4 : 4.5) ?? ground) + radius + 1.25;
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
    if (quiz.finished !== null || view.riftTrack) { this.lastFlightTime = null; return; }

    const time = quiz.clock;
    while (time >= this.visitAt + VISIT_LENGTH) this.scheduleVisit();
    const visitTime = time - this.visitAt;
    const opening = time < START_FOLLOW + FALL_BACK;
    if (!opening && visitTime < 0) { this.lastFlightTime = null; return; }

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
    const baseline = p.flightY + altitude;
    const floor = this.altitudeAt(world, x, z, true);
    // Follow a sloped clearance envelope upstream of steep ground instead of
    // lifting as soon as the drone intersects the shape of a hillside.
    let goal = Math.max(baseline, floor);
    for (const ahead of LOOK_AHEAD) {
      const probe = this.flightPoint(world, rig, distance + ahead, across, this.lookFrame);
      goal = Math.max(goal, this.altitudeAt(world, probe.flightX, probe.flightZ) - ahead * .48);
    }
    goal = world.rift?.clearance(x, goal, z, this.radius + 2) ?? goal;
    const dt = this.lastFlightTime === null ? 1 : clamp(time - this.lastFlightTime, 0, .25);
    this.lastFlightTime = time;
    const y = Math.max(goal, this.root.position.y - 13 * dt);
    this.root.position.set(x, dt === 1 ? goal : y, z);
    const climb = smoothstep(0, 20, this.root.position.y - baseline);
    this.root.rotation.set(pitch - .28 * climb, p.yaw, Math.sin(time * 1.52) * .075 + side * .27 * climb);
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
