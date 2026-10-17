// Study group page: create / join, today's status of every member, leaderboard,
// the end-of-topic mini-game card, last results and drawing rooms of the group.

import { h, clear, toast, dialog, confirmDialog } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';
import { topics, topicById, word, photo, topicIcon } from '../vocab/data.js';
import * as P from '../vocab/progress.js';
import * as G from '../net/groups.js';

import { tr } from '../i18n.js';
let poll = null;
let board = 'week';

const copy = (text, msg) => (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(msg, 'good')).catch(() => toast(text));
const inviteLink = (code) => `${location.origin}${location.pathname}#/group/join/${code}`;

function left(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? tr('{h} giờ {m} phút', { h: hh, m: mm }) : tr('{m} phút', { m: mm });
}

export function stopGroupPolling() {
  clearInterval(poll);
  poll = null;
}

export async function renderGroup(root, arg, rest) {
  stopGroupPolling();
  const p = P.active();
  if (!G.link(p)) return renderNoGroup(root, arg === 'join' ? rest : '');
  if (arg === 'join' && rest && rest !== p.group.code) toast(tr('Bạn đang ở nhóm {name}. Rời nhóm trước khi vào nhóm khác.', { name: p.group.name || p.group.code }));
  const cached = G.lastState(p);
  if (cached) draw(root, cached);
  else clear(root).append(h('div.card.empty', h('h2', tr('Đang tải nhóm…'))));
  const refresh = async () => {
    if (!document.body.contains(root) || !location.hash.startsWith('#/group')) return stopGroupPolling();
    try {
      const st = await G.sync(p);
      if (!G.link(p)) return renderNoGroup(root, '');
      // Do not redraw under the user's fingers (typing / open dialog).
      if (root.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
      if (document.querySelector('.dialog-layer')) return;
      // Redraw only when something changed, so buttons are not replaced under the pointer.
      const sig = JSON.stringify(st);
      if (sig === root.dataset.sig) return;
      draw(root, st);
    } catch (e) {
      if (!G.link(p)) return renderNoGroup(root, '');
      if (!cached) clear(root).append(h('div.card.empty', icon('offline', { size: 40 }), h('h2', e.message), h('button.btn.primary', { onclick: () => renderGroup(root) }, tr('Thử lại'))));
    }
  };
  await refresh();
  poll = setInterval(refresh, 8000);
}

// ------------------------------------------------------------------ not in a group yet

function renderNoGroup(root, code) {
  const p = P.active();
  const nameIn = h('input.input', { maxLength: 30, placeholder: tr('Tên nhóm'), 'aria-label': tr('Tên nhóm') });
  const codeIn = h('input.input.code-input', { maxLength: 8, placeholder: tr('Mã nhóm'), value: code || '', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': tr('Mã nhóm') });
  const recIn = h('input.input', { placeholder: tr('Mã khôi phục'), autocomplete: 'off', 'aria-label': tr('Mã khôi phục') });
  const busy = (btn, fn) => async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      await fn();
      renderGroup(root);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  };
  const confirmFollow = () => confirmDialog(tr('Học theo nhóm?'), tr('Lộ trình của hồ sơ “{name}” sẽ theo lịch chung của nhóm.', { name: p.name }), tr('Đồng ý'));
  const createBtn = h('button.btn.primary', { type: 'submit' }, icon('plus', { size: 18 }), tr('Tạo nhóm'));
  const joinBtn = h('button.btn.primary', { type: 'submit' }, icon('login', { size: 18 }), tr('Vào nhóm'));
  const recBtn = h('button.btn', { type: 'submit' }, tr('Khôi phục'));
  clear(root).append(
    h('div.page-title', icon('users', { size: 28 }), tr('Nhóm học')),
    h('div.grid2',
      h('form.card.stack', { onsubmit: busy(createBtn, async () => {
        if (!nameIn.value.trim()) throw new Error(tr('Hãy đặt tên nhóm'));
        if (await confirmFollow()) await G.createGroup(nameIn.value.trim(), p);
      }) }, h('h2', tr('Tạo nhóm')), nameIn, createBtn),
      h('form.card.stack', { onsubmit: busy(joinBtn, async () => {
        if (codeIn.value.trim().length < 4) throw new Error(tr('Mã nhóm không hợp lệ'));
        if (await confirmFollow()) await G.joinGroup(codeIn.value.trim(), p);
      }) }, h('h2', tr('Vào nhóm')), codeIn, joinBtn,
        h('details.small', h('summary', tr('Dùng mã khôi phục')), h('form.join-inline', { style: { marginTop: '8px' }, onsubmit: busy(recBtn, () => G.restore(recIn.value, p)) }, recIn, recBtn)))));
  (code ? codeIn : nameIn).focus();
}

// ------------------------------------------------------------------ group page

function draw(root, st) {
  root.dataset.sig = JSON.stringify(st);
  const p = P.active();
  const meId = st.me;
  const isOwner = st.ownerId === meId;
  const t = st.topicId ? topicById(st.topicId) : null;

  // ---- current topic + today
  const todayWords = (st.todayBatch || []).map(word).filter(Boolean);
  const topicCard = h('section.card.stack',
    t ? h('div.topic-line', h('span.topic-badge', topicIcon(t, 22)), h('div', h('b', t.title), h('div.small.muted', tr('Chủ đề {i}/{n} · {d}/{s} từ', { i: st.topicIdx + 1, n: topics().length, d: st.delivered, s: st.topicSize }))))
      : h('div.topic-line', h('span.topic-badge', icon('star', { size: 22 })), h('b', tr('Đã học hết lộ trình'))),
    t ? h('div.bar', h('i', { style: { width: (st.delivered / st.topicSize) * 100 + '%' } })) : null,
    h('div.row.between', h('h3', tr('Hôm nay')), h('span.small.muted', tr('{c}/{n} đã học', { c: st.members.filter((m) => m.learnedToday).length, n: st.members.length }))),
    h('div.member-today', st.members.map((m) => h('div.mt' + (m.learnedToday ? '.done' : ''), { title: m.learnedToday ? tr('Đã học hôm nay') : tr('Chưa học') },
      h('span.mt-av', avatar(m.name, m.avatar, 40), m.learnedToday ? h('span.mt-check', icon('check', { size: 12 })) : null),
      h('span.mt-name', m.id === meId ? tr('Bạn') : m.name),
      m.streak > 1 ? h('span.mt-streak', { title: tr('Chuỗi {n} ngày', { n: m.streak }) }, icon('flame', { size: 12 }), m.streak) : null))),
    todayWords.length ? h('div.today-mini', todayWords.map((w) => h('button.mini-word', { type: 'button', onclick: () => (location.hash = '#/daily/' + w.id) },
      photo(w), p.viewed[w.id] ? h('span.seen', icon('check', { size: 14 })) : h('span.new-dot', tr('Mới')), h('span', { lang: 'en' }, w.en), h('small', w.vi)))) : null,
    todayWords.length && !st.my.learnedToday ? h('a.btn.primary', { href: '#/daily' }, icon('calendar', { size: 18 }), tr('Học từ hôm nay')) : null);

  // ---- mini-game
  const quizCard = h('section.card.stack.quiz-card');
  quizCard.append(h('div.row.between', h('h3.with-ic', icon('trophy', { size: 16 }), tr('Mini-game cuối chủ đề')), st.quiz ? h('span.tag.yellow', tr('Còn ') + left(st.quiz.deadline - Date.now())) : null));
  if (st.phase === 'learning') {
    quizCard.append(h('div.muted.small', tr('Mở khi học hết chủ đề · {d}/{s} từ', { d: st.delivered, s: st.topicSize })));
  } else if (st.phase === 'quiz-ready') {
    const btn = h('button.btn.green.big', { onclick: async () => {
      if (!(await confirmDialog(tr('Mở mini-game?'), tr('Mọi người có 48 giờ để chơi.'), tr('Mở')))) return;
      btn.disabled = true;
      try { draw(root, await G.openQuiz(p)); } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    } }, icon('play', { size: 20 }), tr('Mở mini-game'));
    quizCard.append(btn);
  } else if (st.phase === 'quiz-open') {
    const q = st.quiz;
    quizCard.append(h('div.member-today', st.members.map((m) => {
      const done = q.played.includes(m.id);
      const playing = q.playing.includes(m.id);
      return h('div.mt' + (done ? '.done' : ''), { title: done ? tr('Đã chơi') : playing ? tr('Đang chơi') : tr('Chưa chơi') },
        h('span.mt-av', avatar(m.name, m.avatar, 40), done ? h('span.mt-check', icon('check', { size: 12 })) : playing ? h('span.mt-check.playing', icon('clock', { size: 12 })) : null),
        h('span.mt-name', m.id === meId ? tr('Bạn') : m.name));
    })));
    if (q.mine) {
      quizCard.append(q.mine.done
        ? h('div.notice.result.good', icon('checkCircle', { size: 22 }), h('span', h('b', tr('{n} điểm', { n: q.mine.score })), ' · ' + tr('{c}/{n} câu · chờ cả nhóm', { c: q.mine.correct, n: q.total })))
        : h('a.btn.primary', { href: '#/gquiz' }, icon('play', { size: 18 }), tr('Tiếp tục chơi')));
    } else {
      quizCard.append(h('div.row',
        h('a.btn.green.big', { href: '#/gquiz/solo' }, icon('play', { size: 20 }), tr('Chơi ngay')),
        h('a.btn.big', { href: '#/gquiz/live' }, icon('users', { size: 20 }), tr('Chơi cùng nhau'), q.lobby.length ? h('span.count-badge', q.lobby.length) : null)),
      h('div.small.muted', tr('{n} câu · 4 vòng · mỗi người chơi 1 lần', { n: q.total })));
    }
  } else if (st.phase === 'done') {
    quizCard.append(h('div.muted', tr('Nhóm đã hoàn thành tất cả chủ đề')));
  }

  // ---- last result
  let resultCard = null;
  const last = st.lastResult;
  if (last) {
    const lt = topicById(last.topicId);
    const mine = last.results.find((r) => r.memberId === meId);
    resultCard = h('section.card.stack',
      h('h3.with-ic', icon('star', { size: 16 }), tr('Kết quả: {topic}', { topic: lt ? lt.title : last.topicId })),
      h('ol.ranking', last.results.map((r, i) => h('li' + (r.memberId === meId ? '.me' : ''),
        h('span', '#' + (i + 1)),
        h('span.with-ic', avatar(r.name, r.avatar, 24), r.name, r.absent ? h('span.tag', tr('Vắng')) : !r.passed ? h('span.tag.red', tr('Cần ôn')) : null),
        h('span', `${r.correct}/${r.total} · ${r.score}`)))),
      last.forgot.length ? h('div', h('div.small.muted', { style: { marginBottom: '6px' } }, tr('Từ cả nhóm hay quên')),
        h('div.chips', last.forgot.slice(0, 8).map((f) => {
          const w = word(f.wordId);
          return h('span.chip.word-chip', { title: w ? w.vi : '' }, w ? w.en : f.wordId, h('b', f.misses));
        }))) : null,
      st.my.needReview.length ? h('a.btn.primary', { href: '#/review/need' }, icon('repeat', { size: 18 }), tr('Ôn bù {n} từ', { n: st.my.needReview.length })) : mine && !mine.absent ? h('div.small.muted.with-ic', icon('checkCircle', { size: 14, className: 'ok' }), tr('Bạn đã đạt')) : null);
  }

  // ---- drawing rooms of the group
  const roomsCard = h('section.card.stack',
    h('h3.with-ic', icon('pencil', { size: 16 }), tr('Vẽ cùng nhóm')),
    st.rooms.length ? h('div.stack', st.rooms.map((r) => h('div.row.between.room-row', h('span', h('b', r.code), h('span.small.muted', ' · ' + tr('{n} người', { n: r.players }) + ' · ' + (r.state === 'lobby' ? tr('đang chờ') : tr('đang chơi')))), h('a.btn.small', { href: '#/join/' + r.code }, tr('Vào'))))) : null,
    h('a.btn', { href: '#/play/group' }, icon('door', { size: 18 }), tr('Tạo phòng vẽ')));

  // ---- leaderboard
  const sorted = [...st.members].sort((a, b) => (board === 'week' ? b.week - a.week : b.total - a.total) || a.name.localeCompare(b.name));
  const lbBody = h('ol.leaderboard', sorted.map((m, i) => h('li' + (m.id === meId ? '.me' : ''),
    h('span.lb-rank', i + 1),
    avatar(m.name, m.avatar, 34),
    h('span.lb-name', h('div', h('b', m.name), m.owner ? h('span.lb-crown', { title: tr('Trưởng nhóm') }, icon('crown', { size: 14 })) : null),
      h('small', m.recall === null ? tr('Nhớ –') : tr('Nhớ {p}%', { p: Math.round(m.recall * 100) }), m.needReview ? h('span.tag.red', tr('Cần ôn {n}', { n: m.needReview })) : null)),
    h('span.lb-pts', board === 'week' ? m.week : m.total),
    isOwner && m.id !== meId ? h('button.icon-plain', { type: 'button', title: tr('Mời ra khỏi nhóm'), 'aria-label': tr('Mời ') + m.name + tr(' ra khỏi nhóm'), onclick: async () => {
      if (!(await confirmDialog(tr('Mời {name} ra khỏi nhóm?', { name: m.name }), '', tr('Đồng ý'), true))) return;
      try { draw(root, await G.kick(m.id, p)); } catch (e) { toast(e.message, 'bad'); }
    } }, icon('close', { size: 14 })) : null)));
  const seg = h('div.seg', [['week', tr('Tuần này')], ['total', tr('Tổng')]].map(([k, label]) => h('button', { type: 'button', class: board === k ? 'on' : '', onclick: () => { board = k; draw(root, st); } }, label)));
  const lbCard = h('section.card.stack', h('div.row.between', h('h3.with-ic', icon('trophy', { size: 16 }), tr('Bảng xếp hạng')), seg), lbBody);

  // ---- invite & device
  const inviteCard = h('section.card.stack',
    h('h3', tr('Mời bạn bè')),
    h('div.room-code', st.code),
    h('div.row',
      h('button.btn.small', { onclick: () => copy(st.code, tr('Đã chép mã nhóm')) }, icon('copy', { size: 16 }), tr('Chép mã')),
      h('button.btn.small', { onclick: () => copy(inviteLink(st.code), tr('Đã chép link mời')) }, icon('link', { size: 16 }), tr('Chép link'))),
    h('div.row',
      h('button.btn.small', { onclick: () => dialog({ title: tr('Mã khôi phục'), body: h('div.stack', h('p.small.muted', tr('Dùng mã này để tiếp tục trên máy khác. Không chia sẻ cho người khác.')), h('code.recovery', G.recoveryCode(p))), buttons: [{ label: tr('Chép'), value: 'copy' }, { label: tr('Đóng'), value: null, primary: true }] }).then((v) => v === 'copy' && copy(G.recoveryCode(p), tr('Đã chép mã khôi phục'))) }, icon('lock', { size: 16 }), tr('Mã khôi phục')),
      h('button.btn.small.danger', { onclick: async () => {
        if (!(await confirmDialog(tr('Rời nhóm?'), tr('Điểm của bạn trong nhóm sẽ mất.'), tr('Rời nhóm'), true))) return;
        try { await G.leave(p); } catch { /* unlinked anyway */ }
        toast(tr('Đã rời nhóm'));
        renderGroup(root);
      } }, icon('logout', { size: 16 }), tr('Rời nhóm'))));

  clear(root).append(
    h('div.page-title', icon('users', { size: 28 }), st.name, h('span.tag.yellow', tr('{n} thành viên', { n: st.members.length }))),
    h('div.group-grid',
      h('div.stack', topicCard, quizCard, resultCard, roomsCard),
      h('div.stack', lbCard, inviteCard)));
}
