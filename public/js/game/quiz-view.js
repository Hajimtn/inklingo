// Group mini-game screen ("Đấu trường chủ đề"). The server sends one question at a time and
// keeps the answers, the clock and the score; this view only renders and submits.
//   #/gquiz        resume (or choose)
//   #/gquiz/solo   play alone now
//   #/gquiz/live   wait in the live lobby and play together

import { h, clear, toast, speak } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';
import { topicById, word } from '../vocab/data.js';
import { ROUNDS, decodeSay } from '../shared/quiz-core.js';
import * as online from '../net/online.js';
import * as P from '../vocab/progress.js';
import * as G from '../net/groups.js';

const ROUND_ICON = { photo: 'image', listen: 'volume', gap: 'test', meaning: 'book' };
let active = null;

export function leaveGroupQuiz() {
  active?.destroy();
  active = null;
}

export async function renderGroupQuiz(root, mode) {
  leaveGroupQuiz();
  const p = P.active();
  if (!G.link(p)) {
    location.hash = '#/group';
    return;
  }
  clear(root).append(h('div.card.empty', h('h2', 'Đang kết nối…')));
  const st = G.lastState(p) || (await G.syncQuick(p));
  active = new QuizView(root, p, st, mode);
}

class QuizView {
  constructor(root, p, st, mode) {
    Object.assign(this, { root, p, st, mode });
    this.members = Object.fromEntries((st?.members || []).map((m) => [m.id, m]));
    this.timerEl = null;
    this.tick = setInterval(() => this.updateTimer(), 200);
    this.off = online.onMessage((m) => this.onMsg(m));
    online.connect();
    this.send('resume');
  }

  destroy() {
    clearInterval(this.tick);
    this.off?.();
    if (this.inLobby) this.send('unlobby');
  }

  send(action, extra = {}) {
    const g = this.p.group;
    online.send({ type: 'gq', action, code: g.code, memberId: g.memberId, secret: g.secret, ...extra });
  }

  member(id) {
    return this.members[id] || { name: id === this.p.group.memberId ? this.p.name : '?', avatar: 'c7' };
  }

  shell(...kids) {
    const t = this.st?.quiz ? topicById(this.st.quiz.topicId) : null;
    clear(this.root).append(
      h('a.back-link', { href: '#/group' }, icon('back', { size: 16 }), 'Nhóm'),
      h('section.card.quiz-stage.stack', t ? h('div.small.muted.quiz-topic', t.title) : null, ...kids));
  }

  onMsg(m) {
    if (!m.type?.startsWith('gq-')) return;
    if (m.type !== 'gq-error' && !document.body.contains(this.root)) return;
    switch (m.type) {
      case 'gq-idle': return this.idle(m);
      case 'gq-lobby': return this.lobby(m.members);
      case 'gq-countdown': return this.countdown(m);
      case 'gq-question': return this.question(m);
      case 'gq-ack': return this.acked(m.index);
      case 'gq-answered': return this.answered(m);
      case 'gq-reveal': return this.reveal(m);
      case 'gq-done': return this.done(m);
      case 'gq-error':
        toast(m.text, 'bad');
        if (m.fatal) location.hash = '#/group';
    }
  }

  // ---------------------------------------------------------------- before playing

  idle(m) {
    if (!m.eligible) {
      this.shell(h('h2', 'Bạn đã chơi rồi'), h('a.btn.primary', { href: '#/group' }, 'Về nhóm'));
      return;
    }
    if (this.mode === 'live' || m.inLobby) {
      this.send('lobby');
      this.inLobby = true;
      return this.lobby(m.lobby);
    }
    const q = this.st?.quiz;
    this.shell(
      h('h2', 'Đấu trường chủ đề'),
      h('div.round-chips', ROUNDS.map((r) => h('span.chip', icon(ROUND_ICON[r.type], { size: 16 }), r.label))),
      h('div.small.muted', `${q ? q.total + ' câu · ' : ''}chỉ chơi 1 lần · đồng hồ không dừng`),
      h('div.row',
        h('button.btn.green.big', { onclick: (e) => { e.target.disabled = true; this.send('solo'); } }, icon('play', { size: 20 }), 'Bắt đầu'),
        h('a.btn.big', { href: '#/gquiz/live', onclick: () => (this.mode = 'live') }, icon('users', { size: 20 }), 'Chơi cùng nhau')));
  }

