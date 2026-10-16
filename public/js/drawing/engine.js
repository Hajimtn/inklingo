// DrawingEngine — vector operation log rendered onto a fixed-resolution raster document.
//
// * All coordinates live in a logical space of DOC_W x DOC_H, independent of the on-screen size,
//   so resizing the window never loses the drawing and every client renders identical pixels.
// * The visible <canvas> is re-sized to (css size x devicePixelRatio) for sharp HiDPI output.
// * Every change is an "op" (stroke / shape / fill / clear). Undo/redo replays the op log from the
//   nearest checkpoint, so it works for strokes, fills, erasing and clearing alike.
// * The same ops are emitted as network events so guessers can replay them in realtime.

import { floodRegion, hexToRgb, rgbToHex } from './flood.js';

export const DOC_W = 1600;
export const DOC_H = 1000;
const CHECKPOINT_EVERY = 12;
const MAX_CHECKPOINTS = 10;
const MAX_OPS = 400;
const LIVE_FLUSH_MS = 40;

const SHAPES = new Set(['line', 'rect', 'ellipse']);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const r1 = (v) => Math.round(v * 10) / 10;

// ---------- pure renderers (shared by local drawing, replay and remote playback) ----------

export function traceStroke(ctx, op) {
  const p = op.pts;
  ctx.lineWidth = op.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = op.tool === 'eraser' ? '#000' : op.color;
  if (p.length <= 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], op.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 4) {
    ctx.lineTo(p[2], p[3]);
  } else {
    // Quadratic curves through midpoints give a smooth line even with sparse samples.
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  }
  ctx.stroke();
}

