import * as THREE from 'three';

export const SMOKE_LIFETIME = 5;
const PLANE_COLORS = ['#e32e38', '#ffd52c'];
const origin = new THREE.Vector3();

export class AirshowSmoke {
  constructor(world, wingTips, {
    lifetime = SMOKE_LIFETIME, spacing = 0.028, colors = PLANE_COLORS,
    sizes = [2.2, 4.8], opacity = 0.52, range = 0,
  } = {}) {
    this.wingTips = wingTips;
    this.lifetime = lifetime;
    this.spacing = spacing;
    this.pairs = Math.ceil(lifetime / spacing) + 1;
    this.lastEmission = -1;
    this.range = range;
    const palette = colors.map(color => new THREE.Color(color));
    const count = this.pairs * wingTips.length;
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.births = new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
    const vertexColors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    for (let i = 0; i < count; i++) {
      const {r, g, b} = palette[i % palette.length];
      vertexColors.setXYZ(i, r, g, b);
    }
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('birth', this.births);
    geometry.setAttribute('smokeColor', vertexColors);
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      defines: range > 0 ? {SHORT_TRAIL: 1} : {},
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        clock: {value: 0},
        lifetime: {value: lifetime},
        diameterRange: {value: new THREE.Vector2(...sizes)},
        opacity: {value: opacity},
        head: {value: new THREE.Vector3()},
        range: {value: range},
        viewportHeight: {value: 360},
      },
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute float birth;
        attribute vec3 smokeColor;
        uniform float clock, lifetime, viewportHeight;
        uniform vec2 diameterRange;
        #ifdef SHORT_TRAIL
          uniform vec3 head;
          uniform float range;
          varying float fadeByRange;
        #endif
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
          float diameter = mix(diameterRange.x, diameterRange.y, min(age, 1.0));
          #ifdef SHORT_TRAIL
            fadeByRange = 1.0 - smoothstep(range * 0.68, range, distance(position, head));
          #endif
          gl_PointSize = clamp(diameter * projectionMatrix[1][1] * viewportHeight * 0.5 / max(1.0, -mvPosition.z), 1.0, 42.0);
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float opacity;
        #ifdef SHORT_TRAIL
          varying float fadeByRange;
        #endif
        varying float age, seed;
        varying vec3 tint;
        void main() {
          float circle = length(gl_PointCoord * 2.0 - 1.0);
          float edge = 1.0 - smoothstep(0.2 + 0.09 * seed, 1.0, circle);
          float alpha = opacity * edge * (1.0 - smoothstep(0.03, 1.0, age));
          #ifdef SHORT_TRAIL
            alpha *= fadeByRange;
          #endif
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
    if (time >= duration + this.lifetime) {
      this.mesh.visible = false;
      return;
    }
    const {spacing, pairs, wingTips} = this;
    const current = Math.floor(Math.min(time, duration) / spacing);
    if (current > this.lastEmission) {
      for (let i = Math.max(this.lastEmission + 1, current - pairs + 1); i <= current; i++) {
        const birth = i * spacing;
        const {position, rotation} = samplePose(birth);
        for (const [tip, wing] of wingTips.entries()) {
          const index = wingTips.length * (i % pairs) + tip;
          origin.copy(wing).applyQuaternion(rotation).add(position);
          this.positions.setXYZ(index, origin.x, origin.y, origin.z);
          this.births.setX(index, birth);
          if (this.range && i === current) this.mesh.material.uniforms.head.value.copy(origin);
        }
      }
      this.lastEmission = current;
      this.positions.needsUpdate = this.births.needsUpdate = true;
      this.mesh.geometry.setDrawRange(0, wingTips.length * Math.min(pairs, current + 1));
    }
    this.mesh.material.uniforms.clock.value = time;
    this.mesh.material.uniforms.viewportHeight.value = viewportHeight;
    this.mesh.visible = true;
  }
}
