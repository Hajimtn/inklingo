// Drawing Assistant (drawer only): 1 Meaning · 2 Scene · 3 Elements · 4 Step-by-step · 5 Ghost Sketch,
// plus Idea Shuffle. Every level used lowers the drawer's maximum points for the turn (the server
// records the highest level; see ASSIST_MULT in game-core.js).

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ASSIST_MULT } from '../shared/game-core.js';
import { photo, credit } from '../vocab/data.js';
import { drawSketch, drawOutline, drawLayout, clearGhost } from './ghost.js';

import { tr } from '../i18n.js';
const LEVELS = [
  { n: 1, short: tr('Nghĩa'), label: tr('Nghĩa'), title: tr('Cấp 1 – Nghĩa & ảnh tham khảo') },
  { n: 2, short: tr('Cảnh'), label: tr('Tình huống'), title: tr('Cấp 2 – Gợi ý tình huống để vẽ') },
  { n: 3, short: tr('Chi tiết'), label: tr('Thành phần'), title: tr('Cấp 3 – Các thành phần cần vẽ') },
  { n: 4, short: tr('Từng bước'), label: tr('Từng bước'), title: tr('Cấp 4 – Hướng dẫn vẽ từng bước') },
  { n: 5, short: 'Ghost', label: 'Ghost', title: tr('Ghost Sketch – hình mẫu mờ để đồ theo') },
];

const pct = (lv) => Math.round(ASSIST_MULT[lv] * 100) + '%';

export class Assistant {
  constructor(root, { ghostCanvas, onLevel }) {
    this.root = root;
    this.ghost = ghostCanvas;
    this.onLevel = onLevel;
    this.word = null;
    this.level = 0;
    this.idea = 0;
    this.photoIdx = 0;
    this.ghostOn = false;
    this.ghostMode = 'outline';
    this.ghostOpacity = 0.38;
    this.render();
  }

  setWord(w) {
    this.word = w;
    this.level = 0;
    this.idea = 0;
    this.photoIdx = 0;
    this.ghostOn = false;
    this.ghostMode = w?.sketch ? 'sketch' : 'outline';
    this.hideGhost();
    this.render();
  }

  /** Hide the content (e.g. while the device is handed to a guesser) without losing state. */
  setLocked(locked) {
    if (locked === this.locked) return;
    this.locked = locked;
    if (locked) {
      if (this.ghost) this.ghost.hidden = true;
    } else if (this.ghostOn && this.ghost) {
      this.ghost.hidden = false;
    }
    this.render();
  }

  /** Server-confirmed level (authoritative for scoring). */
  confirm(level) {
    if (level > this.level) this.level = level;
    this.render();
  }

  request(n) {
    if (!this.word) return;
    if (n > this.level) {
      this.level = n;
      this.onLevel(n);
    }
    if (n === 5) this.showGhost();
    this.render();
  }

  shuffle() {
    if (!this.word) return;
    this.idea = (this.idea + 1) % this.word.ideas.length;
    if (this.level < 2) this.request(2);
    if (this.ghostOn && this.ghostMode === 'layout' && !this.word.ideas[this.idea].ghost) this.ghostMode = 'outline';
    if (this.ghostOn) this.showGhost();
    this.render();
  }

  hideGhost() {
    this.ghostOn = false;
    if (this.ghost) {
      clearGhost(this.ghost);
      this.ghost.hidden = true;
    }
  }

  async showGhost() {
    if (!this.word || !this.ghost) return;
    this.ghostOn = true;
    this.ghost.hidden = !!this.locked;
    this.ghost.style.opacity = this.ghostOpacity;
    const idea = this.word.ideas[this.idea];
    let ok = false;
    if (this.ghostMode === 'sketch' && this.word.sketch) ok = await drawSketch(this.ghost, this.word.id);
    if (!ok && this.ghostMode === 'layout' && idea.ghost) ok = drawLayout(this.ghost, idea.ghost);
    if (!ok) {
      this.ghostMode = 'outline';
      const im = this.word.images[this.photoIdx] || this.word.images[0];
      ok = await drawOutline(this.ghost, im.file);
      if (!ok && idea.ghost) {
        this.ghostMode = 'layout';
        ok = drawLayout(this.ghost, idea.ghost);
      }
    }
    this.render();
  }