  lobby(ids) {
    if (!this.inLobby && this.mode !== 'live') return;
    this.inLobby = true;
    const me = this.p.group.memberId;
    if (!ids.includes(me)) ids = [...ids, me];
    const startBtn = h('button.btn.green.big', { disabled: ids.length < 2, onclick: (e) => { e.target.disabled = true; this.send('live'); } }, icon('play', { size: 20 }), ids.length < 2 ? 'Chờ thêm người…' : 'Bắt đầu');
    this.shell(
      h('h2', 'Phòng chờ'),
      h('div.lobby-players', ids.map((id) => h('div.lobby-player', avatar(this.member(id).name, this.member(id).avatar, 48), h('div.nm', id === me ? 'Bạn' : this.member(id).name)))),
      h('div.row', startBtn,
        h('button.btn', { onclick: () => { this.send('unlobby'); this.inLobby = false; location.hash = '#/group'; } }, 'Rời phòng chờ')));
  }

  countdown(m) {
    this.inLobby = false;
    this.deadline = m.endsAt;
    this.timerEl = h('div.big-score');
    this.timerKind = 'count';
    this.shell(h('div.small.muted', `${m.total} câu`), h('h2', 'Chuẩn bị!'), this.timerEl,
      m.members ? h('div.answered-row', m.members.map((id) => avatar(this.member(id).name, this.member(id).avatar, 32))) : null);
    this.updateTimer();
  }

  // ---------------------------------------------------------------- question

