import * as THREE from 'three';

const LIFE = 4.8;
const SPACING = 0.045;
const PAIRS = Math.ceil(LIFE / SPACING) + 1;
const COLORS = [new THREE.Color('#e32e38'), new THREE.Color('#ffd52c')];
const origin = new THREE.Vector3();

export class AirshowSmoke {
  constructor(world, wingTips) {
    this.wingTips = wingTips;
    this.lastEmission = -1;
    const count = PAIRS * 2;
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.births = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    for (let i = 0; i < count; i++) {
      const {r, g, b} = COLORS[i % 2];
      colors.setXYZ(i, r, g, b);
    }
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('birth', this.births);
    geometry.setAttribute('smokeColor', colors);
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        clock: {value: 0},
        lifetime: {value: LIFE},
        viewportHeight: {value: 360},
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute float birth;
        attribute vec3 smokeColor;
        uniform float clock, lifetime, viewportHeight;
        varying float age, seed;
        varying vec3 tint;
        void main() {
          seed = fract(birth * 17.31);
          float elapsed = max(0.0, clock - birth);
          age = elapsed / lifetime;
          tint = smokeColor;
          vec3 puff = position + elapsed * vec3(0.34, 0.21, -0.13);
          puff.y += elapsed * 0.27 * (seed - 0.5);
          vec4 mvPosition = modelViewMatrix * vec4(puff, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float diameter = mix(1.65, 4.25, min(age, 1.0));
          gl_PointSize = clamp(diameter * projectionMatrix[1][1] * viewportHeight * 0.5 / max(1.0, -mvPosition.z), 1.0, 42.0);
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        varying float age, seed;
        varying vec3 tint;
        void main() {
          float circle = length(gl_PointCoord * 2.0 - 1.0);
          float edge = 1.0 - smoothstep(0.2 + 0.09 * seed, 1.0, circle);
          float alpha = 0.67 * edge * (1.0 - smoothstep(0.03, 1.0, age));
          if (alpha < 0.007) discard;
          gl_FragColor = vec4(mix(tint, vec3(0.87), 0.17 * min(age, 1.0)), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    this.mesh = new THREE.Points(geometry, material);
    this.mesh.name = 'WingtipSmoke';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    world.group.add(this.mesh);
    world.ownedGeometry.push(geometry);
    world.ownedMaterials.push(material);
  }

  clear() {
    this.lastEmission = -1;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  update(time, duration, viewportHeight, samplePose) {
    if (time >= duration + LIFE) {
      this.mesh.visible = false;
      return;
    }
    const current = Math.floor(Math.min(time, duration) / SPACING);
    if (current > this.lastEmission) {
      for (let i = Math.max(this.lastEmission + 1, current - PAIRS + 1); i <= current; i++) {
        const birth = i * SPACING;
        const {position, rotation} = samplePose(birth);
        for (const [tip, wing] of this.wingTips.entries()) {
          const index = 2 * (i % PAIRS) + tip;
          origin.copy(wing).applyQuaternion(rotation).add(position);
          this.positions.setXYZ(index, origin.x, origin.y, origin.z);
          this.births.setX(index, birth);
        }
      }
      this.lastEmission = current;
      this.positions.needsUpdate = this.births.needsUpdate = true;
      this.mesh.geometry.setDrawRange(0, 2 * Math.min(PAIRS, current + 1));
    }
    this.mesh.material.uniforms.clock.value = time;
    this.mesh.material.uniforms.viewportHeight.value = viewportHeight;
    this.mesh.visible = true;
  }
}
