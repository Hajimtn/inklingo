// Play entry points: quick match, create room (online or same device), join by code / link.

import { h, clear, toast } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';

const back = () => h('a.back-link', { href: '#/' }, icon('back', { size: 16 }), tr('Trang chủ'));
import { dictionary } from '../vocab/data.js';
import * as P from '../vocab/progress.js';
import { onlineSession, localSession } from '../net/sessions.js';
import { RoomView } from '../game/room-view.js';
import { preMatchPreview } from './learn.js';
import { DEFAULT_SETTINGS } from '../shared/game-core.js';

import { tr } from '../i18n.js';
let currentView = null;

export function leaveCurrentRoom() {
  if (currentView) {
    currentView.s.detach?.();
    currentView.destroy();
    currentView = null;
  }
}

function me() {
  const p = P.active();
  return { name: p.name, avatar: p.avatar };
}

function mount(root, session, opts = {}) {
  leaveCurrentRoom();
  currentView = new RoomView(root, session, {
    ...opts,
    onExit: () => {
      currentView = null;
      location.hash = '#/';
    },
  });
  return currentView;
}

export async function startQuick(root) {
  if (!(await preMatchPreview())) return;
  const s = onlineSession();
  mount(root, s);
  s.send({ type: 'quick', ...me(), wordIds: P.matchWordIds(), settings: DEFAULT_SETTINGS });
}

/** Drawing room started from the group page: its points count on the group leaderboard. */
export async function startGroupRoom(root) {
  const p = P.active();
  if (!p.group) {
    location.hash = '#/group';
    return;
  }
  if (!(await preMatchPreview())) return;
  const s = onlineSession();
  mount(root, s);
  s.send({ type: 'create', ...me(), wordIds: P.matchWordIds(), settings: DEFAULT_SETTINGS, group: { code: p.group.code, memberId: p.group.memberId, secret: p.group.secret } });
}

export async function joinCode(root, code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) {
    toast(tr('Mã phòng không hợp lệ'), 'bad');
    return;
  }
  if (!(await preMatchPreview())) return;
  const s = onlineSession();
  mount(root, s);
  s.send({ type: 'join', code, ...me() });
}

export function renderJoin(root, serverOk) {
  const inp = h('input.input', { type: 'text', maxLength: 8, placeholder: tr('Mã phòng'), autocapitalize: 'characters', 'aria-label': tr('Mã phòng'), style: { fontSize: '26px', letterSpacing: '6px', textAlign: 'center', textTransform: 'uppercase' } });
  clear(root).append(back(), h('div.page-title', icon('login', { size: 28 }), tr('Vào phòng')),
    h('form.card.stack', { style: { maxWidth: '460px' }, onsubmit: (e) => { e.preventDefault(); joinCode(root, inp.value); } },
      serverOk ? null : h('div.notice', icon('offline', { size: 18 }), h('span', tr('Offline – không vào được phòng online'))),
      inp,
      h('button.btn.primary.big', { type: 'submit', disabled: !serverOk }, icon('login', { size: 20 }), tr('Vào phòng'))));
  setTimeout(() => inp.focus(), 50);
}

