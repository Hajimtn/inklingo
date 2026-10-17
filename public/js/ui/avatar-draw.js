// Small square painter for drawing your own avatar (pen, eraser, background colour, undo).
// Resolves to a 128×128 PNG data URL, or null when cancelled.

import { h, dialog } from './dom.js';
import { icon } from './icons.js';
import { PALETTE } from '../drawing/toolbar.js';

import { tr } from '../i18n.js';
const SIZE = 512;
const OUT = 128;
const COLORS = PALETTE.filter((_, i) => i !== 3 && i !== 7 && i !== 13);
const WIDTHS = [8, 20, 44];

export function drawAvatar(existing = null) {
  const cv = h('canvas.ad-canvas', { width: SIZE, height: SIZE, 'aria-label': tr('Khung vẽ ảnh đại diện') });
  const ctx = cv.getContext('2d');
  let bg = '#fbf3e4';
  let color = '#1b1b1f';
  let width = WIDTHS[1];
  let mode = 'pen';
  const undo = [];
  const paintBg = () => { ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = bg; ctx.fillRect(0, 0, SIZE, SIZE); ctx.restore(); };
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, SIZE, SIZE);
    img.src = existing;
  }
  const snap = () => { undo.push(ctx.getImageData(0, 0, SIZE, SIZE)); if (undo.length > 25) undo.shift(); };

  let last = null;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  const stroke = (a, b) => {
    ctx.strokeStyle = mode === 'eraser' ? bg : color;
    ctx.lineWidth = width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.stroke();
  };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    snap();
    last = pos(e);
    stroke(last, [last[0] + 0.1, last[1]]);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return;
    const p = pos(e);
    stroke(last, p);
    last = p;
  });
  const end = () => (last = null);
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  const swatches = h('div.ad-swatches', COLORS.map((c) => h('button.ad-swatch', {
    type: 'button', 'aria-label': tr('Màu ') + c, style: { background: c }, onclick: (e) => {
      color = c;
      if (mode === 'eraser') setMode('pen');
      swatches.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
      e.currentTarget.classList.add('on');
    },
  })));
  swatches.children[0].classList.add('on');
  const sizes = h('div.ad-sizes', WIDTHS.map((w, i) => h('button.ad-size' + (i === 1 ? '.on' : ''), {
    type: 'button', 'aria-label': tr('Cỡ bút ') + (i + 1), onclick: (e) => {
      width = w;
      sizes.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
      e.currentTarget.classList.add('on');
    },
  }, h('i', { style: { width: 6 + i * 7 + 'px', height: 6 + i * 7 + 'px' } }))));
  const penBtn = h('button.btn.small.on', { type: 'button', onclick: () => setMode('pen') }, icon('pencil', { size: 16 }), tr('Bút'));
  const eraseBtn = h('button.btn.small', { type: 'button', onclick: () => setMode('eraser') }, tr('Tẩy'));
  const setMode = (m) => { mode = m; penBtn.classList.toggle('on', m === 'pen'); eraseBtn.classList.toggle('on', m === 'eraser'); };
  const tools = h('div.ad-tools',
    penBtn, eraseBtn,
    h('button.btn.small', { type: 'button', title: tr('Tô nền bằng màu đang chọn'), onclick: () => { snap(); bg = color; paintBg(); } }, tr('Đổ nền')),
    h('button.btn.small', { type: 'button', 'aria-label': tr('Hoàn tác'), onclick: () => { const d = undo.pop(); if (d) ctx.putImageData(d, 0, 0); } }, icon('back', { size: 16 })),
    h('button.btn.small', { type: 'button', onclick: () => { snap(); bg = '#fbf3e4'; ctx.fillStyle = bg; ctx.fillRect(0, 0, SIZE, SIZE); } }, icon('trash', { size: 16 }), tr('Xóa')));

  const body = h('div.ad-body', h('div.ad-stage', cv), h('div.stack.ad-side', swatches, sizes, tools));
  return dialog({ title: tr('Vẽ ảnh đại diện'), body, className: 'ad-dialog', buttons: [{ label: tr('Hủy'), value: null }, { label: tr('Dùng ảnh này'), value: 'ok', primary: true }] })
    .then((v) => (v === 'ok' ? exportPng(cv) : null));
}

function exportPng(cv) {
  for (const size of [OUT, 96]) {
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const c = out.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(cv, 0, 0, size, size);
    const url = out.toDataURL('image/png');
    if (url.length * 0.75 < 24_000) return url;
  }
  return null;
}

/** Same key the server computes: "p" + first 16 hex of SHA-256 of the PNG bytes. */
export async function avatarKeyOf(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'p' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Upload so other players can see it. Returns false when offline (the avatar still works locally). */
export async function uploadAvatar(dataUrl) {
  try {
    const r = await fetch('api/avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pic: dataUrl }) });
    return r.ok;
  } catch {
    return false;
  }
}
