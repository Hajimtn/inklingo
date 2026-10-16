// Ghost Sketch: a faint tracing guide drawn on a separate overlay canvas that only the drawer
// sees. It is never part of the drawing document, never sent over the network and never saved.
//
// Sources (no AI involved):
//  * "sketch":  a clean line-art template drawn by hand for the word (public/data/ghosts/<id>.svg)
//  * "outline": edges extracted with a Sobel filter from the word's licensed reference photo
//  * "layout":  simple stick-figure templates hand-designed in code (person, two people, faces…)

import { DOC_W, DOC_H } from '../drawing/engine.js';

const INK = '#3a4a66';

export function clearGhost(canvas) {
  canvas.width = DOC_W;
  canvas.height = DOC_H;
  canvas.getContext('2d').clearRect(0, 0, DOC_W, DOC_H);
}

const sketchCache = new Map();

/** Hand-drawn line-art template (1600×1000 SVG), recoloured to the ghost ink. Resolves false on failure. */
export async function drawSketch(canvas, wordId) {
  clearGhost(canvas);
  let url = sketchCache.get(wordId);
  if (!url) {
    try {
      const res = await fetch(`data/ghosts/${encodeURIComponent(wordId)}.svg`);
      if (!res.ok) return false;
      const svg = (await res.text()).replace(/stroke="#[0-9a-fA-F]{3,6}"/g, `stroke="${INK}"`);
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      sketchCache.set(wordId, url);
    } catch {
      return false;
    }
  }
  const img = await loadImage(url);
  if (!img) return false;
  canvas.getContext('2d').drawImage(img, 0, 0, DOC_W, DOC_H);
  return true;
}

/** Edge outline of the photo, fitted (contain) into the document. Resolves false on failure. */
export async function drawOutline(canvas, src) {
  clearGhost(canvas);
  const img = await loadImage(src);
  if (!img) return false;
  const W = 400, H = 250; // analyse at low resolution, then scale up: cleaner, simpler lines
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, H);
  x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  let data;
  try {
    data = x.getImageData(0, 0, W, H).data;
  } catch {
    return false; // cross-origin image without CORS: cannot be analysed
  }
  let g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  // two 3x3 box-blur passes suppress texture so mostly object contours remain
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(W * H);
    for (let yy = 1; yy < H - 1; yy++) {
      for (let xx = 1; xx < W - 1; xx++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += g[(yy + dy) * W + xx + dx];
        b[yy * W + xx] = sum / 9;
      }
    }
    g = b;
  }
  // only analyse inside the photo (the letterbox border would create fake straight edges)
  const x0 = Math.ceil((W - dw) / 2) + 4, x1 = Math.floor((W + dw) / 2) - 4;
  const y0 = Math.ceil((H - dh) / 2) + 4, y1 = Math.floor((H + dh) / 2) - 4;
  const mag = new Float32Array(W * H);
  const values = [];
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const p = (k, l) => g[(yy + l) * W + xx + k];
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      const m = Math.hypot(gx, gy);
      mag[yy * W + xx] = m;
      values.push(m);
    }
  }
  values.sort((a, z) => a - z);
  const threshold = Math.max(40, values[Math.floor(values.length * 0.92)] || 60); // strongest ~8% edges
  const out = canvas.getContext('2d');
  out.fillStyle = INK;
  const sx = DOC_W / W, sy = DOC_H / H;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = yy * W + xx;
      if (mag[i] < threshold) continue;
      // drop isolated specks: need at least two strong neighbours
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && mag[i + dy * W + dx] >= threshold) n++;
      if (n >= 2) out.fillRect(xx * sx, yy * sy, sx * 0.9, sy * 0.9);
    }
  }
  return true;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ---------------------------------------------------------------- hand-designed layouts

function pen(ctx) {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([22, 16]);
}

