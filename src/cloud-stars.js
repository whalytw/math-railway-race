import * as THREE from 'three';
import {clamp, TAU} from './core.js?v=13.0.0';

export const STAR_COUNT = 12;
const FALL_SECONDS = .47;
const STAGGER = .018;
export const STAR_DROP_SECONDS = FALL_SECONDS + (STAR_COUNT - 1) * STAGGER;
export const starReleaseDelay = index => index * STAGGER;
const COLORS = ['#ffcd40', '#ff6daa', '#55d5ff', '#81f299', '#ffa64f', '#d9a3ff'].map(hex => new THREE.Color(hex));

function starTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.translate(32, 32);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = i / 10 * TAU - Math.PI / 2;
    const radius = i % 2 ? 12 : 28;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 7;
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

export class CloudStars {
  constructor(world) {
    this.positions = new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const {r, g, b} = COLORS[i % COLORS.length];
      colors.setXYZ(i, r, g, b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('color', colors);
    geometry.setDrawRange(0, 0);
    const texture = starTexture();
    const material = new THREE.PointsMaterial({
      color: '#fff', map: texture, size: .94, transparent: true, alphaTest: .07,
      depthWrite: false, sizeAttenuation: true, vertexColors: true, toneMapped: false,
    });
    this.mesh = new THREE.Points(geometry, material);
    this.mesh.name = 'CloudRewardStars';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    world.group.add(this.mesh);
    world.ownedGeometry.push(geometry);
    world.ownedTextures.push(texture);
    world.ownedMaterials.push(material);
    this.landing = new THREE.Vector3();
  }

  draw(burst, time) {
    const {view, origins, startsAt} = burst;
    const cart = view.rig.root;
    const landing = this.landing.set(0, 1.18, .57).applyQuaternion(cart.quaternion).add(cart.position);
    let count = 0, first = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
      const age = time - startsAt - starReleaseDelay(i);
      // A star is visible from release until it reaches the moving cart.
      if (age < 0 || age >= FALL_SECONDS) continue;
      const u = clamp(age / FALL_SECONDS, 0, 1);
      const fall = u ** 1.17, fan = Math.sin(Math.PI * u);
      const angle = i * 2.39996, reach = fan * (.53 + .19 * (i % 4));
      const origin = origins[i];
      if (count === 0) first = i;
      this.positions.setXYZ(i,
        origin.x + (landing.x - origin.x) * fall + Math.cos(angle) * reach,
        origin.y + (landing.y - origin.y) * fall + fan * .33,
        origin.z + (landing.z - origin.z) * fall + Math.sin(angle) * reach);
      count++;
    }
    // Preserve per-star colors when the first stars finish before the last ones.
    this.mesh.geometry.setDrawRange(first, count);
    this.positions.needsUpdate = true;
    this.mesh.visible = count > 0;
  }

  clear() {
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }
}
