// Scanline flood fill on RGBA pixel data.
// Pixels are compared in premultiplied space so that fully transparent pixels
// (erased / untouched background) always match each other regardless of their RGB garbage.

export const FILL_TOLERANCE = 40;

/**
 * Returns { mask, ring, bbox, count } where mask marks the matched region and ring marks
 * a 1px border around it (antialiased stroke edges) that should be painted *behind* strokes.
 */
export function floodRegion(data, w, h, sx, sy, tol = FILL_TOLERANCE) {
  sx = Math.max(0, Math.min(w - 1, sx | 0));
  sy = Math.max(0, Math.min(h - 1, sy | 0));
  const n = w * h;
  const i0 = (sy * w + sx) * 4;
  const ta = data[i0 + 3];
  // Integer premultiplied comparison: |c*a - tc*ta| <= tol*255, precomputed once per pixel.
  const tr = data[i0] * ta, tg = data[i0 + 1] * ta, tb = data[i0 + 2] * ta, T = tol * 255;
  const ok = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = data[i + 3];
    const da = a - ta;
    if (da > tol || da < -tol) continue;
    const dr = data[i] * a - tr;
    if (dr > T || dr < -T) continue;
    const dg = data[i + 1] * a - tg;
    if (dg > T || dg < -T) continue;
    const db = data[i + 2] * a - tb;
    if (db > T || db < -T) continue;
    ok[p] = 1;
  }
  const match = (p) => ok[p] === 1;

  const mask = new Uint8Array(n);
  let minX = sx, maxX = sx, minY = sy, maxY = sy, count = 0;
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    const row = y * w;
    if (mask[row + x] || !match(row + x)) continue;
    let l = x, r = x;
    while (l > 0 && !mask[row + l - 1] && match(row + l - 1)) l--;
    while (r < w - 1 && !mask[row + r + 1] && match(row + r + 1)) r++;
    for (let i = l; i <= r; i++) mask[row + i] = 1;
    count += r - l + 1;
    if (l < minX) minX = l;
    if (r > maxX) maxX = r;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let ny = y - 1; ny <= y + 1; ny += 2) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inSpan = false;
      for (let i = l; i <= r; i++) {
        const q = nrow + i;
        const ok = !mask[q] && match(q);
        if (ok && !inSpan) { stack.push(i, ny); inSpan = true; } else if (!ok) inSpan = false;
      }
    }
  }

  // 1px ring (8-neighbourhood) around the region, clipped to the canvas.
  const bx0 = Math.max(0, minX - 1), bx1 = Math.min(w - 1, maxX + 1);
  const by0 = Math.max(0, minY - 1), by1 = Math.min(h - 1, maxY + 1);
  const ring = new Uint8Array(w * h);
  for (let y = by0; y <= by1; y++) {
    const hasUp = y > 0, hasDn = y < h - 1;
    for (let x = bx0; x <= bx1; x++) {
      const p = y * w + x;
      if (mask[p]) continue;
      const l = x > 0, r = x < w - 1;
      if ((l && mask[p - 1]) || (r && mask[p + 1]) ||
        (hasUp && (mask[p - w] || (l && mask[p - w - 1]) || (r && mask[p - w + 1]))) ||
        (hasDn && (mask[p + w] || (l && mask[p + w - 1]) || (r && mask[p + w + 1])))) ring[p] = 1;
    }
  }
  return { mask, ring, count, bbox: { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } };
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
