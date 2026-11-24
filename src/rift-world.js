import * as THREE from 'three';
import {lerp, randomGenerator, smoothstep} from './core.js?v=13.0.0';
import {BASE_SPEED} from './quiz-race.js?v=23';
import {createRiftTracks} from './rift-track.js?v=25';
import {inRift, PORTAL_APPROACH, portalDistance, RIFT_ENTRY, RIFT_EXIT, RiftDraw} from './rift-rules.js?v=25';
import {addDeepSky, addPortal, portalResources, PortalTransition} from './rift-visuals.js?v=25';
import {ZodiacSky} from './zodiac-space.js?v=25';

const TRACK_PALETTES = ['#81dcec', '#ffd59c', '#b1b6ff'];
const WOOD = new THREE.Color('#9d7256');
const TRACK_CHUNK = 95;

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const rotation = new THREE.Quaternion();
const offset = new THREE.Vector3();
const worldAxis = new THREE.Vector3(0, 1, 0);
const scratch = new THREE.Object3D();

function orient(sample) {
  return rotation.setFromEuler(euler.set(sample.pitch, sample.yaw, sample.roll, 'YXZ'));
}

function railMesh(track, from, end, material, own) {
  const coordinates = [], indices = [];
  const points = Math.ceil((end - from) / 1.8);
  const section = [[-.075,.16], [.075,.16], [.105,.306], [.075,.381], [-.075,.381], [-.105,.306]];
  const width = section.length;
  for (const side of [-1, 1]) {
    const base = coordinates.length / 3;
    const frame = {};
    for (let i = 0; i <= points; i++) {
      track.sample(track.start + lerp(from, end, i / points), frame);
      orient(frame);
      for (const [x, y] of section) {
        offset.set(side * .8885 + x, y, 0).applyQuaternion(rotation);
        coordinates.push(frame.x + offset.x, frame.y + offset.y, frame.z + offset.z);
      }
      if (!i) continue;
      const edge = base + (i - 1) * width;
      for (let j = 0; j < width; j++) {
        const a = edge + j, b = edge + (j + 1) % width;
        indices.push(a, b, a + width, b, b + width, a + width);
      }
    }
  }
  const geometry = own(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function spaceTrackMeshes(scene, track, lane, spacing, sleeper, own) {
  const hue = new THREE.Color(TRACK_PALETTES[lane]);
  const metal = own(new THREE.MeshStandardMaterial({
    color: hue.clone().lerp(new THREE.Color('#e4dae1'), .35),
    emissive: hue, emissiveIntensity: .19, roughness: .42, metalness: .43,
  }));
  const frame = {}, colour = new THREE.Color(), chunks = [];
  const pitch = track.length / Math.round(track.length / spacing);
  for (let from = 0; from < track.length; from += TRACK_CHUNK) {
    const end = Math.min(track.length, from + TRACK_CHUNK);
    const first = Math.ceil(from / pitch - .5), last = Math.ceil(end / pitch - .5);
    const ties = own(new THREE.InstancedMesh(sleeper.geometry, sleeper.material, last - first));
    for (let i = first; i < last; i++) {
      track.sample(track.start + (i + .5) * pitch, frame);
      scratch.quaternion.copy(orient(frame));
      scratch.position.set(frame.x, frame.y, frame.z);
      offset.set(0, .08, 0).applyQuaternion(scratch.quaternion);
      scratch.position.add(offset);
      scratch.updateMatrix();
      ties.setMatrixAt(i - first, scratch.matrix);
      ties.setColorAt(i - first, colour.copy(WOOD).multiplyScalar(.92 + .12 * Math.sin(i * 26.87)));
    }
    ties.computeBoundingSphere();
    const group = new THREE.Group();
    group.name = 'FloatingTrack';
    group.add(railMesh(track, from, end, metal, own), ties);
    scene.add(group);
    chunks.push({group, centre: track.rig.raceLength * RIFT_ENTRY + (from + end) * .5});
  }
  return chunks;
}

function portalFrame(tracks, phase, sampleAt) {
  const points = tracks.map(track => sampleAt(track, phase));
  const mid = points[Math.floor(points.length / 2)];
  const frame = {...mid, x: 0, y: 0, z: 0};
  for (const p of points) {
    frame.x += p.x / points.length;
    frame.y += p.y / points.length;
    frame.z += p.z / points.length;
  }
  const reach = Math.max(...points.map(p => Math.hypot(p.x - frame.x, p.y - frame.y, p.z - frame.z)));
  return {frame, radius: Math.max(24, reach * 1.96 + 14)};
}

export class RaceRift {
  constructor(world, random = Math.random) {
    this.world = world;
    this.random = random;
    this.draw = new RiftDraw(world.config.riftChance, random);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resources = [];
    this.own = resource => (this.resources.push(resource), resource);
    this.exterior = new THREE.Group();
    this.exterior.name = 'RiftPortals';
    this.exterior.visible = false;
    world.group.add(this.exterior);
  }

  get active() { return this.draw.result === true; }

  reset() {
    this.draw.reset();
    this.exterior.visible = false;
    this.zodiac?.reset();
  }

  updateRace(views) {
    if (this.draw.result !== null) return;
    const leader = Math.max(...views.map(({quiz, rig}) => quiz.distance / rig.raceLength));
    if (this.draw.update(leader)) {
      if (!this.scene) this.build();
      this.exterior.visible = true;
    }
  }

  build() {
    const {world, own} = this;
    const routeRandom = randomGenerator(world.config.seed + ':rift-track');
    this.scene = new THREE.Scene();
    this.scene.name = 'RiftScene';
    this.scene.background = new THREE.Color('#070920');
    this.scene.fog = new THREE.Fog('#10122b', 200, 870);
    this.scene.environment = world.scene.environment;
    this.scene.environmentIntensity = .44;
    this.scene.add(new THREE.HemisphereLight('#e1eaff', '#413967', 1.66));
    const key = new THREE.DirectionalLight('#d4e5ff', 2.18);
    key.position.set(-75, 85, -50);
    this.scene.add(key);

    const tracks = createRiftTracks(world.carts, routeRandom);
    this.tracks = new Map(tracks.map(track => [track.rig, track]));
    this.starRatio = addDeepSky(this.scene, tracks[0].length, randomGenerator(world.config.seed + ':rift-sky'), own);
    const sleepers = {
      geometry: own(new THREE.BoxGeometry(2.76, .16, .28)),
      material: own(new THREE.MeshStandardMaterial({color: '#ffffff', emissive: '#3b2d40', emissiveIntensity: .34, roughness: .87})),
    };
    this.chunks = tracks.flatMap((track, index) => spaceTrackMeshes(this.scene, track, index, world.sleeperPitch, sleepers, own));
    this.portals = portalResources(own);
    this.outdoorPortals = [];
    const groups = world.route.lanes ? [world.carts] : world.carts.map(rig => [rig]);
    for (const [phase, name, facesAhead] of [[RIFT_ENTRY, 'Entrance', false], [RIFT_EXIT, 'Exit', true]]) {
      for (const rigs of groups) {
        const {frame, radius} = portalFrame(rigs, phase, (rig, progress) => rig.track.sample(rig.departure + rig.raceLength * progress));
        const portal = addPortal(this.exterior, frame, radius, facesAhead, this.portals, 'OutdoorRift' + name);
        if (!world.route.lanes) portal.mesh.layers.set(world.carts.indexOf(rigs[0]) + 1);
        this.outdoorPortals.push(portal);
      }
      const {frame, radius} = portalFrame(tracks, phase, (track, progress) => track.sample(track.rig.departure + track.rig.raceLength * progress));
      addPortal(this.scene, frame, radius, !facesAhead, this.portals, 'SpaceRift' + name);
    }
    this.transition = new PortalTransition(own);
    this.zodiac = new ZodiacSky(this.scene, own, this.random);
  }

  inside(view, distance = view.quiz.distance) {
    return this.active && inRift(distance, view.rig.raceLength);
  }

  routeFor(view) {
    if (!this.inside(view, view.motion.odometer)) return view.rig.track;
    return this.tracks.get(view.rig);
  }

  placeCart(view, track) {
    const inside = track !== view.rig.track;
    if (Boolean(view.riftTrack) === inside) return;
    view.riftTrack = inside ? track : null;
    (inside ? this.scene : this.world.group).add(view.rig.root);
    if (view.rig.contactShadow) view.rig.contactShadow.mesh.visible = !inside;
    view.snapped = false;
    view.camera.up.copy(worldAxis);
  }

  clearance(x, y, z, padding) {
    if (!this.active) return y;
    let safest = y;
    for (const {mesh, radius, tx, tz} of this.outdoorPortals) {
      const dx = x - mesh.position.x, dz = z - mesh.position.z;
      const forward = Math.abs(dx * tx + dz * tz);
      const across = Math.abs(dx * tz - dz * tx);
      const lift = (1 - smoothstep(radius * .23, radius * 1.65 + 36, forward))
        * (1 - smoothstep(radius * .83 + padding, radius + padding + 20, across));
      safest = Math.max(safest, lerp(y, mesh.position.y + radius * .91 + padding, lift));
    }
    return safest;
  }

  blocksFlight(views, delay, duration, rewardSeconds) {
    if (!this.active) return false;
    return views.some(view => {
      if (view.quiz.finished !== null) return false;
      const {rig, state, quiz} = view;
      const slow = Math.min(BASE_SPEED / 3.6, state.speed);
      const fast = Math.max(BASE_SPEED / 3.6, state.speed, quiz.caps.at(-1) / 3.6);
      const start = quiz.distance + delay * slow;
      const end = quiz.distance + (delay + duration) * fast + rewardSeconds * 10 / 3.6;
      return start <= rig.raceLength * RIFT_EXIT + PORTAL_APPROACH && end >= rig.raceLength * RIFT_ENTRY - PORTAL_APPROACH;
    });
  }

  updateVisuals(views, seconds, pixelRatio) {
    if (!this.active) return;
    this.portals.material.uniforms.clock.value = this.reducedMotion ? seconds * .26 : seconds;
    this.starRatio.value = pixelRatio;
    const cameras = views.filter(view => view.riftTrack).map(view => view.camera);
    this.zodiac.update(seconds, cameras, pixelRatio, this.reducedMotion);
  }

  selectTracks(view) {
    const span = Math.max(510, this.world.config.viewDistance);
    for (const {group, centre} of this.chunks) group.visible = Math.abs(view.motion.odometer - centre) < span;
  }

  drawTransition(renderer, view, seconds) {
    if (!this.active) return;
    this.transition.draw(renderer, portalDistance(view.motion.odometer, view.rig.raceLength),
      view.viewport, seconds, PORTAL_APPROACH, this.reducedMotion);
  }

  dispose() {
    this.exterior.removeFromParent();
    this.exterior.clear();
    this.scene?.clear();
    this.resources.forEach(resource => resource.dispose());
  }
}
