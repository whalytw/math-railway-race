import * as THREE from 'three';
import {RIFT_NEBULAS} from './rift-rules.js?v=27';

const width = 1536;
const height = 768;
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
  swatch.width = 402;
  swatch.height = 194;
  const plate = swatch.getContext('2d');
  const loader = new THREE.ImageLoader();
  const focus = {value: centres[0]};
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
    paintNebula(context, plate, image, -1);
    focus.value = centres[0];
    map.needsUpdate = true;
  };
  async function show(name) {
    const stamp = ++revision, cell = RIFT_NEBULAS.indexOf(name) - 1;
    try {
      if (cell < 0) await paintOriginal(stamp);
      else {
        const image = await loadAtlas();
        if (stamp !== revision) return;
        paintNebula(context, plate, image, cell);
        focus.value = centres[cell + 1];
        map.needsUpdate = true;
      }
    } catch {
      if (cell >= 0 && stamp === revision) await paintOriginal(stamp).catch(() => {});
    }
  }
  map.addEventListener('dispose', () => { revision++; });
  return {map, show, focus};
}
