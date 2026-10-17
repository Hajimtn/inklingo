// Account: the player's own things – name, avatar (colour or a drawing), the profiles on this
// device, the study group, and wiping progress. Device-wide game settings live in settings.js.

import { h, clear, toast, confirmDialog, dialog } from '../ui/dom.js';
import { icon, avatar as avatarEl, avatarColor, isDrawnAvatar } from '../ui/icons.js';
import { drawAvatar, avatarKeyOf, uploadAvatar } from '../ui/avatar-draw.js';
import { tr } from '../i18n.js';
import * as P from '../vocab/progress.js';
import * as G from '../net/groups.js';

const copy = (text, msg) => (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(msg, 'good')).catch(() => toast(text));

export function renderAccount(root, rerenderHeader) {
  const prof = P.active();
  const again = () => { rerenderHeader(); renderAccount(root, rerenderHeader); };

  // ------------------------------------------------------------ profile card
  let key = prof.avatar;
  let pic = prof.pic;
  const name = h('input.input', { value: prof.name, maxLength: 18, 'aria-label': tr('Tên hiển thị') });
  const preview = h('span.av-preview');
  const drawPreview = () => {
    if (pic && isDrawnAvatar(key)) {
      const img = h('img', { src: pic, alt: '' });
      clear(preview).append(h('span.avatar.drawn', { style: { width: '96px', height: '96px' } }, img));
    } else clear(preview).append(avatarEl(name.value || prof.name, key, 96));
  };
  name.addEventListener('input', drawPreview);
  const swatches = h('div.avatars');
  const drawSwatches = () => clear(swatches).append(...P.avatars.map((a, i) => h('button.av-swatch', {
    type: 'button', class: a === key ? 'selected' : '', 'aria-label': tr('Màu {n}', { n: i + 1 }), 'aria-pressed': String(a === key), style: { '--av': avatarColor(a) },
    onclick: () => { key = a; pic = null; drawSwatches(); drawPreview(); },
  }, a === key ? icon('check', { size: 18 }) : null)));
  drawSwatches();
  drawPreview();

  const drawBtn = h('button.btn', { type: 'button', onclick: async () => {
    const url = await drawAvatar(isDrawnAvatar(key) ? pic : null);
    if (!url) return;
    pic = url;
    key = await avatarKeyOf(url);
    drawSwatches();
    drawPreview();
  } }, icon('pencil', { size: 18 }), isDrawnAvatar(prof.avatar) ? tr('Vẽ lại') : tr('Tự vẽ ảnh'));

  const save = h('button.btn.primary', { onclick: async () => {
    const nm = name.value.trim();
    if (!nm) return toast(tr('Tên không được để trống'), 'bad');
    P.updateProfile(prof.id, { name: nm });
    P.setAvatar(prof.id, key, isDrawnAvatar(key) ? pic : null);
    if (isDrawnAvatar(key) && !(await uploadAvatar(pic))) toast(tr('Chưa tải ảnh lên được: người khác sẽ thấy ảnh khi bạn có mạng'));
    G.updateProfile(P.profile(prof.id));
    toast(tr('Đã lưu hồ sơ'), 'good');
    again();
  } }, tr('Lưu'));

  const profileCard = h('section.card.stack.acc-profile',
    h('h2', tr('Hồ sơ')),
    h('div.acc-head', preview, h('div.stack', { style: { flex: 1, minWidth: 0 } }, h('label.small.muted', tr('Tên hiển thị')), name)),
    h('div.stack', h('b', tr('Ảnh đại diện')), h('span.small.muted', tr('Chọn màu (hiện chữ cái đầu) hoặc tự vẽ')), swatches, h('div.row', drawBtn)),
    h('div.row', save));

  // ------------------------------------------------------------ profiles on this device
  const profilesCard = h('section.card.stack',
    h('h2', tr('Hồ sơ trên máy này')),
    h('p.small.muted', tr('Mỗi hồ sơ có tiến độ riêng, lưu trong trình duyệt này')),
    h('div.stack', P.profiles().map((p) => h('div.row.between.profile-row' + (p.id === prof.id ? '.on' : ''),
      h('span.row', { style: { gap: '8px', flexWrap: 'nowrap', minWidth: 0 } }, avatarEl(p.name, p.avatar, 34), h('span', h('b', p.name), h('span.small.muted', ' · ' + tr('{n} từ', { n: Object.keys(p.introduced).length })))),
      h('div.row',
        p.id === prof.id ? h('span.tag.green', tr('Đang dùng')) : h('button.btn.small', { onclick: () => { P.switchProfile(p.id); again(); } }, tr('Dùng')),
        P.profiles().length > 1 ? h('button.btn.small.danger', { onclick: async () => {
          if (await confirmDialog(tr('Xóa hồ sơ {name}?', { name: p.name }), tr('Toàn bộ tiến độ của hồ sơ này sẽ bị xóa khỏi trình duyệt.'), tr('Xóa hồ sơ'), true)) { P.deleteProfile(p.id); again(); }
        } }, tr('Xóa')) : null)))),
    h('button.btn', { onclick: () => {
      const p = P.createProfile(tr('Người chơi {n}', { n: P.profiles().length + 1 }));
      toast(tr('Đã tạo hồ sơ {name}', { name: p.name }), 'good');
      again();
    } }, icon('plus', { size: 18 }), tr('Tạo hồ sơ mới')));

  // ------------------------------------------------------------ study group
  const link = G.link(prof);
  const st = G.lastState(prof);
  const groupCard = h('section.card.stack',
    h('h2', tr('Nhóm học')),
    link
      ? [
        h('div.row.between', h('span', h('b', link.name || link.code), h('span.small.muted', ' · ' + tr('mã {code}', { code: link.code }))),
          st ? h('span.tag', tr('{n} thành viên', { n: st.members.length })) : null),
        h('div.row',
          h('a.btn.primary.small', { href: '#/group' }, icon('users', { size: 16 }), tr('Mở trang nhóm')),
          h('button.btn.small', { onclick: () => dialog({ title: tr('Mã khôi phục'), body: h('div.stack', h('p.small.muted', tr('Dùng mã này để tiếp tục trên máy khác. Không chia sẻ cho người khác.')), h('code.recovery', G.recoveryCode(prof))), buttons: [{ label: tr('Chép'), value: 'copy' }, { label: tr('Đóng'), value: null, primary: true }] }).then((v) => v === 'copy' && copy(G.recoveryCode(prof), tr('Đã chép mã khôi phục'))) }, icon('lock', { size: 16 }), tr('Mã khôi phục')),
          h('button.btn.small.danger', { onclick: async () => {
            if (!(await confirmDialog(tr('Rời nhóm?'), tr('Điểm của bạn trong nhóm sẽ mất.'), tr('Rời nhóm'), true))) return;
            try { await G.leave(prof); } catch { /* unlinked anyway */ }
            toast(tr('Đã rời nhóm'));
            again();
          } }, icon('logout', { size: 16 }), tr('Rời nhóm'))),
      ]
      : [h('p.small.muted', tr('Chưa tham gia nhóm nào')), h('div.row', h('a.btn.small', { href: '#/group' }, icon('users', { size: 16 }), tr('Tạo hoặc vào nhóm')))]);

  // ------------------------------------------------------------ danger zone
  const dataCard = h('section.card.stack.acc-danger',
    h('h2', tr('Dữ liệu')),
    h('p.small.muted', tr('Xóa từ đã học, kết quả kiểm tra và thống kê của hồ sơ này. Tên và ảnh đại diện được giữ lại.')),
    h('div.row', h('button.btn.danger', { onclick: async () => {
      if (await confirmDialog(tr('Xóa tiến độ học?'), tr('Từ đã học, kết quả kiểm tra và thống kê của “{name}” sẽ bị xóa.', { name: prof.name }), tr('Xóa tiến độ'), true)) { P.resetProgress(prof.id); toast(tr('Đã xóa tiến độ')); again(); }
    } }, icon('trash', { size: 18 }), tr('Xóa tiến độ'))));

  clear(root).append(
    h('div.page-head', h('h1.page-title', tr('Tài khoản'))),
    h('div.grid2', h('div.stack', profileCard, dataCard), h('div.stack', profilesCard, groupCard)));
}
