import * as THREE from 'three';
import {RIFT_NEBULAS} from './rift-rules.js?v=26';

const width = 1536;
const height = 768;
const sourceRoot = new URL('../assets/textures/', import.meta.url);
const original = new URL('rift-nebula-v25.jpg', sourceRoot);
const atlas = new URL('rift-nebulas-v26.png', sourceRoot);

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

function paintAtlas(context, plate, image, index) {
  const column = index % 2, row = Math.floor(index / 2);
  // Inset the cell so filtering never borrows the colour of a neighbouring panel.
  const x = Math.round(image.width * column / 2) + 4, y = Math.round(image.height * row / 3) + 4;
  const endX = Math.round(image.width * (column + 1) / 2) - 4, endY = Math.round(image.height * (row + 1) / 3) - 4;
  const w = plate.canvas.width, h = plate.canvas.height;
  plate.clearRect(0, 0, w, h);
  plate.drawImage(image, x, y, endX - x, endY - y, 0, 0, w, h);
  feather(plate, w, h);

  context.fillStyle = '#08091a';
  context.fillRect(0, 0, width, height);
  const centre = width * [.27, .29, .22, .24, .26, .26][index];
  for (const turn of [-width, 0, width]) {
    const start = centre - w / 2 + turn;
    // A dim field on the far side keeps the entire dome continuous.
    context.globalAlpha = .26;
    context.drawImage(plate.canvas, start + width / 2, height * .12, w, h);
    context.globalAlpha = .81;
    context.drawImage(plate.canvas, start, height * .14, w, h);
  }
  context.globalAlpha = 1;
}

export function nebulaTexture(own) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#08091a';
  context.fillRect(0, 0, width, height);
  const map = own(new THREE.CanvasTexture(canvas));
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 2;

  const swatch = document.createElement('canvas');
  swatch.width = 1014;
  swatch.height = 555;
  const plate = swatch.getContext('2d');
  const loader = new THREE.ImageLoader();
  let atlasRequest, originalRequest, revision = 0;

  const loadAtlas = () => atlasRequest ??= loader.loadAsync(atlas.href).catch(error => {
    atlasRequest = null;
    throw error;
  });
  const paintOriginal = async stamp => {
    originalRequest ??= loader.loadAsync(original.href).catch(error => {
      originalRequest = null;
      throw error;
    });
    const image = await originalRequest;
    if (stamp !== revision) return;
    context.drawImage(image, 0, 0, width, height);
    map.needsUpdate = true;
  };
  async function show(name) {
    const stamp = ++revision, cell = RIFT_NEBULAS.indexOf(name) - 1;
    try {
      if (cell < 0) await paintOriginal(stamp);
      else {
        const image = await loadAtlas();
        if (stamp !== revision) return;
        paintAtlas(context, plate, image, cell);
        map.needsUpdate = true;
      }
    } catch {
      if (cell >= 0 && stamp === revision) await paintOriginal(stamp).catch(() => {});
    }
  }
  map.addEventListener('dispose', () => { revision++; });
  return {map, show};
}
