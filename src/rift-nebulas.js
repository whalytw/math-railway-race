import * as THREE from 'three';
import {RIFT_NEBULAS} from './rift-rules.js?v=28';

const width = 1024;
const height = 512;
const sourceRoot = new URL('../assets/textures/', import.meta.url);
const original = new URL('rift-nebula-v25.jpg', sourceRoot);
const atlas = new URL('rift-nebulas-v26.png', sourceRoot);
const centres = [.256, .267, .293, .227, .244, .265, .261];

function feather(context, w, h) {
  const sides = context.createLinearGradient(0, 0, w, 0);
  const poles = context.createLinearGradient(0, 0, 0, h);
  for (const [gradient, innerStart, innerEnd] of [[sides, .17, .83], [poles, .22, .79]]) {
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(innerStart, 'white');
    gradient.addColorStop(innerEnd, 'white');
    gradient.addColorStop(1, 'transparent');
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = gradient;
    context.fillRect(0, 0, w, h);
  }
  context.globalCompositeOperation = 'source-over';
}

function paintNebula(context, plate, image, cell) {
  const w = plate.canvas.width, h = plate.canvas.height;
  plate.clearRect(0, 0, w, h);
  if (cell < 0) {
    plate.drawImage(image, image.width * .13, image.height * .07, image.width * .68, image.height * .69, 0, 0, w, h);
  } else {
    const column = cell % 2, row = Math.floor(cell / 2);
    // Inset each atlas cell so its edge cannot sample a neighbouring nebula.
    const x = Math.round(image.width * column / 2) + 4, y = Math.round(image.height * row / 3) + 4;
    const endX = Math.round(image.width * (column + 1) / 2) - 4, endY = Math.round(image.height * (row + 1) / 3) - 4;
    plate.drawImage(image, x, y, endX - x, endY - y, 0, 0, w, h);
  }
  feather(plate, w, h);

  context.fillStyle = '#08091a';
  context.fillRect(0, 0, width, height);
  const centre = width * centres[cell + 1];
  context.globalAlpha = .92;
  context.drawImage(plate.canvas, centre - w / 2, height * .251, w, h);
  context.globalAlpha = .27;
  context.drawImage(plate.canvas, centre + width / 2 - w * .40, height * .38, w * .80, h * .72);
  context.globalAlpha = 1;
}

export function nebulaTexture(own) {
  const maps = new Map();
  const focus = {value: centres[0]};
  const uniform = {value: null};
  const swatch = document.createElement('canvas');
  swatch.width = 268;
  swatch.height = 129;
  const plate = swatch.getContext('2d');

  function texture(image, cell) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (image) paintNebula(context, plate, image, cell);
    else {
      context.fillStyle = '#08091a';
      context.fillRect(0, 0, width, height);
    }
    const map = own(new THREE.CanvasTexture(canvas));
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.anisotropy = 2;
    return map;
  }

  async function prepare(renderer, isDisposed) {
    const loader = new THREE.ImageLoader();
    const [indigo, panels] = await Promise.all([loader.loadAsync(original.href).catch(() => null),
      loader.loadAsync(atlas.href).catch(() => null)]);
    if (isDisposed()) return;
    const base = texture(indigo, -1);
    maps.set(RIFT_NEBULAS[0], base);
    renderer.initTexture(base);
    for (let i = 1; panels && i < RIFT_NEBULAS.length; i++) {
      const map = texture(panels, i - 1);
      renderer.initTexture(map);
      maps.set(RIFT_NEBULAS[i], map);
    }
    uniform.value = base;
  }

  function show(name) {
    uniform.value = maps.get(name) ?? maps.get(RIFT_NEBULAS[0]);
    focus.value = maps.has(name) ? centres[RIFT_NEBULAS.indexOf(name)] : centres[0];
  }

  return {uniform, prepare, show, focus};
}
