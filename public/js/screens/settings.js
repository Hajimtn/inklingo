// Settings: profiles (separate progress per player), pronunciation, test-date tool, credits.

import { h, clear, toast, confirmDialog, speak } from '../ui/dom.js';
import { icon, avatar as avatarEl, avatarColor } from '../ui/icons.js';
import { allWords } from '../vocab/data.js';
import * as P from '../vocab/progress.js';
import * as G from '../net/groups.js';

export function renderSettings(root, rerenderHeader) {
  const prof = P.active();
  const st = P.settings();
  const name = h('input.input', { value: prof.name, maxLength: 18, 'aria-label': 'Tên hiển thị' });
  let avatar = prof.avatar;
  const av = h('div.avatars');
  const drawAv = () => clear(av).append(...P.avatars.map((a, i) => h('button.av-swatch', { type: 'button', class: a === avatar ? 'selected' : '', 'aria-label': 'Màu ảnh đại diện ' + (i + 1), 'aria-pressed': String(a === avatar), style: { '--av': avatarColor(a) }, onclick: () => { avatar = a; drawAll(); } }, a === avatar ? icon('check', { size: 18 }) : null)));
  const preview = h('span.av-preview');
  const drawPreview = () => clear(preview).append(avatarEl(name.value || prof.name, avatar, 52));
  name.addEventListener('input', drawPreview);
  const drawAll = () => { drawAv(); drawPreview(); };
  drawAll();
  const rate = h('input', { type: 'range', min: 50, max: 120, value: Math.round((st.ttsRate || 0.85) * 100), 'aria-label': 'Tốc độ đọc' });
  const sim = h('input.input', { type: 'date', value: st.simDate || '', style: { width: '180px' }, 'aria-label': 'Ngày giả lập' });

  clear(root).append(
    h('div.page-title', icon('settings', { size: 28 }), 'Cài đặt'),
    h('div.grid2',
      h('section.card.stack',
        h('h2', 'Hồ sơ'),
        h('div.row.profile-edit', preview, h('div.form-grid', { style: { flex: 1 } }, h('b', 'Tên'), name, h('b', 'Màu'), av)),
        h('div.row', h('button.btn.primary', { onclick: () => {
          if (!name.value.trim()) return toast('Tên không được để trống', 'bad');
          P.updateProfile(prof.id, { name: name.value.trim(), avatar });
          G.updateProfile(P.profile(prof.id));
          localStorage.setItem('sw:ttsRate', String(P.settings().ttsRate));
          toast('Đã lưu hồ sơ', 'good');
          rerenderHeader();
          renderSettings(root, rerenderHeader);
        } }, 'Lưu hồ sơ')),
        h('h3', 'Đổi hồ sơ'),
        h('div.stack', P.profiles().map((p) => h('div.row.between.profile-row' + (p.id === prof.id ? '.on' : ''),
          h('span.row', { style: { gap: '8px', flexWrap: 'nowrap' } }, avatarEl(p.name, p.avatar, 30), h('span', h('b', p.name), h('span.small.muted', ` · ${Object.keys(p.introduced).length} từ`))),
          h('div.row',
            p.id === prof.id ? h('span.tag.green', 'Đang dùng') : h('button.btn.small', { onclick: () => { P.switchProfile(p.id); rerenderHeader(); renderSettings(root, rerenderHeader); } }, 'Dùng'),
            P.profiles().length > 1 ? h('button.btn.small.danger', { onclick: async () => {
              if (await confirmDialog(`Xóa hồ sơ ${p.name}?`, 'Toàn bộ tiến độ của hồ sơ này sẽ bị xóa khỏi trình duyệt.', 'Xóa hồ sơ', true)) { P.deleteProfile(p.id); rerenderHeader(); renderSettings(root, rerenderHeader); }
            } }, 'Xóa') : null)))),
        h('button.btn', { onclick: () => {
          const p = P.createProfile('Người chơi ' + (P.profiles().length + 1));
          toast(`Đã tạo hồ sơ ${p.name}`, 'good');
          rerenderHeader();
          renderSettings(root, rerenderHeader);
        } }, icon('plus', { size: 18 }), 'Tạo hồ sơ mới')),
      h('section.stack',
        h('div.card.stack',
          h('h2', 'Phát âm'),
          h('div.row', h('span', 'Tốc độ đọc'), rate, h('button.btn.small', { onclick: () => { P.setSetting('ttsRate', rate.value / 100); localStorage.setItem('sw:ttsRate', String(rate.value / 100)); speak('Hello, nice to meet you', rate.value / 100); } }, icon('volume', { size: 16 }), 'Thử'))),
        h('div.card.stack',
          h('h2', 'Tiến độ học'),
          h('p.small', h('b', `${P.DAY_NAMES[P.weekday()]} ${P.today()}`)),
          h('details', h('summary', h('b', 'Ngày giả lập (kiểm thử)')),
            h('div.row', sim,
              h('button.btn.small', { onclick: () => { P.setSetting('simDate', sim.value || null); toast(sim.value ? 'Đã đặt ngày giả lập' : 'Dùng ngày thật'); renderSettings(root, rerenderHeader); } }, 'Áp dụng'),
              h('button.btn.small', { onclick: () => { P.setSetting('simDate', P.addDays(P.today(), 1)); toast('Chuyển sang ngày ' + P.today()); renderSettings(root, rerenderHeader); } }, '+1 ngày'),
              h('button.btn.small', { onclick: () => { P.setSetting('simDate', null); renderSettings(root, rerenderHeader); } }, 'Ngày thật'))),
          h('button.btn.danger', { onclick: async () => {
            if (await confirmDialog('Xóa tiến độ học?', `Từ đã học, kết quả kiểm tra và thống kê của “${prof.name}” sẽ bị xóa.`, 'Xóa tiến độ', true)) { P.resetProgress(prof.id); toast('Đã xóa tiến độ'); }
          } }, icon('trash', { size: 18 }), 'Xóa tiến độ')),
        h('div.card.stack',
          h('h2', 'Nguồn ảnh'),
          h('a.btn', { href: '#/credits' }, icon('camera', { size: 18 }), 'Tác giả & giấy phép')))));
}

export function renderCredits(root) {
  const words = allWords();
  const rows = [];
  for (const w of words) for (const im of w.images) rows.push({ w, im });
  clear(root).append(
    h('a.back-link', { href: '#/settings' }, icon('back', { size: 16 }), 'Cài đặt'),
    h('div.page-title', icon('camera', { size: 28 }), 'Nguồn ảnh & giấy phép', h('span.tag.yellow', `${rows.length} ảnh · ${words.length} từ`)),
    h('div.card.stack',
      h('p.small.muted', 'Ảnh chụp thật từ Wikimedia Commons · CC0 / PD / CC BY / CC BY-SA'),
      h('div', { style: { overflowX: 'auto' } }, h('table.credits-table',
        h('thead', h('tr', h('th', 'Ảnh'), h('th', 'Từ'), h('th', 'Tệp gốc'), h('th', 'Tác giả'), h('th', 'Giấy phép'))),
        h('tbody', rows.map(({ w, im }) => h('tr',
          h('td', h('img', { src: im.file, alt: w.en, loading: 'lazy' })),
          h('td', h('b', w.en), h('div.small.muted', w.vi)),
          h('td', h('a', { href: im.page, target: '_blank', rel: 'noopener' }, im.title)),
          h('td', im.author),
          h('td', im.licenseUrl ? h('a', { href: im.licenseUrl, target: '_blank', rel: 'noopener' }, im.license) : im.license))))))));
}
