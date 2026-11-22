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

export class CameraDrone {
  constructor(world, index, camera) {
    this.root = world.store.get(CAMERA_DRONE_ASSET).root.clone(true);
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

    this.random = randomGenerator(world.config.seed + ':camera-drone:' + index);
    this.startSide = index === 0 ? 1 : -1;
    this.visitAt = 0;
    this.scheduleVisit();
    this.exitLead = Math.min(340, world.config.viewDistance - 28);
    this.trackFrame = {};
  }

  scheduleVisit() {
    this.visitAt += 45 + 15 * this.random();
    this.visitSide = (this.random() < 0.5 ? -1 : 1) * (4.0 + this.random() * 0.8);
  }

  update(world, view) {
    const {quiz, rig, motion, state} = view;
    this.root.visible = false;
    if (quiz.finished !== null) return;

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
    const p = rig.track.sample(distance, this.trackFrame);
    // Straight tracks clamp samples past their ends. Extrapolate the starting
    // tangent so the drone can already be trailing when the cart is at rest.
    const padding = world.route.lanes ? distance - clamp(distance, 0, rig.track.length) : 0;
    const x = p.x + p.tx3 * padding + p.nx * across;
    const z = p.z + p.tz3 * padding + p.nz * across;
    const y = Math.max(p.y + p.ty * padding + altitude, world.groundHeight(x, z) + 2.25);
    this.root.position.set(x, y, z);
    this.root.rotation.set(pitch, p.yaw, Math.sin(time * 1.52) * 0.075);
    const cart = rig.root.position;
    const dx = cart.x - x, dz = cart.z - z;
    const targetYaw = Math.atan2(dx, dz) - p.yaw;
    this.gimbal.rotation.y = clamp(Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw)), -1.2, 1.2) * aim;
    this.gimbal.rotation.x = (Math.atan2(y - cart.y - 1.4, Math.hypot(dx, dz)) - pitch) * aim;
    for (const [i, rotor] of this.rotors.entries()) {
      rotor.rotation.y = state.elapsed * (i % 2 ? -51 : 51) + i * 0.8;
    }
    this.root.visible = true;
  }
}