export function renderCreate(root, serverOk) {
  let mode = serverOk ? 'online' : 'local';
  const body = h('div');
  const seg = h('div.seg');
  const draw = () => {
    clear(seg).append(
      h('button', { type: 'button', class: mode === 'online' ? 'on' : '', disabled: !serverOk, onclick: () => { mode = 'online'; draw(); } }, icon('globe', { size: 18 }), 'Online'),
      h('button', { type: 'button', class: mode === 'local' ? 'on' : '', onclick: () => { mode = 'local'; draw(); } }, icon('phone', { size: 18 }), tr('Cùng một thiết bị')));
    clear(body).append(mode === 'online' ? onlineForm() : localForm());
  };
  const onlineForm = () => h('div.stack',
    h('button.btn.primary.big', { onclick: async () => {
      if (!(await preMatchPreview())) return;
      const s = onlineSession();
      mount(root, s);
      s.send({ type: 'create', ...me(), wordIds: P.matchWordIds(), settings: DEFAULT_SETTINGS });
    } }, icon('door', { size: 20 }), tr('Tạo phòng online')));

  const localForm = () => {
    // Guests get the first avatar colour nobody at the table is using yet.
    const freeAvatar = () => P.avatars.find((k) => !seats.some((s) => s.avatar === k)) || P.avatars[seats.length % P.avatars.length];
    const seats = [{ profileId: P.active().id, name: P.active().name, avatar: P.active().avatar }];
    seats.push({ profileId: '', name: tr('Người chơi 2'), avatar: freeAvatar() });
    let rounds = 2, drawTime = 120;
    const list = h('div.local-names');
    const renderSeats = () => clear(list).append(...seats.map((s, i) => h('div.row',
      avatar(s.name, s.avatar, 34),
      h('select.input', { style: { width: '190px' }, 'aria-label': tr('Hồ sơ người chơi {n}', { n: i + 1 }), onchange: (e) => {
        const p = P.profile(e.target.value);
        s.profileId = e.target.value;
        if (p) { s.name = p.name; s.avatar = p.avatar; }
        renderSeats();
      } }, h('option', { value: '', selected: !s.profileId }, tr('Khách')), P.profiles().map((p) => h('option', { value: p.id, selected: s.profileId === p.id }, p.name))),
      h('input.input', { value: s.name, maxLength: 18, style: { width: '160px' }, disabled: !!s.profileId, 'aria-label': tr('Tên người chơi {n}', { n: i + 1 }), oninput: (e) => { s.name = e.target.value; e.target.parentNode.firstChild.replaceWith(avatar(s.name, s.avatar, 34)); } }),
      seats.length > 2 ? h('button.btn.small', { type: 'button', onclick: () => { seats.splice(i, 1); renderSeats(); }, 'aria-label': tr('Bỏ người chơi'), title: tr('Bỏ người chơi') }, icon('close', { size: 16 })) : null)),
    seats.length < 8 ? h('button.btn.small', { type: 'button', onclick: () => { seats.push({ profileId: '', name: tr('Người chơi {n}', { n: seats.length + 1 }), avatar: freeAvatar() }); renderSeats(); } }, icon('plus', { size: 16 }), tr('Thêm người chơi')) : null);
    renderSeats();
    const pick = (vals, cur, set, fmt) => {
      const g = h('div.seg');
      const r = () => clear(g).append(...vals.map((v) => h('button', { type: 'button', class: v === cur() ? 'on' : '', onclick: () => { set(v); r(); } }, fmt ? fmt(v) : v)));
      r();
      return g;
    };
    return h('div.stack',
      list,
      h('div.row', h('b', { style: { width: '110px' } }, tr('Số vòng')), pick([1, 2, 3, 4], () => rounds, (v) => (rounds = v))),
      h('div.row', h('b', { style: { width: '110px' } }, tr('Thời gian')), pick([60, 90, 120, 180], () => drawTime, (v) => (drawTime = v), (v) => v + 's')),
      h('button.btn.green.big', { onclick: async () => {
        const used = new Set();
        for (const s of seats) {
          if (s.profileId && used.has(s.profileId)) { toast(tr('Mỗi hồ sơ chỉ ngồi một chỗ'), 'bad'); return; }
          if (s.profileId) used.add(s.profileId);
          if (!s.name.trim()) { toast(tr('Hãy nhập tên cho mọi người chơi'), 'bad'); return; }
        }
        if (!(await preMatchPreview())) return;
        const seatDefs = seats.map((s, i) => ({ id: 'seat' + i, name: s.name.trim(), avatar: s.avatar, profileId: s.profileId || null }));
        const startLocal = () => {
          const session = localSession({ dictionary: dictionary(), wordIds: P.matchWordIds(), settings: { rounds, drawTime, maxPlayers: 8 }, seats: seatDefs });
          const view = mount(root, session, { seatProfiles: Object.fromEntries(seatDefs.map((s) => [s.id, s.profileId])), onReplay: startLocal });
          view.ensureView();
          session.send({ type: 'start' }, seatDefs[0].id);
        };
        startLocal();
      } }, icon('play', { size: 20 }), tr('Bắt đầu chơi')));
  };
  clear(root).append(back(), h('div.page-title', icon('door', { size: 28 }), tr('Tạo phòng')),
    h('section.card.stack', { style: { maxWidth: '760px' } }, seg, body));
  draw();
}
