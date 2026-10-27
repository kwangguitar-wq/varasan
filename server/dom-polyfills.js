// pdf.js expects a DOMMatrix implementation even for text extraction. workerd
// does not provide one, so supply the 2D subset pdf.js uses.

class DOMMatrixPolyfill {
  constructor(init) {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    } else if (init && typeof init === 'object') {
      for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
        if (typeof init[key] === 'number') this[key] = init[key];
      }
    }
  }

  static fromMatrix(matrix) {
    return new DOMMatrixPolyfill([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]);
  }

  static fromFloat32Array(values) {
    return new DOMMatrixPolyfill(Array.from(values));
  }

  static fromFloat64Array(values) {
    return new DOMMatrixPolyfill(Array.from(values));
  }

  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  get is2D() {
    return true;
  }

  multiply(other) {
    const m = other instanceof DOMMatrixPolyfill ? other : new DOMMatrixPolyfill(other);
    const [a1, b1, c1, d1, e1, f1] = [this.a, this.b, this.c, this.d, this.e, this.f];
    return new DOMMatrixPolyfill([
      a1 * m.a + c1 * m.b,
      b1 * m.a + d1 * m.b,
      a1 * m.c + c1 * m.d,
      b1 * m.c + d1 * m.d,
      a1 * m.e + c1 * m.f + e1,
      b1 * m.e + d1 * m.f + f1,
    ]);
  }

  multiplySelf(other) {
    Object.assign(this, this.multiply(other));
    return this;
  }

  translate(x = 0, y = 0) {
    return this.multiply([1, 0, 0, 1, x, y]);
  }

  translateSelf(x = 0, y = 0) {
    Object.assign(this, this.translate(x, y));
    return this;
  }

  scale(x = 1, y = x) {
    return this.multiply([x, 0, 0, y, 0, 0]);
  }

  scaleSelf(x = 1, y = x) {
    Object.assign(this, this.scale(x, y));
    return this;
  }

  rotate(degrees = 0) {
    const radians = (degrees * Math.PI) / 180;
    return this.multiply([Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]);
  }

  rotateSelf(degrees = 0) {
    Object.assign(this, this.rotate(degrees));
    return this;
  }

  inverse() {
    const det = this.a * this.d - this.b * this.c || 1e-12;
    return new DOMMatrixPolyfill([
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    ]);
  }

  invertSelf() {
    Object.assign(this, this.inverse());
    return this;
  }

  transformPoint(point = {}) {
    const x = point.x ?? 0;
    const y = point.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }

  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

export function installDomPolyfills() {
  globalThis.DOMMatrix ??= DOMMatrixPolyfill;
  globalThis.DOMMatrixReadOnly ??= DOMMatrixPolyfill;
}