function stick(ctx, x, y, s = 1, pose = 'stand') {
  const head = 55 * s;
  ctx.beginPath();
  ctx.arc(x, y, head, 0, Math.PI * 2);
  ctx.moveTo(x, y + head);
  ctx.lineTo(x, y + head + 210 * s);
  if (pose === 'arms-up') {
    ctx.moveTo(x - 110 * s, y - 40 * s);
    ctx.lineTo(x, y + head + 60 * s);
    ctx.lineTo(x + 110 * s, y - 40 * s);
  } else {
    ctx.moveTo(x - 110 * s, y + head + 120 * s);
    ctx.lineTo(x, y + head + 60 * s);
    ctx.lineTo(x + 110 * s, y + head + 120 * s);
  }
  ctx.moveTo(x - 90 * s, y + head + 380 * s);
  ctx.lineTo(x, y + head + 210 * s);
  ctx.lineTo(x + 90 * s, y + head + 380 * s);
  ctx.stroke();
}

const FACES = {
  happy: (c, x, y, r) => { eyesArc(c, x, y, r, true); c.beginPath(); c.arc(x, y + r * 0.1, r * 0.55, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); },
  sad: (c, x, y, r) => { eyesDots(c, x, y, r); c.beginPath(); c.arc(x, y + r * 0.75, r * 0.45, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke(); tear(c, x - r * 0.38, y + r * 0.05, r); },
  angry: (c, x, y, r) => { eyesDots(c, x, y, r); c.beginPath(); c.moveTo(x - r * 0.6, y - r * 0.45); c.lineTo(x - r * 0.15, y - r * 0.22); c.moveTo(x + r * 0.6, y - r * 0.45); c.lineTo(x + r * 0.15, y - r * 0.22); c.moveTo(x - r * 0.4, y + r * 0.5); c.lineTo(x + r * 0.4, y + r * 0.5); c.stroke(); },
  scared: (c, x, y, r) => { eyesBig(c, x, y, r); c.beginPath(); c.ellipse(x, y + r * 0.5, r * 0.18, r * 0.24, 0, 0, Math.PI * 2); c.stroke(); },
  surprised: (c, x, y, r) => { eyesBig(c, x, y, r); c.beginPath(); c.arc(x, y + r * 0.5, r * 0.2, 0, Math.PI * 2); c.moveTo(x - r * 0.6, y - r * 0.6); c.quadraticCurveTo(x - r * 0.35, y - r * 0.8, x - r * 0.1, y - r * 0.6); c.moveTo(x + r * 0.1, y - r * 0.6); c.quadraticCurveTo(x + r * 0.35, y - r * 0.8, x + r * 0.6, y - r * 0.6); c.stroke(); },
  tired: (c, x, y, r) => { c.beginPath(); c.moveTo(x - r * 0.55, y - r * 0.15); c.lineTo(x - r * 0.2, y - r * 0.15); c.moveTo(x + r * 0.2, y - r * 0.15); c.lineTo(x + r * 0.55, y - r * 0.15); c.stroke(); c.beginPath(); c.ellipse(x, y + r * 0.5, r * 0.25, r * 0.18, 0, 0, Math.PI * 2); c.stroke(); },
  bored: (c, x, y, r) => { c.beginPath(); c.moveTo(x - r * 0.55, y - r * 0.1); c.lineTo(x - r * 0.2, y - r * 0.1); c.moveTo(x + r * 0.2, y - r * 0.1); c.lineTo(x + r * 0.55, y - r * 0.1); c.moveTo(x - r * 0.35, y + r * 0.5); c.lineTo(x + r * 0.35, y + r * 0.5); c.stroke(); },
  calm: (c, x, y, r) => { eyesArc(c, x, y, r, false); c.beginPath(); c.arc(x, y + r * 0.25, r * 0.3, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); },
  confused: (c, x, y, r) => { eyesDots(c, x, y, r); c.beginPath(); c.moveTo(x - r * 0.6, y - r * 0.5); c.lineTo(x - r * 0.15, y - r * 0.45); c.moveTo(x + r * 0.15, y - r * 0.7); c.lineTo(x + r * 0.6, y - r * 0.55); c.moveTo(x - r * 0.4, y + r * 0.5); c.bezierCurveTo(x - r * 0.15, y + r * 0.35, x + r * 0.1, y + r * 0.65, x + r * 0.4, y + r * 0.45); c.stroke(); },
  embarrassed: (c, x, y, r) => { eyesArc(c, x, y, r, true); c.beginPath(); for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { c.moveTo(x + sx * (r * 0.45 + i * r * 0.1), y + r * 0.2); c.lineTo(x + sx * (r * 0.4 + i * r * 0.1), y + r * 0.35); } c.moveTo(x - r * 0.2, y + r * 0.55); c.lineTo(x + r * 0.2, y + r * 0.55); c.stroke(); },
  disgusted: (c, x, y, r) => { c.beginPath(); c.moveTo(x - r * 0.55, y - r * 0.2); c.lineTo(x - r * 0.2, y - r * 0.1); c.moveTo(x + r * 0.55, y - r * 0.2); c.lineTo(x + r * 0.2, y - r * 0.1); c.moveTo(x - r * 0.4, y + r * 0.45); c.lineTo(x + r * 0.4, y + r * 0.45); c.stroke(); c.beginPath(); c.ellipse(x, y + r * 0.62, r * 0.14, r * 0.18, 0, 0, Math.PI); c.stroke(); },
};
function eyesDots(c, x, y, r) { c.beginPath(); c.arc(x - r * 0.35, y - r * 0.15, r * 0.08, 0, Math.PI * 2); c.moveTo(x + r * 0.43, y - r * 0.15); c.arc(x + r * 0.35, y - r * 0.15, r * 0.08, 0, Math.PI * 2); c.stroke(); }
function eyesBig(c, x, y, r) { c.beginPath(); c.moveTo(x - r * 0.17, y - r * 0.15); c.arc(x - r * 0.35, y - r * 0.15, r * 0.18, 0, Math.PI * 2); c.moveTo(x + r * 0.53, y - r * 0.15); c.arc(x + r * 0.35, y - r * 0.15, r * 0.18, 0, Math.PI * 2); c.stroke(); }
function eyesArc(c, x, y, r, up) { c.beginPath(); for (const ex of [-0.35, 0.35]) { c.moveTo(x + r * (ex - 0.15), y - r * 0.12); c.quadraticCurveTo(x + r * ex, y - r * (up ? 0.32 : -0.05), x + r * (ex + 0.15), y - r * 0.12); } c.stroke(); }
function tear(c, x, y, r) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - r * 0.1, y + r * 0.25, x, y + r * 0.3); c.quadraticCurveTo(x + r * 0.1, y + r * 0.25, x, y); c.stroke(); }