  render() {
    const r = clear(this.root);
    const w = this.word;
    r.append(h('div.row.between', h('h3.with-ic', icon('bulb', { size: 16 }), tr('Trợ lý vẽ')), w && !this.locked ? h('span.assist-mult', { title: tr('Điểm tối đa của người vẽ trong lượt này') }, pct(this.level)) : null));
    if (!w || this.locked) {
      r.append(h('div.assist-body.muted.with-ic', icon('lock', { size: 16 }), tr('Chỉ người vẽ xem được')));
      return;
    }
    r.append(h('div.assist-levels', LEVELS.map((L) => h('button', {
      type: 'button', class: (L.n <= this.level ? 'used' : '') + (L.n === this.level ? ' on' : ''),
      title: tr('{title} (điểm tối đa {pct})', { title: L.title, pct: pct(Math.max(this.level, L.n)) }), 'aria-label': L.title, onclick: () => this.request(L.n),
    }, h('b', L.n), h('small', L.short)))));
    const idea = w.ideas[this.idea];
    const body = h('div.assist-body');
    if (this.level >= 1) {
      const img = photo(w, { index: this.photoIdx });
      const cap = credit(w.images[this.photoIdx], { short: true });
      img.addEventListener('load', () => cap.replaceWith(credit(img._meta, { short: true })));
      body.append(h('div.lvl', LEVELS[0].title), h('div', h('b', w.en), ' — ', w.vi), h('div.muted', w.explain), img, cap);
      if (w.images.length > 1) body.append(h('button.btn.small', { type: 'button', onclick: () => { this.photoIdx = (this.photoIdx + 1) % w.images.length; if (this.ghostOn && this.ghostMode === 'outline') this.showGhost(); this.render(); } }, tr('Ảnh khác ({i}/{n})', { i: this.photoIdx + 1, n: w.images.length })));
    }
    if (this.level >= 2) body.append(h('div.lvl', tr('{title} · ý tưởng {i}/{n}', { title: LEVELS[1].title, i: this.idea + 1, n: w.ideas.length })), h('div', idea.scene));
    if (this.level >= 3) body.append(h('div.lvl', LEVELS[2].title), h('ul', idea.elements.map((e) => h('li', e))));
    if (this.level >= 4) body.append(h('div.lvl', LEVELS[3].title), h('ol', idea.steps.map((s) => h('li', s))));
    if (this.level > 0) r.append(body);
    r.append(h('div.row', { style: { marginTop: '8px' } },
      h('button.btn.small', { type: 'button', onclick: () => this.shuffle(), title: tr('Chuyển sang cách minh họa khác') }, icon('shuffle', { size: 16 }), tr('Đổi ý tưởng'))));
    if (this.level >= 5) {
      const modeSel = h('select.input', { style: { width: 'auto', padding: '3px 6px' }, 'aria-label': tr('Kiểu Ghost Sketch'), onchange: (e) => { this.ghostMode = e.target.value; this.showGhost(); } },
        this.word.sketch ? h('option', { value: 'sketch', selected: this.ghostMode === 'sketch' }, tr('Hình mẫu nét')) : null,
        h('option', { value: 'outline', selected: this.ghostMode === 'outline' }, tr('Đường viền từ ảnh thật')),
        idea.ghost ? h('option', { value: 'layout', selected: this.ghostMode === 'layout' }, tr('Bố cục mẫu (người que)')) : null);
      r.append(h('div.ghost-ctl',
        h('label', h('input', { type: 'checkbox', checked: this.ghostOn, onchange: (e) => (e.target.checked ? this.showGhost() : (this.hideGhost(), this.render())) }), tr(' Hiện Ghost')),
        modeSel,
        h('input', { type: 'range', min: 10, max: 70, value: Math.round(this.ghostOpacity * 100), 'aria-label': tr('Độ mờ Ghost'), style: { width: '80px' },
          oninput: (e) => { this.ghostOpacity = e.target.value / 100; if (this.ghost) this.ghost.style.opacity = this.ghostOpacity; } })));
    }
  }
}
