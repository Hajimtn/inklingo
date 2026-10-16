// Study group page: create / join, today's status of every member, leaderboard,
// the end-of-topic mini-game card, last results and drawing rooms of the group.

import { h, clear, toast, dialog, confirmDialog } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';
import { topics, topicById, word, photo, topicIcon } from '../vocab/data.js';
import * as P from '../vocab/progress.js';
import * as G from '../net/groups.js';

let poll = null;
let board = 'week';

const copy = (text, msg) => (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(msg, 'good')).catch(() => toast(text));
const inviteLink = (code) => `${location.origin}${location.pathname}#/group/join/${code}`;

function left(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh} giờ ${mm} phút` : `${mm} phút`;
}

export function stopGroupPolling() {
  clearInterval(poll);
  poll = null;
}

export async function renderGroup(root, arg, rest) {
  stopGroupPolling();
  const p = P.active();
  if (!G.link(p)) return renderNoGroup(root, arg === 'join' ? rest : '');
  if (arg === 'join' && rest && rest !== p.group.code) toast(`Bạn đang ở nhóm ${p.group.name || p.group.code}. Rời nhóm trước khi vào nhóm khác.`);
  const cached = G.lastState(p);
  if (cached) draw(root, cached);
  else clear(root).append(h('div.card.empty', h('h2', 'Đang tải nhóm…')));
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
      if (!cached) clear(root).append(h('div.card.empty', icon('offline', { size: 40 }), h('h2', e.message), h('button.btn.primary', { onclick: () => renderGroup(root) }, 'Thử lại')));
    }
  };
  await refresh();
  poll = setInterval(refresh, 8000);
}

// ------------------------------------------------------------------ not in a group yet

function renderNoGroup(root, code) {
  const p = P.active();
  const nameIn = h('input.input', { maxLength: 30, placeholder: 'Tên nhóm', 'aria-label': 'Tên nhóm' });
  const codeIn = h('input.input.code-input', { maxLength: 8, placeholder: 'Mã nhóm', value: code || '', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Mã nhóm' });
  const recIn = h('input.input', { placeholder: 'Mã khôi phục', autocomplete: 'off', 'aria-label': 'Mã khôi phục' });
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
  const confirmFollow = () => confirmDialog('Học theo nhóm?', `Lộ trình của hồ sơ “${p.name}” sẽ theo lịch chung của nhóm.`, 'Đồng ý');
  const createBtn = h('button.btn.primary', { type: 'submit' }, icon('plus', { size: 18 }), 'Tạo nhóm');
  const joinBtn = h('button.btn.primary', { type: 'submit' }, icon('login', { size: 18 }), 'Vào nhóm');
  const recBtn = h('button.btn', { type: 'submit' }, 'Khôi phục');
  clear(root).append(
    h('div.page-title', icon('users', { size: 28 }), 'Nhóm học'),
    h('div.grid2',
      h('form.card.stack', { onsubmit: busy(createBtn, async () => {
        if (!nameIn.value.trim()) throw new Error('Hãy đặt tên nhóm');
        if (await confirmFollow()) await G.createGroup(nameIn.value.trim(), p);
      }) }, h('h2', 'Tạo nhóm'), nameIn, createBtn),
      h('form.card.stack', { onsubmit: busy(joinBtn, async () => {
        if (codeIn.value.trim().length < 4) throw new Error('Mã nhóm không hợp lệ');
        if (await confirmFollow()) await G.joinGroup(codeIn.value.trim(), p);
      }) }, h('h2', 'Vào nhóm'), codeIn, joinBtn,
        h('details.small', h('summary', 'Dùng mã khôi phục'), h('form.join-inline', { style: { marginTop: '8px' }, onsubmit: busy(recBtn, () => G.restore(recIn.value, p)) }, recIn, recBtn)))));
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
    t ? h('div.topic-line', h('span.topic-badge', topicIcon(t, 22)), h('div', h('b', t.title), h('div.small.muted', `Chủ đề ${st.topicIdx + 1}/${topics().length} · ${st.delivered}/${st.topicSize} từ`)))
      : h('div.topic-line', h('span.topic-badge', icon('star', { size: 22 })), h('b', 'Đã học hết lộ trình')),
    t ? h('div.bar', h('i', { style: { width: (st.delivered / st.topicSize) * 100 + '%' } })) : null,
    h('div.row.between', h('h3', 'Hôm nay'), h('span.small.muted', `${st.members.filter((m) => m.learnedToday).length}/${st.members.length} đã học`)),
    h('div.member-today', st.members.map((m) => h('div.mt' + (m.learnedToday ? '.done' : ''), { title: m.learnedToday ? 'Đã học hôm nay' : 'Chưa học' },
      h('span.mt-av', avatar(m.name, m.avatar, 40), m.learnedToday ? h('span.mt-check', icon('check', { size: 12 })) : null),
      h('span.mt-name', m.id === meId ? 'Bạn' : m.name),
      m.streak > 1 ? h('span.mt-streak', { title: `Chuỗi ${m.streak} ngày` }, icon('flame', { size: 12 }), m.streak) : null))),
    todayWords.length ? h('div.today-mini', todayWords.map((w) => h('button.mini-word', { type: 'button', onclick: () => (location.hash = '#/daily/' + w.id) },
      photo(w), p.viewed[w.id] ? h('span.seen', icon('check', { size: 14 })) : h('span.new-dot', 'Mới'), h('span', { lang: 'en' }, w.en), h('small', w.vi)))) : null,
    todayWords.length && !st.my.learnedToday ? h('a.btn.primary', { href: '#/daily' }, icon('calendar', { size: 18 }), 'Học từ hôm nay') : null);

  // ---- mini-game
  const quizCard = h('section.card.stack.quiz-card');
  quizCard.append(h('div.row.between', h('h3.with-ic', icon('trophy', { size: 16 }), 'Mini-game cuối chủ đề'), st.quiz ? h('span.tag.yellow', 'Còn ' + left(st.quiz.deadline - Date.now())) : null));
  if (st.phase === 'learning') {
    quizCard.append(h('div.muted.small', `Mở khi học hết chủ đề · ${st.delivered}/${st.topicSize} từ`));
  } else if (st.phase === 'quiz-ready') {
    const btn = h('button.btn.green.big', { onclick: async () => {
      if (!(await confirmDialog('Mở mini-game?', 'Mọi người có 48 giờ để chơi.', 'Mở'))) return;
      btn.disabled = true;
      try { draw(root, await G.openQuiz(p)); } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
    } }, icon('play', { size: 20 }), 'Mở mini-game');
    quizCard.append(btn);
  } else if (st.phase === 'quiz-open') {
    const q = st.quiz;
    quizCard.append(h('div.member-today', st.members.map((m) => {
      const done = q.played.includes(m.id);
      const playing = q.playing.includes(m.id);
      return h('div.mt' + (done ? '.done' : ''), { title: done ? 'Đã chơi' : playing ? 'Đang chơi' : 'Chưa chơi' },
        h('span.mt-av', avatar(m.name, m.avatar, 40), done ? h('span.mt-check', icon('check', { size: 12 })) : playing ? h('span.mt-check.playing', icon('clock', { size: 12 })) : null),
        h('span.mt-name', m.id === meId ? 'Bạn' : m.name));
    })));
    if (q.mine) {
      quizCard.append(q.mine.done
        ? h('div.notice.result.good', icon('checkCircle', { size: 22 }), h('span', h('b', `${q.mine.score} điểm`), ` · ${q.mine.correct}/${q.total} câu · chờ cả nhóm`))
        : h('a.btn.primary', { href: '#/gquiz' }, icon('play', { size: 18 }), 'Tiếp tục chơi'));
    } else {
      quizCard.append(h('div.row',
        h('a.btn.green.big', { href: '#/gquiz/solo' }, icon('play', { size: 20 }), 'Chơi ngay'),
        h('a.btn.big', { href: '#/gquiz/live' }, icon('users', { size: 20 }), 'Chơi cùng nhau', q.lobby.length ? h('span.count-badge', q.lobby.length) : null)),
      h('div.small.muted', `${q.total} câu · 4 vòng · mỗi người chơi 1 lần`));
    }
  } else if (st.phase === 'done') {
    quizCard.append(h('div.muted', 'Nhóm đã hoàn thành tất cả chủ đề'));
  }

  // ---- last result
  let resultCard = null;
  const last = st.lastResult;
  if (last) {
    const lt = topicById(last.topicId);
    const mine = last.results.find((r) => r.memberId === meId);
    resultCard = h('section.card.stack',
      h('h3.with-ic', icon('star', { size: 16 }), `Kết quả: ${lt ? lt.title : last.topicId}`),
      h('ol.ranking', last.results.map((r, i) => h('li' + (r.memberId === meId ? '.me' : ''),
        h('span', '#' + (i + 1)),
        h('span.with-ic', avatar(r.name, r.avatar, 24), r.name, r.absent ? h('span.tag', 'Vắng') : !r.passed ? h('span.tag.red', 'Cần ôn') : null),
        h('span', `${r.correct}/${r.total} · ${r.score}`)))),
      last.forgot.length ? h('div', h('div.small.muted', { style: { marginBottom: '6px' } }, 'Từ cả nhóm hay quên'),
        h('div.chips', last.forgot.slice(0, 8).map((f) => {
          const w = word(f.wordId);
          return h('span.chip.word-chip', { title: w ? w.vi : '' }, w ? w.en : f.wordId, h('b', f.misses));
        }))) : null,
      st.my.needReview.length ? h('a.btn.primary', { href: '#/review/need' }, icon('repeat', { size: 18 }), `Ôn bù ${st.my.needReview.length} từ`) : mine && !mine.absent ? h('div.small.muted.with-ic', icon('checkCircle', { size: 14, className: 'ok' }), 'Bạn đã đạt') : null);
  }

  // ---- drawing rooms of the group
  const roomsCard = h('section.card.stack',
    h('h3.with-ic', icon('pencil', { size: 16 }), 'Vẽ cùng nhóm'),
    st.rooms.length ? h('div.stack', st.rooms.map((r) => h('div.row.between.room-row', h('span', h('b', r.code), h('span.small.muted', ` · ${r.players} người · ${r.state === 'lobby' ? 'đang chờ' : 'đang chơi'}`)), h('a.btn.small', { href: '#/join/' + r.code }, 'Vào')))) : null,
    h('a.btn', { href: '#/play/group' }, icon('door', { size: 18 }), 'Tạo phòng vẽ'));

  // ---- leaderboard
  const sorted = [...st.members].sort((a, b) => (board === 'week' ? b.week - a.week : b.total - a.total) || a.name.localeCompare(b.name));
  const lbBody = h('ol.leaderboard', sorted.map((m, i) => h('li' + (m.id === meId ? '.me' : ''),
    h('span.lb-rank', i + 1),
    avatar(m.name, m.avatar, 34),
    h('span.lb-name', h('div', h('b', m.name), m.owner ? h('span.lb-crown', { title: 'Trưởng nhóm' }, icon('crown', { size: 14 })) : null),
      h('small', m.recall === null ? 'Nhớ –' : `Nhớ ${Math.round(m.recall * 100)}%`, m.needReview ? h('span.tag.red', `Cần ôn ${m.needReview}`) : null)),
    h('span.lb-pts', board === 'week' ? m.week : m.total),
    isOwner && m.id !== meId ? h('button.icon-plain', { type: 'button', title: 'Mời ra khỏi nhóm', 'aria-label': 'Mời ' + m.name + ' ra khỏi nhóm', onclick: async () => {
      if (!(await confirmDialog(`Mời ${m.name} ra khỏi nhóm?`, '', 'Đồng ý', true))) return;
      try { draw(root, await G.kick(m.id, p)); } catch (e) { toast(e.message, 'bad'); }
    } }, icon('close', { size: 14 })) : null)));
  const seg = h('div.seg', [['week', 'Tuần này'], ['total', 'Tổng']].map(([k, label]) => h('button', { type: 'button', class: board === k ? 'on' : '', onclick: () => { board = k; draw(root, st); } }, label)));
  const lbCard = h('section.card.stack', h('div.row.between', h('h3.with-ic', icon('trophy', { size: 16 }), 'Bảng xếp hạng'), seg), lbBody);

  // ---- invite & device
  const inviteCard = h('section.card.stack',
    h('h3', 'Mời bạn bè'),
    h('div.room-code', st.code),
    h('div.row',
      h('button.btn.small', { onclick: () => copy(st.code, 'Đã chép mã nhóm') }, icon('copy', { size: 16 }), 'Chép mã'),
      h('button.btn.small', { onclick: () => copy(inviteLink(st.code), 'Đã chép link mời') }, icon('link', { size: 16 }), 'Chép link')),
    h('div.row',
      h('button.btn.small', { onclick: () => dialog({ title: 'Mã khôi phục', body: h('div.stack', h('p.small.muted', 'Dùng mã này để tiếp tục trên máy khác. Không chia sẻ cho người khác.'), h('code.recovery', G.recoveryCode(p))), buttons: [{ label: 'Chép', value: 'copy' }, { label: 'Đóng', value: null, primary: true }] }).then((v) => v === 'copy' && copy(G.recoveryCode(p), 'Đã chép mã khôi phục')) }, icon('lock', { size: 16 }), 'Mã khôi phục'),
      h('button.btn.small.danger', { onclick: async () => {
        if (!(await confirmDialog('Rời nhóm?', 'Điểm của bạn trong nhóm sẽ mất.', 'Rời nhóm', true))) return;
        try { await G.leave(p); } catch { /* unlinked anyway */ }
        toast('Đã rời nhóm');
        renderGroup(root);
      } }, icon('logout', { size: 16 }), 'Rời nhóm')));

  clear(root).append(
    h('div.page-title', icon('users', { size: 28 }), st.name, h('span.tag.yellow', `${st.members.length} thành viên`)),
    h('div.group-grid',
      h('div.stack', topicCard, quizCard, resultCard, roomsCard),
      h('div.stack', lbCard, inviteCard)));
}
