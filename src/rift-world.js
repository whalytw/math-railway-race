import * as THREE from 'three';
import {lerp, randomGenerator, smoothstep} from './core.js?v=13.0.0';
import {BASE_SPEED} from './quiz-race.js?v=23';
import {createRiftTracks} from './rift-track.js?v=27';
import {chooseNebula, inRift, PORTAL_APPROACH, portalDistance, RIFT_ENTRY, RIFT_EXIT, RIFT_REVEAL, RiftDraw} from './rift-rules.js?v=29';
import {addDeepSky} from './rift-visuals.js?v=28';
import {linkPortal, RiftPortals} from './rift-portals.js?v=28';
import {RiftVessels} from './rift-vessels.js?v=29';

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
    this.round = 0;
    this.disposed = false;
    this.own = resource => (this.resources.push(resource), resource);
    this.exterior = new THREE.Group();
    this.exterior.name = 'RiftPortals';
    this.exterior.visible = false;
    world.group.add(this.exterior);
  }

  get active() { return this.exterior.visible; }

  rollRound() {
    this.exterior.visible = false;
    this.portals?.reset();
    return this.draw.roll();
  }

  configureRound() {
    this.nebula = chooseNebula(this.nebula, this.random);
    this.sky.show(this.nebula);
    this.vessels.reset(randomGenerator(this.world.config.seed + ':rift-traffic:' + this.round++));
  }

  updateRace(views) {
    if (!this.draw.result || this.active) return;
    if (views.some(({quiz, rig}) => quiz.distance >= RIFT_REVEAL * rig.raceLength)) this.exterior.visible = true;
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
    this.sky = addDeepSky(this.scene, tracks[0].length, randomGenerator(world.config.seed + ':rift-sky'), own);
    const sleepers = {
      geometry: own(new THREE.BoxGeometry(2.76, .16, .28)),
      material: own(new THREE.MeshStandardMaterial({color: '#ffffff', emissive: '#3b2d40', emissiveIntensity: .34, roughness: .87})),
    };
    this.chunks = tracks.flatMap((track, index) => spaceTrackMeshes(this.scene, track, index, world.sleeperPitch, sleepers, own));
    this.portals = new RiftPortals(own, world.carts.length);
    this.outdoorPortals = [];
    this.links = new Map(world.carts.map(rig => [rig, []]));
    const outdoorSample = (rig, phase) => rig.track.sample(rig.departure + rig.raceLength * phase);
    const spaceSample = (track, phase) => track.sample(track.rig.departure + track.rig.raceLength * phase);
    const groups = world.route.lanes ? [world.carts] : world.carts.map(rig => [rig]);
    for (const [phase, name, entering] of [[RIFT_ENTRY, 'Entrance', true], [RIFT_EXIT, 'Exit', false]]) {
      const inside = portalFrame(tracks, phase, spaceSample);
      const space = this.portals.add(this.scene, inside.frame, inside.radius, entering, own, 'SpaceRift' + name);
      for (const rigs of groups) {
        const outside = portalFrame(rigs, phase, outdoorSample);
        const outdoor = this.portals.add(this.exterior, outside.frame, outside.radius, !entering, own, 'OutdoorRift' + name);
        if (!world.route.lanes) outdoor.mesh.layers.set(world.carts.indexOf(rigs[0]) + 1);
        this.outdoorPortals.push(outdoor);
        for (const rig of rigs) {
          const link = linkPortal(outdoorSample(rig, phase), spaceSample(this.tracks.get(rig), phase), outdoor, space, entering);
          this.links.get(rig).push(link);
        }
      }
    }
    this.vessels = new RiftVessels(this.scene, tracks, world.store, own);
  }

  async prepare(renderer, views, viewportWidth, windowHeight, configureOutdoor) {
    if (!this.scene) this.build();
    await Promise.all([this.sky.prepare(renderer, () => this.disposed), this.vessels.ready]);
    if (this.disposed) return;
    this.vessels.reset(randomGenerator(this.world.config.seed + ':rift-loading'), true);
    this.vessels.warmTextures(renderer);
    const view = views[Math.floor(views.length / 2)];
    const [entry] = this.links.get(view.rig);
    const inside = entry.inside;
    const stagedCarts = views.map(({rig}, i) => {
      const cart = rig.root.clone(true);
      if (rig.turbo) cart.add(rig.turbo.root.clone(true));
      cart.position.copy(this.links.get(rig)[0].inside.origin);
      cart.position.z += 8 + i * 1.2;
      cart.rotation.set(0, 0, 0);
      this.scene.add(cart);
      return cart;
    });
    const cameraAt = (gate, far) => {
      const camera = view.camera.clone();
      camera.layers.enableAll();
      camera.far = far;
      camera.position.copy(gate.origin).addScaledVector(gate.forward, -19);
      camera.position.y += 5.8;
      camera.lookAt(gate.origin.clone().addScaledVector(gate.forward, 30));
      camera.updateProjectionMatrix();
      return camera;
    };
    const jobs = [{scene: this.scene, camera: cameraAt(inside, 12000), gate: inside, configure: () => {}}];
    for (const peer of views) {
      const gate = this.links.get(peer.rig)[1].outside;
      const camera = cameraAt(gate, 18000);
      jobs.push({scene: this.world.scene, camera, gate, configure: () => configureOutdoor(peer, camera, gate)});
    }
    try {
      await this.portals.prepare(renderer, viewportWidth, windowHeight, jobs);
      this.prepared = true;
    } finally {
      for (const cart of stagedCarts) cart.removeFromParent();
      this.scene.matrixWorldAutoUpdate = false;
    }
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
    const parent = inside ? this.scene : this.world.group;
    parent.add(view.rig.root);
    if (view.rig.turbo) parent.add(view.rig.turbo.root);
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
    this.portals.beginFrame();
    this.portals.clock.value = this.reducedMotion ? seconds * .26 : seconds;
    this.sky.clock.value = this.reducedMotion ? 0 : seconds;
    this.vessels.update(seconds, views, this.reducedMotion);
    this.sky.pixelRatio.value = pixelRatio;
    this.scene.updateMatrixWorld();
  }

  selectTracks(view) {
    const span = Math.max(510, this.world.config.viewDistance);
    for (const {group, centre} of this.chunks) group.visible = Math.abs(view.motion.odometer - centre) < span;
  }

  cameraBlend(view) {
    if (!this.active) return 0;
    return 1 - smoothstep(32, 67, Math.abs(portalDistance(view.motion.odometer, view.rig.raceLength)));
  }

  cameraFor(view) {
    if (!this.active) return {camera: view.camera, space: false};
    const {odometer} = view.motion, {raceLength} = view.rig;
    const [entry, exit] = this.links.get(view.rig);
    const link = odometer < raceLength * RIFT_ENTRY + 42 ? entry : exit;
    const offset = odometer - raceLength * (link.entering ? RIFT_ENTRY : RIFT_EXIT);
    return this.portals.cameraFor(view, offset > 42 ? null : link, offset);
  }

  drawPortal(renderer, renderView, index, viewportWidth, windowHeight, seconds, configure) {
    if (!renderView.link) return null;
    return this.portals.preview(renderer, renderView, index, viewportWidth, windowHeight, seconds,
      configure, this.world.scene, this.scene, Math.max(450, this.world.config.viewDistance));
  }

  dispose() {
    this.disposed = true;
    this.vessels?.dispose();
    this.exterior.removeFromParent();
    this.exterior.clear();
    this.scene?.clear();
    this.resources.forEach(resource => resource.dispose());
  }
}
