import {Box3} from 'three';

const CELL = 36;

export class Airspace {
  constructor() {
    this.cells = new Map();
    this.bounds = new Box3();
  }

  addPlacement(bounds, matrix, relief = 0) {
    this.bounds.copy(bounds).applyMatrix4(matrix);
    this.bounds.max.y += relief;
    this.addBounds(this.bounds);
  }

  addBounds({min, max}) {
    if (max.y < min.y) return;
    const entry = {left: min.x, right: max.x, near: min.z, far: max.z, top: max.y};
    for (let z = Math.floor(min.z / CELL); z <= Math.floor(max.z / CELL); z++) {
      for (let x = Math.floor(min.x / CELL); x <= Math.floor(max.x / CELL); x++) {
        const key = x + ',' + z;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(entry);
      }
    }
  }

  addSurface(vertices, columns) {
    const stride = 3 * columns;
    for (let row = 0; row + stride < vertices.length; row += stride) {
      for (let column = 0; column < stride - 3; column += 3) {
        const a = row + column, b = a + 3, c = a + stride, d = b + stride;
        const {min, max} = this.bounds;
        for (let axis = 0; axis < 3; axis++) {
          const va = vertices[a + axis], vb = vertices[b + axis], vc = vertices[c + axis], vd = vertices[d + axis];
          min.setComponent(axis, Math.min(va, vb, vc, vd));
          max.setComponent(axis, Math.max(va, vb, vc, vd));
        }
        this.addBounds(this.bounds);
      }
    }
  }

  obstacleTop(x, z, radius) {
    const left = x - radius, right = x + radius, near = z - radius, far = z + radius;
    let top = -Infinity;
    for (let j = Math.floor(near / CELL); j <= Math.floor(far / CELL); j++) {
      for (let i = Math.floor(left / CELL); i <= Math.floor(right / CELL); i++) {
        for (const item of this.cells.get(i + ',' + j) ?? []) {
          if (item.right >= left && item.left <= right && item.far >= near && item.near <= far) top = Math.max(top, item.top);
        }
      }
    }
    return top;
  }
}