export function traceShape(ctx, op) {
  ctx.lineWidth = op.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = op.color;
  ctx.beginPath();
  if (op.kind === 'line') {
    ctx.moveTo(op.x1, op.y1);
    ctx.lineTo(op.x2, op.y2);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(op.cx, op.cy);
  ctx.rotate(op.rot || 0);
  if (op.kind === 'rect') ctx.rect(-op.w / 2, -op.h / 2, op.w, op.h);
  else ctx.ellipse(0, 0, Math.max(0.5, op.w / 2), Math.max(0.5, op.h / 2), 0, 0, Math.PI * 2);
  ctx.restore();
  if (op.fill) ctx.fill();
  ctx.stroke();
}

function traceOp(ctx, op) {
  if (op.t === 'stroke') traceStroke(ctx, op);
  else if (op.t === 'shape') traceShape(ctx, op);
}

export class DrawingEngine {
  constructor({ canvas, wrap, cursor }) {
    this.view = canvas;
    this.viewCtx = canvas.getContext('2d');
    this.wrap = wrap;
    this.cursor = cursor || null;

    this.doc = makeCanvas(DOC_W, DOC_H);
    this.docCtx = this.doc.getContext('2d', { willReadFrequently: true });
    this.scratch = makeCanvas(DOC_W, DOC_H); // per-op compositing (opacity / fill)
    this.scratchCtx = this.scratch.getContext('2d');
    this.liveLayer = makeCanvas(DOC_W, DOC_H); // in-progress stroke or shape
    this.liveCtx = this.liveLayer.getContext('2d');
    this.preview = makeCanvas(DOC_W, DOC_H); // eraser preview composition
    this.previewCtx = this.preview.getContext('2d');

    this.ops = [];
    this.redoStack = [];
    this.checkpoints = new Map();

    this.state = { tool: 'brush', color: '#1b1b1f', size: 8, alpha: 1, fillShapes: false };
    this.enabled = false;
    this.live = null; // local live op
    this.remoteLive = null; // live op received from the network
    this.pointerId = null;
    this.mods = { shift: false, ctrl: false };
    this.listeners = { event: [], pick: [], size: [], history: [] };
    this.renderQueued = false;
    this.liveSeq = 0;
    this.livePending = null;
    this.liveTimer = null;

    this._bindInput();
    this._observeResize();
    this.resize();
  }

  on(type, fn) {
    this.listeners[type].push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }
  _emit(type, data) {
    for (const fn of this.listeners[type]) fn(data);
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this._updateCursor();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this._cancelLive(true);
    this.view.style.cursor = on ? 'none' : 'default';
    if (this.cursor) this.cursor.hidden = true;
  }

  // ---------------- sizing / rendering ----------------

  _observeResize() {
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.view);
    }
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.view.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.view.width !== w || this.view.height !== h) {
      this.view.width = w;
      this.view.height = h;
    }
    this.render();
  }

  invalidate() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render() {
    const ctx = this.viewCtx, c = this.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const live = this.live || this.remoteLive;
    if (live) this._drawLiveLayer(live);
    if (live && live.tool === 'eraser') {
      const p = this.previewCtx;
      p.globalCompositeOperation = 'copy';
      p.drawImage(this.doc, 0, 0);
      p.globalCompositeOperation = 'destination-out';
      p.drawImage(this.liveLayer, 0, 0);
      p.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.preview, 0, 0, c.width, c.height);
    } else {
      ctx.drawImage(this.doc, 0, 0, c.width, c.height);
      if (live) {
        ctx.globalAlpha = live.alpha;
        ctx.drawImage(this.liveLayer, 0, 0, c.width, c.height);
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawLiveLayer(op) {
    const l = this.liveCtx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, DOC_W, DOC_H);
    if (op.t === 'stroke' && op.pts.length) traceStroke(l, op);
    else if (op.t === 'shape') traceShape(l, op);
  }

  // ---------------- op application / history ----------------

  _applyOp(op) {
    this._rasterOp(op);
    // Chrome may rasterize batched paths with a different antialiasing mode than paths drawn
    // one at a time. Reading one pixel flushes the op, so live drawing, undo-replay and remote
    // replay all produce byte-identical documents.
    this.docCtx.getImageData(0, 0, 1, 1);
  }

  _rasterOp(op) {
    const d = this.docCtx;
    if (op.t === 'clear') {
      d.clearRect(0, 0, DOC_W, DOC_H);
      return;
    }
    if (op.t === 'fill') {
      this._applyFill(op);
      return;
    }
    const eraser = op.tool === 'eraser';
    if (op.alpha >= 1) {
      d.save();
      if (eraser) d.globalCompositeOperation = 'destination-out';
      traceOp(d, op);
      d.restore();
      return;
    }
    // Translucent: render opaque into scratch first, then composite once so overlapping
    // segments of the same stroke do not darken.
    const s = this.scratchCtx;
    s.clearRect(0, 0, DOC_W, DOC_H);
    traceOp(s, op);
    d.save();
    d.globalAlpha = op.alpha;
    d.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    d.drawImage(this.scratch, 0, 0);
    d.restore();
  }

  _applyFill(op) {
    const img = this.docCtx.getImageData(0, 0, DOC_W, DOC_H);
    const { mask, ring, bbox, count } = floodRegion(img.data, DOC_W, DOC_H, Math.floor(op.x), Math.floor(op.y));
    if (!count) return;
    const [r, g, b] = hexToRgb(op.color);
    const paint = (sel, mode) => {
      const out = this.scratchCtx.createImageData(bbox.w, bbox.h);
      const o = out.data;
      for (let y = 0; y < bbox.h; y++) {
        const row = (bbox.y + y) * DOC_W + bbox.x;
        for (let x = 0; x < bbox.w; x++) {
          if (!sel[row + x]) continue;
          const i = (y * bbox.w + x) * 4;
          o[i] = r; o[i + 1] = g; o[i + 2] = b; o[i + 3] = 255;
        }
      }
      this.scratchCtx.clearRect(0, 0, bbox.w, bbox.h);
      this.scratchCtx.putImageData(out, 0, 0);
      const d = this.docCtx;
      d.save();
      d.globalAlpha = op.alpha;
      d.globalCompositeOperation = mode;
      d.drawImage(this.scratch, 0, 0, bbox.w, bbox.h, bbox.x, bbox.y, bbox.w, bbox.h);
      d.restore();
    };
    paint(mask, 'source-over');
    // The ring covers antialiased stroke edges: painting it *behind* existing pixels
    // closes the white halo without thinning the outline.
    paint(ring, 'destination-over');
  }

  _fillWouldChange(x, y, color, alpha) {
    const px = this.docCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    const [r, g, b] = hexToRgb(color);
    return !(alpha >= 1 && px[3] === 255 && px[0] === r && px[1] === g && px[2] === b);
  }

  _commit(op, emit) {
    this.ops.push(op);
    this.redoStack.length = 0;
    this._applyOp(op);
    this._checkpoint();
    if (this.ops.length > MAX_OPS) this._compact();
    if (emit) this._emit('event', { k: 'op', op });
    this._emitHistory();
    this.invalidate();
  }

  _checkpoint() {
    const n = this.ops.length;
    if (n === 0 || n % CHECKPOINT_EVERY !== 0) return;
    const c = makeCanvas(DOC_W, DOC_H);
    c.getContext('2d').drawImage(this.doc, 0, 0);
    this.checkpoints.set(n, c);
    if (this.checkpoints.size > MAX_CHECKPOINTS) {
      const oldest = Math.min(...this.checkpoints.keys());
      this.checkpoints.delete(oldest);
    }
  }

  // Keep memory bounded on very long drawings: fold the oldest ops into a base image.
  _compact() {
    const keep = MAX_OPS - 100;
    const fold = this.ops.length - keep;
    const ck = [...this.checkpoints.keys()].filter((k) => k <= fold).sort((a, b) => b - a)[0];
    if (!ck) return;
    const base = this.checkpoints.get(ck);
    this.base = base;
    this.ops = this.ops.slice(ck);
    const next = new Map();
    for (const [k, v] of this.checkpoints) if (k > ck) next.set(k - ck, v);
    this.checkpoints = next;
  }

  _rebuild() {
    const n = this.ops.length;
    let from = 0;
    for (const k of this.checkpoints.keys()) if (k <= n && k > from) from = k;
    const d = this.docCtx;
    d.clearRect(0, 0, DOC_W, DOC_H);
    if (from) d.drawImage(this.checkpoints.get(from), 0, 0);
    else if (this.base) d.drawImage(this.base, 0, 0);
    for (let i = from; i < n; i++) this._applyOp(this.ops[i]);
  }

  undo(emit = true) {
    if (!this.ops.length) return false;
    this._cancelLive(emit);
    this.redoStack.push(this.ops.pop());
    for (const k of [...this.checkpoints.keys()]) if (k > this.ops.length) this.checkpoints.delete(k);
    this._rebuild();
    if (emit) this._emit('event', { k: 'undo' });
    this._emitHistory();
    this.invalidate();
    return true;
  }

  redo(emit = true) {
    if (!this.redoStack.length) return false;
    this._cancelLive(emit);
    const op = this.redoStack.pop();
    this.ops.push(op);
    this._applyOp(op);
    this._checkpoint();
    if (emit) this._emit('event', { k: 'redo' });
    this._emitHistory();
    this.invalidate();
    return true;
  }

  clear(emit = true) {
    if (!this.ops.length && !this.base) return;
    this._commit({ t: 'clear' }, emit);
  }

  /** Wipe everything including history (new turn). */
  reset() {
    this._cancelLive(false);
    this.remoteLive = null;
    this.ops = [];
    this.redoStack = [];
    this.checkpoints.clear();
    this.base = null;
    this.docCtx.clearRect(0, 0, DOC_W, DOC_H);
    this._emitHistory();
    this.invalidate();
  }

  get canUndo() { return this.ops.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  _emitHistory() { this._emit('history', { canUndo: this.canUndo, canRedo: this.canRedo }); }

  /** Replay a full event log (used when joining mid-turn). */
  loadEvents(events) {
    this.reset();
    for (const ev of events) this.applyRemote(ev, true);
    this.invalidate();
  }

  applyRemote(ev, batch = false) {
    switch (ev.k) {
      case 'op':
        this.remoteLive = null;
        this._commit(ev.op, false);
        break;
      case 'undo': this.remoteLive = null; this.undo(false); break;
      case 'redo': this.remoteLive = null; this.redo(false); break;
      case 'lv': { // live stroke points
        if (!this.remoteLive || this.remoteLive.id !== ev.id) {
          if (!ev.h) return;
          this.remoteLive = { ...ev.h, id: ev.id, pts: [] };
        }
        const pts = this.remoteLive.pts;
        pts.length = ev.i; // tolerate re-sent segments
        for (const v of ev.p) pts.push(v);
        break;
      }
      case 'ls': this.remoteLive = ev.op; break;
      case 'lx': this.remoteLive = null; break;
      default: return;
    }
    if (!batch) this.invalidate();
  }

  // ---------------- export ----------------

  /** Composite on white (the document itself keeps a transparent background). */
  exportCanvas(scale = 1) {
    const w = Math.round(DOC_W * scale), h = Math.round(DOC_H * scale);
    const c = makeCanvas(w, h);
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.doc, 0, 0, w, h);
    return c;
  }

  toDataURL(type = 'image/png', scale = 1, quality = 0.85) {
    return this.exportCanvas(scale).toDataURL(type, quality);
  }

  isBlank() {
    const d = this.docCtx.getImageData(0, 0, DOC_W, DOC_H).data;
    for (let i = 3; i < d.length; i += 64) if (d[i] > 8) return false;
    return true;
  }

  pickColor(x, y) {
    const d = this.docCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    const a = d[3] / 255; // composite over the white paper
    return rgbToHex(d[0] * a + 255 * (1 - a), d[1] * a + 255 * (1 - a), d[2] * a + 255 * (1 - a));
  }

  // ---------------- input ----------------

  toDoc(e) {
    const r = this.view.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * DOC_W, y: ((e.clientY - r.top) / r.height) * DOC_H };
  }

  _bindInput() {
    const v = this.view;
    v.addEventListener('pointerdown', (e) => this._down(e));
    v.addEventListener('pointermove', (e) => this._move(e));
    v.addEventListener('pointerup', (e) => this._up(e));
    v.addEventListener('pointercancel', (e) => this._up(e, true));
    v.addEventListener('lostpointercapture', (e) => { if (e.pointerId === this.pointerId) this._up(e); });
    v.addEventListener('pointerleave', () => { if (this.cursor && this.pointerId === null) this.cursor.hidden = true; });
    v.addEventListener('pointerenter', (e) => this._moveCursor(e));
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    v.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const s = this.state.size;
      const step = s < 10 ? 1 : s < 30 ? 2 : 4;
      const size = Math.max(2, Math.min(80, s + (e.deltaY < 0 ? step : -step)));
      this.setState({ size });
      this._emit('size', size);
    }, { passive: false });
    const modKeys = (e) => {
      const shift = e.shiftKey, ctrl = e.ctrlKey || e.metaKey;
      if (shift === this.mods.shift && ctrl === this.mods.ctrl) return;
      this._setMods(shift, ctrl);
    };
    window.addEventListener('keydown', modKeys);
    window.addEventListener('keyup', modKeys);
    window.addEventListener('blur', () => this._setMods(false, false));
  }

  _setMods(shift, ctrl) {
    const was = this.mods.ctrl;
    this.mods.shift = shift;
    this.mods.ctrl = ctrl;
    const op = this.live;
    if (!op || op.t !== 'shape' || !this.lastPoint) return;
    if (ctrl && !was) this._beginRotate(this.lastPoint);
    if (!ctrl && was) this._endRotate();
    this._updateShape(this.lastPoint);
  }

  _down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.pointerId !== null) {
      // A second finger: treat as a gesture and cancel the current mark.
      if (e.pointerType === 'touch') this._cancelLive(true);
      return;
    }
    e.preventDefault();
    const p = this.toDoc(e);
    const { tool, color, size, alpha, fillShapes } = this.state;
    this._moveCursor(e);
    if (tool === 'picker') {
      this._emit('pick', this.pickColor(p.x, p.y));
      return;
    }
    if (tool === 'fill') {
      if (p.x < 0 || p.y < 0 || p.x >= DOC_W || p.y >= DOC_H) return;
      if (this._fillWouldChange(p.x, p.y, color, alpha)) this._commit({ t: 'fill', x: Math.floor(p.x), y: Math.floor(p.y), color, alpha }, true);
      return;
    }
    this.pointerId = e.pointerId;
    try { this.view.setPointerCapture(e.pointerId); } catch {}
    this.mods.shift = e.shiftKey;
    this.mods.ctrl = e.ctrlKey || e.metaKey;
    this.lastPoint = p;
    if (tool === 'brush' || tool === 'eraser') {
      this.live = { t: 'stroke', tool, color, size, alpha: tool === 'eraser' ? 1 : alpha, pts: [r1(p.x), r1(p.y)] };
      this.liveId = ++this.liveSeq;
      this.liveSent = 0;
    } else if (SHAPES.has(tool)) {
      this.anchor = p;
      this.rotation = 0;
      this.rotating = null;
      this.live = tool === 'line'
        ? { t: 'shape', kind: 'line', color, size, alpha, x1: r1(p.x), y1: r1(p.y), x2: r1(p.x), y2: r1(p.y) }
        : { t: 'shape', kind: tool, fill: !!fillShapes, color, size, alpha, cx: r1(p.x), cy: r1(p.y), w: 0, h: 0, rot: 0 };
      if (this.mods.ctrl) this._beginRotate(p);
    }
    this._scheduleLive();
    this.invalidate();
  }

  _move(e) {
    this._moveCursor(e);
    if (e.pointerId !== this.pointerId || !this.live) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const list = events.length ? events : [e];
    if (this.live.t === 'stroke') {
      const pts = this.live.pts;
      for (const ce of list) {
        const p = this.toDoc(ce);
        const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
        if (Math.hypot(p.x - lx, p.y - ly) < 0.8) continue;
        pts.push(r1(p.x), r1(p.y));
      }
    } else {
      const p = this.toDoc(list[list.length - 1]);
      this.lastPoint = p;
      this.mods.shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl !== this.mods.ctrl) { this._setMods(e.shiftKey, ctrl); return; }
      this._updateShape(p);
    }
    this._scheduleLive();
    this.invalidate();
  }

  _up(e, cancelled = false) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const op = this.live;
    this.live = null;
    this._flushLive(true);
    if (!op || cancelled) {
      this._emit('event', { k: 'lx' });
      this.invalidate();
      return;
    }
    if (op.t === 'shape') {
      const tiny = op.kind === 'line' ? Math.hypot(op.x2 - op.x1, op.y2 - op.y1) < 1 : op.w < 1 && op.h < 1;
      if (tiny) { this._emit('event', { k: 'lx' }); this.invalidate(); return; }
    }
    this._commit(op, true);
  }

  _cancelLive(emit) {
    if (!this.live) return;
    this.live = null;
    this.pointerId = null;
    clearTimeout(this.liveTimer);
    this.liveTimer = null;
    if (emit) this._emit('event', { k: 'lx' });
    this.invalidate();
  }

  // --- shapes: Shift = equilateral (square / circle / 15° line), Ctrl held = rotate ---

  _beginRotate(p) {
    const op = this.live;
    const c = op.kind === 'line' ? { x: (op.x1 + op.x2) / 2, y: (op.y1 + op.y2) / 2 } : { x: op.cx, y: op.cy };
    this.rotating = {
      c,
      ref: Math.atan2(p.y - c.y, p.x - c.x),
      base: op.kind === 'line' ? 0 : op.rot || 0,
      line: op.kind === 'line' ? { x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2 } : null,
    };
  }

  _endRotate() {
    const op = this.live;
    if (op && op.kind === 'line') this.anchor = { x: op.x1, y: op.y1 };
    else if (op) {
      // Keep the shape where it is: the anchor becomes the rotated corner opposite the pointer.
      this.rotation = op.rot;
      const cos = Math.cos(op.rot), sin = Math.sin(op.rot);
      const hx = -op.w / 2 * Math.sign(this.signX || 1), hy = -op.h / 2 * Math.sign(this.signY || 1);
      this.anchor = { x: op.cx + hx * cos - hy * sin, y: op.cy + hx * sin + hy * cos };
    }
    this.rotating = null;
  }

  _updateShape(p) {
    const op = this.live;
    if (this.rotating) {
      const R = this.rotating;
      const delta = Math.atan2(p.y - R.c.y, p.x - R.c.x) - R.ref;
      let ang = R.base + delta;
      if (this.mods.shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      if (op.kind === 'line') {
        const rot = (x, y) => {
          const dx = x - R.c.x, dy = y - R.c.y, c = Math.cos(ang), s = Math.sin(ang);
          return [r1(R.c.x + dx * c - dy * s), r1(R.c.y + dx * s + dy * c)];
        };
        [op.x1, op.y1] = rot(R.line.x1, R.line.y1);
        [op.x2, op.y2] = rot(R.line.x2, R.line.y2);
      } else {
        op.rot = Math.round(ang * 1000) / 1000;
      }
      return;
    }
    const a = this.anchor;
    if (op.kind === 'line') {
      let dx = p.x - a.x, dy = p.y - a.y;
      if (this.mods.shift) {
        const len = Math.hypot(dx, dy);
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
        dx = Math.cos(ang) * len;
        dy = Math.sin(ang) * len;
      }
      op.x1 = r1(a.x); op.y1 = r1(a.y); op.x2 = r1(a.x + dx); op.y2 = r1(a.y + dy);
      return;
    }
    const rot = this.rotation || 0;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const wx = p.x - a.x, wy = p.y - a.y;
    let lx = wx * cos - wy * sin, ly = wx * sin + wy * cos;
    if (this.mods.shift) {
      const m = Math.max(Math.abs(lx), Math.abs(ly));
      lx = m * (Math.sign(lx) || 1);
      ly = m * (Math.sign(ly) || 1);
    }
    this.signX = Math.sign(lx) || 1;
    this.signY = Math.sign(ly) || 1;
    const c2 = Math.cos(rot), s2 = Math.sin(rot);
    op.cx = r1(a.x + (lx / 2) * c2 - (ly / 2) * s2);
    op.cy = r1(a.y + (lx / 2) * s2 + (ly / 2) * c2);
    op.w = r1(Math.abs(lx));
    op.h = r1(Math.abs(ly));
    op.rot = Math.round(rot * 1000) / 1000;
  }

  // --- live network preview (throttled) ---

  _scheduleLive() {
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => this._flushLive(false), LIVE_FLUSH_MS);
  }

  _flushLive(final) {
    clearTimeout(this.liveTimer);
    this.liveTimer = null;
    const op = this.live;
    if (!op) return;
    if (op.t === 'stroke') {
      const from = this.liveSent || 0;
      if (from >= op.pts.length && !final) return;
      const ev = { k: 'lv', id: this.liveId, i: from, p: op.pts.slice(from) };
      if (from === 0) ev.h = { t: 'stroke', tool: op.tool, color: op.color, size: op.size, alpha: op.alpha };
      this.liveSent = op.pts.length;
      this._emit('event', ev);
    } else {
      this._emit('event', { k: 'ls', op: { ...op } });
    }
  }

  // --- brush cursor ---

  _moveCursor(e) {
    if (!this.cursor) return;
    if (!this.enabled) { this.cursor.hidden = true; return; }
    const wr = this.wrap.getBoundingClientRect();
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${e.clientX - wr.left}px, ${e.clientY - wr.top}px)`;
    this._updateCursor();
  }

  _updateCursor() {
    if (!this.cursor) return;
    const r = this.view.getBoundingClientRect();
    const scale = r.width / DOC_W || 0.5;
    const { tool, size } = this.state;
    const sized = tool === 'brush' || tool === 'eraser' || SHAPES.has(tool);
    const d = sized ? Math.max(4, size * scale) : 14;
    this.cursor.dataset.tool = tool;
    this.cursor.style.width = this.cursor.style.height = d + 'px';
    this.cursor.style.marginLeft = this.cursor.style.marginTop = -d / 2 + 'px';
  }
}
