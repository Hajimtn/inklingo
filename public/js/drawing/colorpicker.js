// Hue ring + saturation/value triangle colour picker (the "colour picker triangle" style
// mentioned in Scribble It!'s patch notes). Self-drawn; no third-party assets.

import { hexToRgb, rgbToHex } from './flood.js';

const TAU = Math.PI * 2;

function hueRgb(h) {
  // h in [0,1) -> fully saturated rgb 0..255
  const k = (n) => (n + h * 6) % 6;
  const f = (n) => 255 * (1 - Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return [f(5), f(3), f(1)];
}

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

export class ColorTriangle {
  constructor(canvas, onChange) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.h = 0; this.a = 1; this.b = 0; // barycentric weights: hue, white (black = 1-a-b)
    this.drag = null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = canvas.width = canvas.height = Math.round(200 * dpr);
    canvas.style.width = canvas.style.height = '200px';
    this.R = this.size / 2;
    this.ringIn = this.R * 0.8;
    this.triR = this.R * 0.76;
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', () => (this.drag = null));
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    this.draw();
  }

  _verts() {
    const ang = this.h * TAU, R = this.R, t = this.triR;
    const at = (o) => [R + Math.cos(ang + o) * t, R - Math.sin(ang + o) * t];
    return [at(0), at((2 * TAU) / 3), at(TAU / 3)]; // hue, black, white (counter-clockwise)
  }

  setHex(hex) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max !== min) this.h = rgbToHue(r, g, b);
    this.a = (max - min) / 255;
    this.b = min / 255;
    this.draw();
  }

  hex() {
    const [hr, hg, hb] = hueRgb(this.h);
    const w = this.b * 255;
    return rgbToHex(hr * this.a + w, hg * this.a + w, hb * this.a + w);
  }

  draw() {
    const { ctx, size, R } = this;
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const [V0, V1, V2] = this._verts();
    const [hr, hg, hb] = hueRgb(this.h);
    const det = (V1[1] - V2[1]) * (V0[0] - V2[0]) + (V2[0] - V1[0]) * (V0[1] - V2[1]);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const dx = x - R, dy = y - R, dist = Math.hypot(dx, dy);
        if (dist <= R && dist >= this.ringIn) {
          let hh = Math.atan2(-dy, dx) / TAU;
          if (hh < 0) hh += 1;
          const [r, g, b] = hueRgb(hh);
          const edge = Math.min(1, R - dist, dist - this.ringIn);
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255 * Math.max(0, Math.min(1, edge + 0.5));
          continue;
        }
        const l0 = ((V1[1] - V2[1]) * (x - V2[0]) + (V2[0] - V1[0]) * (y - V2[1])) / det;
        const l1 = ((V2[1] - V0[1]) * (x - V2[0]) + (V0[0] - V2[0]) * (y - V2[1])) / det;
        const l2 = 1 - l0 - l1;
        if (l0 >= -0.004 && l1 >= -0.004 && l2 >= -0.004) {
          const a = Math.max(0, l0), w = Math.max(0, l2) * 255;
          d[i] = hr * a + w; d[i + 1] = hg * a + w; d[i + 2] = hb * a + w; d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // markers
    const ang = this.h * TAU;
    const mr = (R + this.ringIn) / 2;
    this._marker(R + Math.cos(ang) * mr, R - Math.sin(ang) * mr);
    const c = 1 - this.a - this.b;
    this._marker(V0[0] * this.a + V1[0] * c + V2[0] * this.b, V0[1] * this.a + V1[1] * c + V2[1] * this.b);
  }

  _marker(x, y) {
    const ctx = this.ctx, s = this.size / 200;
    ctx.beginPath();
    ctx.arc(x, y, 6 * s, 0, TAU);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }

  _pos(e) {
    const r = this.c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.size, ((e.clientY - r.top) / r.height) * this.size];
  }

  _down(e) {
    const [x, y] = this._pos(e);
    const dist = Math.hypot(x - this.R, y - this.R);
    this.drag = dist >= this.ringIn - 2 ? 'ring' : 'tri';
    this.c.setPointerCapture(e.pointerId);
    this._apply(x, y);
  }

  _move(e) {
    if (!this.drag) return;
    const [x, y] = this._pos(e);
    this._apply(x, y);
  }

  _apply(x, y) {
    if (this.drag === 'ring') {
      let hh = Math.atan2(-(y - this.R), x - this.R) / TAU;
      if (hh < 0) hh += 1;
      this.h = hh;
    } else {
      const [V0, V1, V2] = this._verts();
      const det = (V1[1] - V2[1]) * (V0[0] - V2[0]) + (V2[0] - V1[0]) * (V0[1] - V2[1]);
      let l0 = ((V1[1] - V2[1]) * (x - V2[0]) + (V2[0] - V1[0]) * (y - V2[1])) / det;
      let l1 = ((V2[1] - V0[1]) * (x - V2[0]) + (V0[0] - V2[0]) * (y - V2[1])) / det;
      let l2 = 1 - l0 - l1;
      // clamp into the triangle
      l0 = Math.max(0, l0); l1 = Math.max(0, l1); l2 = Math.max(0, l2);
      const s = l0 + l1 + l2 || 1;
      this.a = l0 / s;
      this.b = l2 / s;
    }
    this.draw();
    this.onChange(this.hex());
  }
}
