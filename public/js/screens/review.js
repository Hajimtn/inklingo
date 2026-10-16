// Word Recall: short sessions (up to 10 words) of delayed, typed recall in three rotating challenges –
// listen & write, meaning -> word, word in context. Nothing on screen contains the answer (no photo,
// no English text) until the player has answered, and pasting is blocked. The schedule lives in
// vocab/progress.js (day 2 -> 4 -> 8 -> 15 -> 30).

import { h, clear, speak } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';
import { speakBtn } from './learn.js';
import { photoFigure } from '../vocab/data.js';
import { normalizeAnswer } from '../shared/game-core.js';
import { wordForms } from '../shared/quiz-core.js';
import * as P from '../vocab/progress.js';

const TYPES = {
  listen: { label: 'Nghe và viết', ic: 'volume' },
  meaning: { label: 'Nhớ nghĩa', ic: 'book' },
  context: { label: 'Điền vào câu', ic: 'test' },
};
const LADDER = ['Ngày 2', 'Ngày 4', 'Ngày 8', 'Ngày 15', 'Ngày 30', 'Đã thuộc'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mask = (s) => [...s].map((c) => (/[\s-]/.test(c) ? c : '_')).join(' ');
const pct = (r) => (r ? Math.round((r.ok / r.n) * 100) + '%' : '–');
const shortDate = (d) => `${P.DAY_NAMES[P.weekday(d)]}, ${d.slice(8)}/${d.slice(5, 7)}`;

/** The word as used in its example sentence (shipped, receipts…), or null. */
function contextOf(w) {
  const m = w.ex[0].match(new RegExp(`\\b(?:${wordForms(w.en).map(esc).join('|')})\\b`, 'i'));
  return m ? { form: m[0], before: w.ex[0].slice(0, m.index), after: w.ex[0].slice(m.index + m[0].length) } : null;
}

export function renderReview(root, mode) {
  const prof = P.active();
  const onlyNeeded = mode === 'need';
  const due = P.dueWords(prof, onlyNeeded);
  const learned = P.learnedWords(prof).length;
  const head = h('div.page-head', h('h1.page-title', 'Word Recall'), P.isWeekend() ? h('span.tag.yellow', 'Ngày ôn tập') : null);

  const start = (words, counted) => play(root, mode, words.slice(0, P.SESSION_MAX), counted);
  const hero = h('section.card.wr-hero');
  if (!learned) {
    hero.append(h('div.wr-count', h('b', '0'), h('span', 'từ để ôn')),
      h('a.btn.primary.big', { href: '#/daily' }, icon('calendar', { size: 20 }), 'Học từ hôm nay'));
  } else if (due.length) {
    hero.append(
      h('div.wr-count', h('b', due.length), h('span', onlyNeeded ? 'từ cần ôn để làm lại bài kiểm tra' : 'từ đến hạn hôm nay')),
      typeChips(),
      h('button.btn.primary.big', { onclick: () => start(due, true) }, icon('play', { size: 20 }), due.length > P.SESSION_MAX ? `Bắt đầu ${P.SESSION_MAX} từ` : 'Bắt đầu'));
  } else {
    const next = P.nextDue(prof);
    hero.append(
      h('div.wr-count.done', icon('checkCircle', { size: 30 }), h('span', 'Không có từ đến hạn')),
      next ? h('p.muted.wr-next', icon('clock', { size: 16 }), `Lần tới: ${shortDate(next)}`) : null,
      typeChips(),
      h('button.btn.big', { onclick: () => start(P.practiceWords(P.SESSION_MAX, prof), false) }, icon('repeat', { size: 20 }), 'Luyện thêm'),
      h('small.muted', 'Luyện thêm không tính điểm'));
  }

  const lad = P.ladder(prof);
  const max = Math.max(1, ...lad);
  const ladderCard = h('section.card.side-card', h('div.section-head', h('h2', 'Lịch nhớ')),
    h('ol.wr-ladder', LADDER.map((label, i) => h('li' + (i === LADDER.length - 1 ? '.last' : ''),
      h('span', label), h('div.bar', h('i', { style: { width: (lad[i] / max) * 100 + '%' } })), h('b', lad[i])))));

  const rs = P.recallStats(prof);
  const rateCard = h('section.card.side-card', h('div.section-head', h('h2', 'Tỷ lệ nhớ')),
    h('div.wr-rates',
      Object.entries(TYPES).map(([t, d]) => h('div', icon(d.ic, { size: 18 }), h('b', pct(rs.byType[t])), h('small', d.label))),
      h('div.late', icon('clock', { size: 18 }), h('b', pct(rs.late)), h('small', 'Sau ≥ 7 ngày'))));

  const board = prof.group && prof.groupMirror?.recallBoard;
  const weekCard = h('section.card.side-card', h('div.section-head', h('h2', 'Tuần này'), h('span.small.muted', 'từ nhớ đúng')),
    board && board.length > 1
      ? h('ol.wr-board', [...board].sort((a, b) => b.n - a.n).map((m, i) => h('li' + (m.me ? '.me' : ''), h('span.rank', i + 1), avatar(m.name, m.avatar, 30), h('span.name', m.name), h('b', m.n))))
      : h('div.wr-week', h('b', board ? board.find((m) => m.me)?.n ?? rs.week : rs.week), h('span', 'từ')));

  clear(root).append(head, h('div.wr-home', hero, h('div.stack', ladderCard, rateCard, weekCard)));
}

const typeChips = () => h('div.wr-types', Object.values(TYPES).map((d) => h('span', icon(d.ic, { size: 16 }), d.label)));

function play(root, mode, words, counted) {
  const prof = P.active();
  // Each item is one challenge; a missed word comes back once at the end (not counted).
  const queue = words.map((w) => {
    const ctx = contextOf(w);
    return { w, ctx, type: P.nextChallenge(w.id, ctx ? Object.keys(TYPES) : ['listen', 'meaning'], prof), counted, retry: false };
  });
  const firstCount = queue.length;
  const results = [];
  let k = 0;
  const card = h('section.card.wr-play');
  clear(root).append(h('div.page-head', h('h1.page-title', 'Word Recall'), counted ? null : h('span.tag', 'Luyện thêm')), card);

  const next = () => {
    if (k >= queue.length) return summary();
    const item = queue[k];
    const { w, type, ctx } = item;
    const answers = [...(type === 'context' && ctx ? [ctx.form] : []), w.en, ...w.alt].map(normalizeAnswer);
    const inp = h('input.answer-input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, enterkeyhint: 'done',
      placeholder: 'Gõ từ tiếng Anh…', 'aria-label': 'Đáp án',
    });
    // Recall means typing it yourself: no paste, no drag-and-drop.
    const block = (e) => { e.preventDefault(); toastOnce(card); };
    inp.addEventListener('paste', block);
    inp.addEventListener('drop', block);
    inp.addEventListener('beforeinput', (e) => { if (/^insertFrom(Paste|Drop)/.test(e.inputType)) block(e); });

    const say = (rate) => speak(w.en, rate);
    let prompt;
    if (type === 'listen') {
      prompt = h('div.wr-prompt',
        h('div.row.center', h('button.btn.wr-audio', { type: 'button', onclick: () => say(), 'aria-label': 'Nghe lại' }, icon('volume', { size: 30 })),
          h('button.btn.small', { type: 'button', onclick: () => say(0.55) }, 'Nghe chậm')),
        h('div.letter-hint', mask(w.en)), h('small.muted', w.pos));
      setTimeout(() => say(), 250);
    } else if (type === 'meaning') {
      prompt = h('div.wr-prompt', h('div.meaning', w.vi), h('p.wr-explain', w.explain), h('div.letter-hint', mask(w.en)), h('small.muted', w.pos));
    } else {
      prompt = h('div.wr-prompt', h('p.wr-sentence', ctx.before, h('span.gap', mask(ctx.form)), ctx.after));
    }

    const feedback = h('div');
    const nextBtn = h('button.btn.primary', { hidden: true, onclick: () => { k++; next(); } });
    const submit = h('button.btn.primary', { type: 'submit' }, 'Kiểm tra');
    const form = h('form.stack', { onsubmit: (e) => {
      e.preventDefault();
      if (inp.disabled || !inp.value.trim()) return;
      const ok = answers.includes(normalizeAnswer(inp.value));
      inp.disabled = true;
      submit.hidden = true;
      inp.classList.add(ok ? 'right' : 'wrong');
      P.recordWordRecall(w.id, type, ok, item.counted);
      if (!item.retry) results.push({ w, ok, counted: item.counted });
      if (!ok && !item.retry) queue.push({ ...item, counted: false, retry: true });
      const due = P.dueDate(w.id);
      feedback.replaceChildren(h('div.wr-reveal',
        h('div.notice.result' + (ok ? '.good' : '.bad'), icon(ok ? 'checkCircle' : 'xCircle', { size: 22 }),
          h('span', h('b', ok ? 'Chính xác' : 'Chưa đúng'), item.counted && due ? h('small.muted', ` · lần tới ${shortDate(due)}`) : item.retry ? h('small.muted', ' · ôn lại') : null)),
        h('div.wr-answer',
          photoFigure(w, { short: true }),
          h('div.stack',
            h('div.row.word-head', h('div.word-big', { lang: 'en' }, type === 'context' && ctx ? ctx.form : w.en), speakBtn(w.en)),
            h('div.ipa', w.ipa), type === 'meaning' ? null : h('div.meaning', w.vi),
            h('div.example', h('div', { lang: 'en' }, w.ex[0]), h('div.vi', w.ex[1]))))));
      if (type !== 'listen') say();
      nextBtn.replaceChildren(...(k === queue.length - 1 ? ['Kết thúc'] : ['Tiếp', icon('next', { size: 18 })]));
      nextBtn.hidden = false;
      nextBtn.focus();
    } }, inp, submit);

    const n = Math.min(k + 1, firstCount);
    clear(card).append(
      h('div.row.between', h('span.wr-type', icon(TYPES[type].ic, { size: 18 }), TYPES[type].label), h('b', item.retry ? 'Ôn lại' : `${n}/${firstCount}`)),
      h('div.wr-steps', queue.slice(0, firstCount).map((_, i) => h('i' + (i < k ? '.done' : i === k ? '.now' : '')))),
      prompt, form, feedback, h('div.row', { style: { justifyContent: 'flex-end' } }, nextBtn));
    inp.focus();
  };

  const summary = () => {
    const ok = results.filter((r) => r.ok).length;
    const more = P.dueWords(P.active(), mode === 'need').length;
    clear(card).append(
      h('div.big-score', `${ok}/${results.length}`), h('p.center.muted', 'nhớ đúng'),
      h('ul.vlist.wr-sum', results.map((r) => {
        const d = r.counted ? P.dueDate(r.w.id) : null;
        return h('li.vrow', { tabindex: 0, onclick: () => speak(r.w.en) },
          icon(r.ok ? 'checkCircle' : 'xCircle', { size: 20, className: r.ok ? 'ok' : 'bad' }),
          h('div.vrow-text', h('b', { lang: 'en' }, r.w.en), h('small', r.w.vi)),
          d ? h('span.small.muted', shortDate(d)) : null);
      })),
      h('div.row.center',
        more ? h('button.btn.primary', { onclick: () => play(root, mode, P.dueWords(P.active(), mode === 'need').slice(0, P.SESSION_MAX), true) }, icon('repeat', { size: 18 }), `Ôn tiếp ${Math.min(more, P.SESSION_MAX)} từ`)
          : mode === 'need' && !P.active().needReview.length ? h('a.btn.primary', { href: '#/topics' }, icon('test', { size: 18 }), 'Làm lại bài kiểm tra') : null,
        h('button.btn', { onclick: () => (location.hash === '#/review' ? renderReview(root) : (location.hash = '#/review')) }, 'Xong')));
  };

  next();
}

let toastShown = 0;
function toastOnce(card) {
  if (Date.now() - toastShown < 4000) return;
  toastShown = Date.now();
  const n = h('div.notice.wr-nopaste', icon('info', { size: 16 }), 'Hãy tự gõ từ');
  card.append(n);
  setTimeout(() => n.remove(), 2500);
}
