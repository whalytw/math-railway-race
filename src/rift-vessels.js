import * as THREE from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';

const vessels = [
  {name: 'RiftCorvette', phase: .31, x: -109, height: 37, size: 65, yaw: 1.27, drift: 16},
  {name: 'RiftOrbitalStation', phase: .57, x: 144, height: 62, size: 73, yaw: -.73, drift: 4},
  {name: 'RiftShuttle', phase: .81, x: -93, height: 44, size: 28, yaw: 1.47, drift: 27},
];

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

export class RiftVessels {
  constructor(scene, length) {
    const loader = new GLTFLoader();
    this.models = [];
    this.active = true;
    this.length = length;
    this.seconds = 0;
    for (const spec of vessels) {
      loader.loadAsync(new URL('../assets/models/' + spec.name + '.glb', import.meta.url).href)
        .then(({scene: model}) => {
          if (!this.active) { release(model); return; }
          const bounds = new THREE.Box3().setFromObject(model);
          const dimensions = bounds.getSize(new THREE.Vector3());
          const scale = spec.size / Math.max(dimensions.x, dimensions.y, dimensions.z);
          model.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
          model.scale.setScalar(scale);
          const anchor = new THREE.Group();
          anchor.name = spec.name;
          anchor.add(model);
          scene.add(anchor);
          this.models.push({anchor, model, spec});
          this.update(this.seconds);
        }).catch(error => {
          if (this.active) console.warn('Could not load', spec.name, error);
        });
    }
  }

  update(seconds) {
    this.seconds = seconds;
    for (const {anchor, spec} of this.models) {
      const wave = seconds * .12 + spec.phase * 11;
      const leftOrRight = Math.sign(spec.x);
      const awayFromRails = Math.max(Math.abs(spec.x), this.length * .093 + 34);
      anchor.position.set(leftOrRight * awayFromRails + spec.drift * Math.sin(wave * .52),
        spec.height + 4 * Math.cos(wave), this.length * spec.phase + spec.drift * Math.cos(wave * .67));
      anchor.rotation.set(.052 * Math.sin(wave), spec.yaw + .17 * Math.sin(wave * .45), .08 * Math.cos(wave * .55));
    }
  }

  dispose() {
    this.active = false;
    for (const {anchor, model} of this.models) {
      anchor.removeFromParent();
      release(model);
    }
    this.models.length = 0;
  }
}