  question(m) {
    this.inLobby = false;
    const q = m.q;
    this.q = q;
    this.live = m.live;
    this.deadline = m.endsAt;
    this.timerKind = 'q';
    this.sent = !!m.youAnswered;
    this.timerEl = h('div.q-timer', h('i'));
    this.answeredRow = m.live ? h('div.answered-row') : null;
    const head = h('div.q-head',
      h('span.tag.blue.with-ic', icon(ROUND_ICON[q.type], { size: 14 }), `Vòng ${q.round + 1} · ${q.roundLabel}`),
      h('span.small.muted', `Câu ${q.index + 1}/${q.total}`));
    const body = h('div.q-body');
    this.status = h('div.q-status.small.muted');
    const choose = (opt, btn, all) => {
      if (this.sent) return;
      this.sent = true;
      all.forEach((b) => (b.disabled = true));
      btn.classList.add('chosen');
      this.send('answer', { index: q.index, value: opt });
      this.status.textContent = 'Đã gửi';
    };
    const options = () => {
      const btns = q.options.map((o) => h('button.btn', { type: 'button', lang: 'en', disabled: this.sent }, o));
      btns.forEach((b, i) => b.addEventListener('click', () => choose(q.options[i], b, btns)));
      return h('div.options', btns);
    };
    const typed = (placeholder) => {
      const inp = h('input.answer-input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder, 'aria-label': 'Đáp án', disabled: this.sent, lang: 'en' });
      const form = h('form.stack', { onsubmit: (e) => {
        e.preventDefault();
        if (this.sent || !inp.value.trim()) return;
        this.sent = true;
        inp.disabled = true;
        form.querySelector('button').disabled = true;
        this.send('answer', { index: q.index, value: inp.value });
        this.status.textContent = 'Đã gửi';
      } }, inp, h('button.btn.primary', { type: 'submit', disabled: this.sent }, 'Gửi'));
      setTimeout(() => inp.focus(), 30);
      return form;
    };
    if (q.type === 'photo') {
      body.append(h('div.photo-frame.q-photo', h('img', { src: q.img, alt: 'Ảnh câu hỏi', draggable: false })), options());
    } else if (q.type === 'listen') {
      const say = () => speak(decodeSay(q.say));
      body.append(h('div.q-listen', h('button.btn.icon-btn.speak-btn.big-speak', { type: 'button', onclick: say, 'aria-label': 'Nghe lại', title: 'Nghe lại' }, icon('volume', { size: 30 })), h('div.letter-hint', q.mask)), typed('Gõ từ bạn nghe được'));
      setTimeout(say, 250);
    } else if (q.type === 'gap') {
      body.append(h('p.q-sentence', { lang: 'en' }, q.sentence), options());
    } else {
      body.append(h('div.q-meaning', h('div.meaning', q.vi), h('div.letter-hint', q.mask)), typed('Từ tiếng Anh'));
    }
    if (this.sent) this.status.textContent = 'Đã gửi';
    this.shell(head, this.timerEl, body, this.status, this.answeredRow);
    if (m.answered && this.answeredRow) this.answered({ index: q.index, answered: m.answered });
    this.updateTimer();
  }

  acked(index) {
    if (this.q?.index === index) this.status.textContent = this.live ? 'Đã gửi – chờ mọi người' : 'Đã gửi';
  }

  answered({ index, answered }) {
    if (!this.answeredRow || this.q?.index !== index) return;
    clear(this.answeredRow).append(...answered.map((id) => h('span.ans-av', { title: this.member(id).name }, avatar(this.member(id).name, this.member(id).avatar, 28))));
  }

  // ---------------------------------------------------------------- reveal / end

  reveal(m) {
    this.timerKind = 'reveal';
    this.deadline = m.endsAt;
    const w = word(m.answer.wordId);
    const me = this.p.group.memberId;
    if (w) setTimeout(() => speak(w.en), 150);
    this.shell(
      h('div.q-head', h('span.small.muted', `Câu ${m.index + 1}/${m.total}`), h('span.tag.yellow', `${m.score} điểm`)),
      h('div.notice.result' + (m.you.ok ? '.good' : '.bad'), icon(m.you.ok ? 'checkCircle' : 'xCircle', { size: 22 }),
        h('span', h('b', m.you.ok ? `Đúng! +${m.you.points}` : 'Chưa đúng'), m.you.given && !m.you.ok ? ` · bạn trả lời: ${m.you.given}` : '')),
      h('div.reveal-word', h('div.word-big', { lang: 'en' }, m.answer.en), w ? h('div', h('span.ipa', w.ipa), ' · ', h('span.meaning', { style: { margin: 0 } }, w.vi)) : null),
      m.answer.sentence ? h('p.q-sentence', { lang: 'en' }, m.answer.sentence) : null,
      m.others ? h('ol.leaderboard.compact', [...m.others].sort((a, b) => b.score - a.score).map((o, i) => h('li' + (o.id === me ? '.me' : ''),
        h('span.lb-rank', i + 1), avatar(this.member(o.id).name, this.member(o.id).avatar, 28),
        h('span.lb-name', h('b', o.id === me ? 'Bạn' : this.member(o.id).name)),
        o.ok ? icon('check', { size: 16, className: 'ok' }) : icon('close', { size: 16, className: 'bad' }),
        h('span.lb-pts', o.score)))) : null,
      m.live ? h('div.small.muted', 'Câu tiếp theo sắp bắt đầu…') : h('button.btn.primary', { onclick: (e) => { e.target.disabled = true; this.send('skip'); } }, 'Câu tiếp', icon('next', { size: 18 })));
  }

  done(m) {
    this.timerKind = null;
    const pct = m.total ? m.correct / m.total : 0;
    const passed = pct >= 0.8;
    const missed = m.missed.map(word).filter(Boolean);
    this.shell(
      h('h2', 'Hoàn thành!'),
      h('div.big-score', m.score),
      h('p', { style: { textAlign: 'center', margin: 0 } }, `${m.correct}/${m.total} câu đúng · ${Math.round(pct * 100)}%`),
      h('div.notice.result' + (passed ? '.good' : '.bad'), icon(passed ? 'star' : 'info', { size: 22 }), h('span', passed ? 'Đạt' : 'Chưa đạt 80% – ôn lại các từ sai sau khi cả nhóm chơi xong')),
      missed.length ? h('div.chips', missed.map((w) => h('span.chip.word-chip', { title: w.vi }, w.en))) : null,
      h('a.btn.primary', { href: '#/group' }, 'Về nhóm'));
    G.sync(this.p).catch(() => {});
  }

  updateTimer() {
    if (!this.timerEl || !this.deadline || !document.body.contains(this.timerEl)) return;
    const msLeft = this.deadline - online.serverNow();
    if (this.timerKind === 'count') this.timerEl.textContent = Math.max(1, Math.ceil(msLeft / 1000));
    if (this.timerKind === 'q') {
      const f = Math.max(0, Math.min(1, msLeft / this.q.limit));
      this.timerEl.firstChild.style.width = f * 100 + '%';
      this.timerEl.classList.toggle('warn', f < 0.35);
    }
  }
}
