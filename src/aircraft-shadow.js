import * as THREE from 'three';
import {clamp, smoothstep} from './core.js?v=13.0.0';

export const SUN_OFFSET = [-100, 170, 70];

function shadowTexture(world, type) {
  const canvas = document.createElement('canvas');
  const size = type === 'cart' ? 160 : type === 'drone' ? 128 : 96;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.filter = type === 'cart' ? 'blur(2px)' : type === 'drone' ? 'blur(8px)' : 'blur(3px)';
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  if (type === 'cart') {
    ctx.beginPath();
    ctx.roundRect(-44, -55, 88, 110, 12);
    for (const x of [-51, 33]) for (const y of [-48, 27]) ctx.roundRect(x, y, 18, 21, 5);
    ctx.fill();
  } else if (type === 'plane') {
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

function shadowMesh(world, type) {
  world.projectedShadowTextures ??= {};
  world.projectedShadowTextures[type] ??= shadowTexture(world, type);
  const geometry = new THREE.PlaneGeometry(1, 1, 4, 4);
  const material = new THREE.MeshBasicMaterial({
    map: world.projectedShadowTextures[type], color: '#151814', transparent: true,
    depthWrite: false, side: THREE.DoubleSide, polygonOffset: true,
    polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = {plane: 'BiplaneGroundShadow', drone: 'DroneGroundShadow', cloud: 'CloudGroundShadow', cart: 'CartContactShadow'}[type];
  mesh.visible = false;
  world.group.add(mesh);
  world.ownedGeometry.push(geometry);
  world.ownedMaterials.push(material);
  return mesh;
}

export function createCartContactShadow(world, bounds) {
  const mesh = shadowMesh(world, 'cart');
  mesh.material.opacity = .46;
  mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3.5);
  return {mesh, width: (bounds.max.x - bounds.min.x) * 1.55, length: (bounds.max.z - bounds.min.z) * 1.50};
}

export function updateCartContactShadow(world, rig, distance, trackFrame) {
  const {mesh, width, length} = rig.contactShadow;
  const {position, uv} = mesh.geometry.attributes;
  const {x, y, z, tx, tz, ty, nx, nz} = trackFrame;
  const shiftX = -SUN_OFFSET[0] / SUN_OFFSET[1] * .32;
  const shiftZ = -SUN_OFFSET[2] / SUN_OFFSET[1] * .32;
  const bridge = world.structureAt(distance, 0, rig)?.kind === 'bridge' && !world.features.bridge?.spans;
  const bed = y + (bridge ? .014 : -.022);
  for (let i = 0; i < position.count; i++) {
    const across = (uv.getX(i) - .5) * width;
    const along = (uv.getY(i) - .5) * length;
    const px = x + across * nx + along * tx + shiftX;
    const pz = z + across * nz + along * tz + shiftZ;
    const ground = world.groundHeight(px, pz) + .014;
    const acrossRail = across + shiftX * nx + shiftZ * nz;
    const onBed = Math.abs(acrossRail) < 1.49;
    const surface = bed + ty * (along + shiftX * tx + shiftZ * tz);
    position.setXYZ(i, px, onBed ? Math.max(ground, surface) : ground, pz);
  }
  position.needsUpdate = true;
  mesh.geometry.boundingSphere.center.set(x, y, z);
  mesh.visible = true;
}

export class AircraftShadow {
  constructor(world, span, length, type = 'drone') {
    this.mesh = shadowMesh(world, type);
    this.mesh.frustumCulled = false;
    this.span = span;
    this.length = length;
    this.type = type;
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
    const drone = this.type === 'drone';
    const softness = drone ? 1.16 + fall * .051 : 1 + fall * .026;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    for (let i = 0; i < points.count; i++) {
      const across = (uv.getX(i) - 0.5) * this.span * softness;
      const along = (uv.getY(i) - 0.5) * this.length * softness;
      const px = x + across * cos + along * sin;
      const pz = z - across * sin + along * cos;
      points.setXYZ(i, px, world.groundHeight(px, pz) + 0.055, pz);
    }
    points.needsUpdate = true;
    const strength = drone ? .29 - .12 * smoothstep(2, 24, fall) : .36 - .17 * smoothstep(2, 48, fall);
    this.mesh.material.opacity = fade * strength;
    this.mesh.visible = fade > 0.005;
  }
}
