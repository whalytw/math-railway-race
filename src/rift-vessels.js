import * as THREE from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {spaceEncounters} from './rift-rules.js?v=28';
import {FlightFormation, ReconnaissanceProbe} from './rift-encounters.js?v=28';

const BACKDROP = [
  {name: 'RiftOrbitalStation', size: 68, height: 41, drift: 3},
  {name: 'RiftCorvette', size: 55, height: 34, drift: 14},
  {name: 'RiftShuttle', size: 24, height: 31, drift: 17},
  {name: 'RiftFreighter', size: 39, height: 30, drift: 11},
];
const PROBES = ['RiftProbeDome', 'RiftProbeDisk', 'RiftProbeLens'];
const STRUCTURES = ['RiftDeepStation', 'RiftRelay'];
const ASSETS = [...STRUCTURES, ...BACKDROP.map(asset => asset.name), 'RiftInterceptor', ...PROBES];

function release(model) {
  const resources = new Set();
  model.traverse(node => {
    if (!node.isMesh) return;
    resources.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}

function sourceModel(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  return {root, centre, size, span: Math.max(size.x, size.y, size.z)};
}

function mounted(source, size) {
  const model = source.root.clone(true);
  const scale = size / source.span;
  model.scale.multiplyScalar(scale);
  model.position.sub(source.centre).multiplyScalar(scale);
  return model;
}

function railBand(tracks, z, reach) {
  let left = Infinity, right = -Infinity, low = Infinity, high = -Infinity;
  for (const track of tracks) {
    for (const point of track.points) {
      if (Math.abs(point.z - z) > reach) continue;
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      low = Math.min(low, point.y);
      high = Math.max(high, point.y);
    }
  }
  return {left, right, low, high};
}

export class RiftVessels {
  constructor(scene, tracks, store, own) {
    this.tracks = tracks;
    this.length = tracks[0].points.at(-1).z;
    this.active = true;
    this.sources = new Map();
    this.flights = [];
    this.props = [];
    this.group = new THREE.Group();
    this.group.name = 'RiftTraffic';
    scene.add(this.group);
    const loader = new GLTFLoader();
    this.ready = Promise.all(ASSETS.map(name =>
      loader.loadAsync(new URL('../assets/models/' + name + '.glb', import.meta.url).href)
        .then(({scene: model}) => {
          if (!this.active) { release(model); return; }
          this.sources.set(name, sourceModel(model));
        }).catch(error => {
          if (this.active) console.warn('Could not load', name, error);
        }))).then(() => {
      if (!this.active) return;
      this.createScenery(scene);
      this.flights = this.tracks.map(({rig}, lane) => {
        const interceptor = this.sources.get('RiftInterceptor');
        const formation = interceptor ? new FlightFormation(this.group, interceptor, store.get(rig.vehicle).bounds, lane + 1, own) : null;
        const probeModels = PROBES.map((name, index) => {
          const source = this.sources.get(name);
          return source ? mounted(source, 4.8 + index * .5) : null;
        });
        const probe = new ReconnaissanceProbe(this.group, probeModels, lane + 1);
        return {formation, probe};
      });
    });
  }

  warmTextures(renderer) {
    const textures = new Set();
    for (const {root} of this.sources.values()) root.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) renderer.initTexture(texture);
  }

  createScenery(scene) {
    const models = [STRUCTURES[0], STRUCTURES[1], STRUCTURES[1], ...BACKDROP.map(asset => asset.name)];
    for (const name of models) {
      const source = this.sources.get(name);
      if (!source) continue;
      const anchor = new THREE.Group();
      anchor.name = name;
      const model = mounted(source, 1);
      anchor.add(model);
      this.group.add(anchor);
      this.props.push({anchor, name});
    }
    const fill = new THREE.DirectionalLight('#a1bfff', 1.1);
    fill.position.set(65, 37, -80);
    scene.add(fill);
  }

  reset(random, show = false) {
    const plans = spaceEncounters(this.flights.length, random);
    for (let lane = 0; lane < this.flights.length; lane++) {
      const {formation, probe} = this.flights[lane];
      formation?.reset(plans[lane].fleet);
      probe.reset(plans[lane].probe);
    }
    const distant = BACKDROP.map((asset, i) => ({asset, i, roll: random()}))
      .sort((a, b) => a.roll - b.roll).slice(0, 2).map(entry => entry.i);
    let relayIndex = 0;
    const extraRelay = show || random() < .55;
    for (const prop of this.props) {
      const {anchor, name} = prop;
      const dock = name === STRUCTURES[0], relay = name === STRUCTURES[1];
      const index = BACKDROP.findIndex(item => item.name === name);
      const extra = relay && relayIndex++ === 1;
      anchor.visible = dock || (relay ? (!extra || extraRelay) : (show || distant.includes(index)));
      if (!anchor.visible) continue;
      const style = BACKDROP[index];
      const near = dock && (show || random() < .80);
      const fraction = dock ? .18 + random() * .12 : relay ? (extra ? .76 : .45) + random() * .065 : .36 + index * .09;
      const size = dock ? 93 + 18 * random() : relay ? 20 + 9 * random() : style.size;
      const z = fraction * this.length;
      const band = railBand(this.tracks, z, size * .8 + 10);
      const side = random() < .5 ? -1 : 1;
      const drift = dock ? 1.2 : relay ? 1.5 : style.drift;
      const clearance = near ? 9 + random() * 8 : 37 + random() * 42;
      const x = (side > 0 ? band.right : band.left) + side * (size * .71 + clearance + drift);
      const y = near ? (band.low + band.high) / 2 + 13 : band.high + (style?.height ?? 25) + 14 * random();
      anchor.scale.setScalar(size);
      anchor.position.set(x, y, z);
      anchor.rotation.set(dock ? -.13 : -.07, side * (dock ? .61 : .95) + random() * .25, side * .08);
      prop.pose = {x, y, z, drift, yaw: anchor.rotation.y, phase: random() * 6};
    }
  }

  update(seconds, views, reducedMotion) {
    const time = reducedMotion ? 0 : seconds;
    for (const {anchor, pose} of this.props) {
      if (!anchor.visible) continue;
      const wave = time * .10 + pose.phase;
      anchor.position.set(pose.x + pose.drift * Math.sin(wave), pose.y + 3 * Math.cos(wave), pose.z + pose.drift * Math.cos(wave));
      anchor.rotation.y = pose.yaw + .09 * Math.sin(wave);
    }
    for (const [index, view] of views.entries()) {
      const flight = this.flights[index];
      if (!flight) continue;
      flight.formation?.update(view, seconds);
      flight.probe.update(view, seconds, reducedMotion);
    }
  }

  dispose() {
    this.active = false;
    this.group.removeFromParent();
    this.group.clear();
    for (const {root} of this.sources.values()) release(root);
    this.sources.clear();
  }
}
