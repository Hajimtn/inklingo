// Drawing toolbar: tools, palette, colour triangle, size, opacity, history and shortcuts.

import { h, $$, confirmDialog, toast } from '../ui/dom.js';
import { ColorTriangle } from './colorpicker.js';

import { tr } from '../i18n.js';
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}><path d="${d}"/></svg>`;
export const ICONS = {
  brush: I('M3 21c3 0 5-1.5 5-4 0-1.3-1-2.3-2.3-2.3S3 16 3 21zm5.4-5.7 2.3 2.3L21 7.3a1.6 1.6 0 0 0-2.3-2.3z'),
  eraser: I('M15.1 3.6 21 9.5a1.5 1.5 0 0 1 0 2.1L12.6 20H20v1.5H7.8L3 16.7a1.5 1.5 0 0 1 0-2.1l10-11a1.5 1.5 0 0 1 2.1 0zM8.4 20h2.1l3-3-5.9-5.9-4 4.4z'),
  fill: I('M12 2.5 3.5 11a1.4 1.4 0 0 0 0 2l5.5 5.5a1.4 1.4 0 0 0 2 0L19.5 10zM6 12h11.6l-7.6 7.6zM20.5 14s-2 2.4-2 3.7a2 2 0 0 0 4 0c0-1.3-2-3.7-2-3.7z'),
  picker: I('M20.7 3.3a2.4 2.4 0 0 0-3.4 0l-2.6 2.6-1.4-1.4-1.4 1.4 1.4 1.4-8.1 8.1V19h3.6l8.1-8.1 1.4 1.4 1.4-1.4-1.4-1.4 2.6-2.6a2.4 2.4 0 0 0 0-3.4zM7.4 17.5H6v-1.4l8.1-8.1 1.4 1.4z'),
  line: I('M4.6 20.8 3.2 19.4 19.4 3.2l1.4 1.4z'),
  rect: I('M3 5h18v14H3zm2 2v10h14V7z'),
  ellipse: I('M12 4c5 0 9 3.6 9 8s-4 8-9 8-9-3.6-9-8 4-8 9-8zm0 2c-3.9 0-7 2.7-7 6s3.1 6 7 6 7-2.7 7-6-3.1-6-7-6z'),
  filled: I('M3 5h8v14H3zM13 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0z'),
  undo: I('M12.5 8C9.9 8 7.5 9 5.7 10.6L2 7v9h9l-3.6-3.6A8 8 0 0 1 20.2 16l2.3-.8A10.5 10.5 0 0 0 12.5 8z'),
  redo: I('M11.5 8c2.6 0 5 1 6.8 2.6L22 7v9h-9l3.6-3.6A8 8 0 0 0 3.8 16l-2.3-.8A10.5 10.5 0 0 1 11.5 8z'),
  clear: I('M9 3h6l1 2h4v2H4V5h4zm-3 5h12l-1 13H7zm4 2v9h1.5v-9zm3.5 0v9H15v-9z'),
  save: I('M5 20h14v-2H5zm7-3 6-6-1.4-1.4L13 13.2V3h-2v10.2L7.4 9.6 6 11z'),
};

export const TOOL_LABELS = {
  brush: tr('Bút vẽ'), eraser: tr('Tẩy'), fill: tr('Đổ màu'), picker: tr('Hút màu'), line: tr('Đường thẳng'), rect: tr('Hình chữ nhật'), ellipse: tr('Hình elip'),
};

// An original 24-colour palette (greyscale + hues in two lightness steps).
export const PALETTE = [
  '#1b1b1f', '#4a4a52', '#8d8d96', '#c9c9cf', '#ffffff', '#6b3e22', '#a8683c', '#f2c9a0',
  '#c62828', '#ef5350', '#ef6c00', '#ffa726', '#f9c80e', '#fff176', '#2e7d32', '#7cc95b',
  '#00897b', '#4dd0c1', '#1565c0', '#64b5f6', '#4527a0', '#9575cd', '#ad1457', '#f48fb1',
];

const SIZE_PRESETS = [4, 10, 22, 44];
const KEYS = { b: 'brush', p: 'brush', e: 'eraser', f: 'fill', g: 'fill', i: 'picker', l: 'line', r: 'rect', o: 'ellipse' };

export class Toolbar {
  constructor(root, engine, { onSave, statusHost } = {}) {
    this.root = root;
    this.statusHost = statusHost || null;
    this.engine = engine;
    this.onSave = onSave;
    this.enabled = false;
    this.build();
    engine.on('pick', (c) => { this.setColor(c); this.setTool(this.prevTool || 'brush'); toast(tr('Đã hút màu ') + c); });
    engine.on('size', (s) => this.syncSize(s));
    engine.on('history', ({ canUndo, canRedo }) => {
      this.btnUndo.disabled = !this.enabled || !canUndo;
      this.btnRedo.disabled = !this.enabled || !canRedo;
    });
    this._keys = (e) => this.onKey(e);
    document.addEventListener('keydown', this._keys);
    this.setColor(engine.state.color);
    this.setTool('brush');
    this.syncSize(engine.state.size);
  }

  destroy() { document.removeEventListener('keydown', this._keys); }

  build() {
    const toolBtn = (tool, key) => h('button.tool', {
      type: 'button', 'data-tool': tool, title: `${TOOL_LABELS[tool]} (${key})`, 'aria-label': TOOL_LABELS[tool], html: ICONS[tool],
      onclick: () => this.setTool(tool),
    });
    const act = (name, title, fn) => h('button.tool', { type: 'button', title, 'aria-label': title, html: ICONS[name], onclick: fn });

    this.btnFilled = h('button.tool.toggle', {
      type: 'button', title: tr('Hình tô kín (U)'), 'aria-label': tr('Hình tô kín'), 'aria-pressed': 'false', html: ICONS.filled,
      onclick: () => this.setFilled(!this.engine.state.fillShapes),
    });
    this.btnUndo = act('undo', tr('Hoàn tác (Ctrl+Z)'), () => this.engine.undo());
    this.btnRedo = act('redo', tr('Làm lại (Ctrl+Y)'), () => this.engine.redo());
    this.btnClear = act('clear', tr('Xóa bảng (Delete)'), () => this.askClear());
    this.btnSave = act('save', tr('Lưu tranh PNG (Ctrl+S)'), () => this.save());

    this.current = h('button.current-color', { type: 'button', title: tr('Bánh xe màu tùy chỉnh'), 'aria-label': tr('Mở bánh xe màu'), onclick: () => this.togglePicker() });
    this.swatches = h('div.swatches', PALETTE.map((c) => h('button.swatch', {
      type: 'button', title: c, 'aria-label': tr('Màu ') + c, 'data-color': c, style: { background: c }, onclick: () => this.setColor(c),
    })));

    const canvas = h('canvas.tri');
    this.hexInput = h('input.hex', { type: 'text', maxLength: 7, spellcheck: false, 'aria-label': tr('Mã màu'),
      onchange: (e) => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) this.setColor(v[0] === '#' ? v : '#' + v); } });
    this.popover = h('div.picker-pop', { hidden: true }, canvas, h('div.row', h('span.small', 'HEX'), this.hexInput));
    this.triangle = new ColorTriangle(canvas, (hex) => this.setColor(hex, true));

    this.sizeRange = h('input', { type: 'range', min: 2, max: 80, value: 8, 'aria-label': tr('Cỡ nét'), oninput: (e) => this.setSize(+e.target.value) });
    this.sizeLabel = h('b.val');
    this.sizeDots = h('div.size-dots', SIZE_PRESETS.map((s) => h('button.size-dot', {
      type: 'button', title: s + 'px', 'aria-label': tr('Cỡ ') + s, 'data-size': s, onclick: () => this.setSize(s),
    }, h('i', { style: { width: Math.min(22, 3 + s / 2.2) + 'px', height: Math.min(22, 3 + s / 2.2) + 'px' } }))));
    this.alphaRange = h('input', { type: 'range', min: 5, max: 100, value: 100, 'aria-label': tr('Độ trong suốt'), oninput: (e) => this.setAlpha(+e.target.value / 100) });
    this.alphaLabel = h('b.val');
    this.status = h('div.tool-status', { 'aria-live': 'polite' });

    this.root.replaceChildren(
      h('div.tb-row',
        h('div.tool-group', toolBtn('brush', 'B'), toolBtn('eraser', 'E'), toolBtn('fill', 'F'), toolBtn('picker', 'I')),
        h('div.tool-group', toolBtn('line', 'L'), toolBtn('rect', 'R'), toolBtn('ellipse', 'O'), this.btnFilled),
        h('div.tool-group', this.btnUndo, this.btnRedo, this.btnClear, this.btnSave),
        this.statusHost ? null : this.status),
      h('div.tb-row',
        h('div.color-area', h('div.current-wrap', this.current, this.popover), this.swatches),
        h('div.sliders',
          h('div.ctrl', h('span', tr('Cỡ')), this.sizeDots, this.sizeRange, this.sizeLabel),
          h('div.ctrl', h('span', 'Opacity'), this.alphaRange, this.alphaLabel))));

    if (this.statusHost) {
      this.status.classList.add('floating');
      this.statusHost.append(this.status);
    }
    document.addEventListener('pointerdown', (e) => {
      if (!this.popover.hidden && !this.popover.contains(e.target) && e.target !== this.current) this.popover.hidden = true;
    });
  }

  setEnabled(on) {
    this.enabled = on;
    this.status.hidden = !on && !!this.statusHost;
    this.root.classList.toggle('disabled', !on);
    for (const b of $$('button, input', this.root)) b.disabled = !on;
    if (on) {
      this.btnUndo.disabled = !this.engine.canUndo;
      this.btnRedo.disabled = !this.engine.canRedo;
    } else this.popover.hidden = true;
  }

  setTool(tool) {
    if (tool !== 'picker') this.prevTool = tool;
    this.engine.setState({ tool });
    for (const b of $$('[data-tool]', this.root)) b.classList.toggle('selected', b.dataset.tool === tool);
    this.updateStatus();
  }

  setFilled(on) {
    this.engine.setState({ fillShapes: on });
    this.btnFilled.classList.toggle('selected', on);
    this.btnFilled.setAttribute('aria-pressed', String(on));
    if (on && !['rect', 'ellipse'].includes(this.engine.state.tool)) this.setTool('rect');
    this.updateStatus();
  }

  setColor(hex, fromTriangle = false) {
    hex = hex.toLowerCase();
    this.engine.setState({ color: hex });
    this.current.style.background = hex;
    this.hexInput.value = hex;
    if (!fromTriangle) this.triangle.setHex(hex);
    for (const s of $$('.swatch', this.root)) s.classList.toggle('selected', s.dataset.color === hex);
    if (this.engine.state.tool === 'eraser') this.setTool('brush');
    this.updateStatus();
  }

  setSize(s) {
    s = Math.max(2, Math.min(80, Math.round(s)));
    this.engine.setState({ size: s });
    this.syncSize(s);
  }

  syncSize(s) {
    this.sizeRange.value = s;
    this.sizeLabel.textContent = s + 'px';
    for (const d of $$('.size-dot', this.root)) d.classList.toggle('selected', +d.dataset.size === s);
    this.updateStatus();
  }

  setAlpha(a) {
    this.engine.setState({ alpha: a });
    this.alphaRange.value = Math.round(a * 100);
    this.alphaLabel.textContent = Math.round(a * 100) + '%';
    this.updateStatus();
  }

  updateStatus() {
    const st = this.engine.state;
    const parts = [TOOL_LABELS[st.tool]];
    if (['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(st.tool)) parts.push(st.size + 'px');
    if (st.tool !== 'eraser' && st.tool !== 'picker') parts.push(Math.round(st.alpha * 100) + '%');
    if ((st.tool === 'rect' || st.tool === 'ellipse') && st.fillShapes) parts.push(tr('tô kín'));
    this.status.replaceChildren(h('i.dot', { style: { background: st.tool === 'eraser' ? '#fff' : st.color } }), parts.join(' · '));
    if (this.alphaLabel) this.alphaLabel.textContent = Math.round(st.alpha * 100) + '%';
  }

  togglePicker() {
    this.popover.hidden = !this.popover.hidden;
    if (!this.popover.hidden) this.triangle.setHex(this.engine.state.color);
  }

  async askClear() {
    if (!this.enabled || !this.engine.canUndo) return;
    if (await confirmDialog(tr('Xóa bảng vẽ?'), tr('Có thể hoàn tác bằng Ctrl+Z.'), tr('Xóa'), true)) this.engine.clear();
  }

  save() {
    const a = document.createElement('a');
    a.href = this.engine.toDataURL('image/png');
    a.download = 'scribble-words-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
    document.body.append(a);
    a.click();
    a.remove();
    this.onSave?.();
  }

  onKey(e) {
    if (!this.enabled || !this.root.isConnected) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('.dialog-layer')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.engine.redo() : this.engine.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.engine.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.save(); return; }
    if (mod || e.altKey) return;
    if (KEYS[k]) { this.setTool(KEYS[k]); return; }
    if (k === 'u') { this.setFilled(!this.engine.state.fillShapes); return; }
    if (k === '[' || k === ']') { this.setSize(this.engine.state.size + (k === ']' ? 2 : -2)); return; }
    if (k === 'delete') { this.askClear(); return; }
  }
}