export const LAYOUTS = {
  person: (c) => stick(c, 800, 250, 1.3),
  'two-people': (c) => { stick(c, 560, 260, 1.15); stick(c, 1040, 260, 1.15); },
  group: (c) => { stick(c, 420, 300, 1); stick(c, 680, 260, 1.1); stick(c, 940, 260, 1.1); stick(c, 1200, 300, 1); },
  'before-after': (c) => {
    c.strokeRect(120, 150, 560, 700);
    c.strokeRect(920, 150, 560, 700);
    c.beginPath();
    c.moveTo(720, 500); c.lineTo(880, 500); c.moveTo(840, 455); c.lineTo(885, 500); c.lineTo(840, 545);
    c.stroke();
    c.setLineDash([]);
    c.font = 'bold 54px Nunito, sans-serif';
    c.fillText('TRƯỚC', 300, 130);
    c.fillText('SAU', 1140, 130);
  },
  face: (c, mood = 'happy') => {
    const x = 800, y = 500, r = 360;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    (FACES[mood] || FACES.happy)(c, x, y, r);
  },
};

/** spec: "person" | "two-people" | "group" | "before-after" | "face:<mood>" */
export function drawLayout(canvas, spec) {
  clearGhost(canvas);
  const [name, arg] = String(spec || '').split(':');
  const fn = LAYOUTS[name];
  if (!fn) return false;
  const ctx = canvas.getContext('2d');
  pen(ctx);
  fn(ctx, arg);
  return true;
}
