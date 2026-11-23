import * as THREE from 'three';
import {clamp, smoothstep} from './core.js?v=13.0.0';

export const SUN_OFFSET = [-100, 170, 70];

function shadowTexture(world, type) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.translate(48, 48);
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  if (type === 'plane') {
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 40, 0, 0, Math.PI * 2);
    ctx.roundRect(-42, -17, 84, 16, 6);
    ctx.roundRect(-16, 24, 32, 9, 3);
    ctx.fill();
  } else if (type === 'cloud') {
    ctx.beginPath();
    ctx.ellipse(0, 2, 41, 29, 0, 0, Math.PI * 2);
    ctx.moveTo(-9, -17); ctx.arc(-24, -17, 15, 0, Math.PI * 2);
    ctx.moveTo(21, -22); ctx.arc(1, -22, 20, 0, Math.PI * 2);
    ctx.moveTo(38, -11); ctx.arc(24, -11, 14, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(-28, -29); ctx.lineTo(28, 29);
    ctx.moveTo(28, -29); ctx.lineTo(-28, 29);
    ctx.stroke();
    ctx.fillRect(-13, -19, 26, 38);
    for (const x of [-28, 28]) for (const y of [-29, 29]) {
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  world.ownedTextures.push(texture);
  return texture;
}

export class AircraftShadow {
  constructor(world, span, length, type = 'drone') {
    world.aircraftShadowTextures ??= {};
    world.aircraftShadowTextures[type] ??= shadowTexture(world, type);
    const geometry = new THREE.PlaneGeometry(1, 1, 4, 4);
    const material = new THREE.MeshBasicMaterial({
      map: world.aircraftShadowTextures[type], color: '#151814', transparent: true,
      depthWrite: false, side: THREE.DoubleSide, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = {plane: 'BiplaneGroundShadow', drone: 'DroneGroundShadow', cloud: 'CloudGroundShadow'}[type];
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    world.group.add(this.mesh);
    world.ownedGeometry.push(geometry);
    world.ownedMaterials.push(material);
    this.span = span;
    this.length = length;
  }

  hide() { this.mesh.visible = false; }

  update(world, position, yaw, fade = 1) {
    const [sunX, sunY, sunZ] = SUN_OFFSET;
    const height = Math.max(0, position.y - world.groundHeight(position.x, position.z));
    let fall = height;
    let x = position.x, z = position.z;
    // Intersect the sloped sun ray with the terrain rather than projecting
    // onto rail height or onto a single flat plane.
    for (let i = 0; i < 5; i++) {
      x = position.x - sunX / sunY * fall;
      z = position.z - sunZ / sunY * fall;
      fall = clamp(position.y - world.groundHeight(x, z), 0, height * 2 + 15);
    }
    const {d, halfDepth} = world.terrainGrid;
    if (Math.abs(x) > d || Math.abs(z) > halfDepth) {
      this.hide();
      return;
    }
    const {position: points, uv} = this.mesh.geometry.attributes;
    const softness = 1 + fall * 0.026;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    for (let i = 0; i < points.count; i++) {
      const across = (uv.getX(i) - 0.5) * this.span * softness;
      const along = (uv.getY(i) - 0.5) * this.length * softness;
      const px = x + across * cos + along * sin;
      const pz = z - across * sin + along * cos;
      points.setXYZ(i, px, world.groundHeight(px, pz) + 0.055, pz);
    }
    points.needsUpdate = true;
    this.mesh.material.opacity = fade * (0.36 - 0.17 * smoothstep(2, 48, fall));
    this.mesh.visible = fade > 0.005;
  }
}
