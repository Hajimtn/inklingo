// Topic roadmap and the end-of-topic test (>= 80% unlocks the next topic).

import { h, clear, speak, autoSpeak } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { topics, topicById, photo, photoFigure, topicIcon, easyTopic } from '../vocab/data.js';
import { speakBtn } from './learn.js';

const back = (href, label) => h('a.back-link', { href }, icon('back', { size: 16 }), label);
import { normalizeAnswer } from '../shared/game-core.js';
import * as P from '../vocab/progress.js';

import { tr } from '../i18n.js';
const STATUS = {
  passed: [tr('Đã hoàn thành'), 'green'],
  learning: [tr('Đang học'), 'yellow'],
  'test-ready': [tr('Sẵn sàng kiểm tra'), 'blue'],
  'review-needed': [tr('Cần ôn lại'), 'red'],
  locked: [tr('Chưa mở khóa'), ''],
  'group-quiz': [tr('Mini-game nhóm'), 'blue'],
};

export function renderTopics(root) {
  const prof = P.active();
  clear(root).append(
    h('div.page-title', icon('map', { size: 28 }), tr('Chủ đề')),
    h('div.topics', easyCard(), topics().map((t, i) => {
      const st = P.topicStatus(i);
      const [label, color] = STATUS[st];
      const n = P.introducedIn(t).length;
      const tests = prof.tests[t.id] || [];
      const best = tests.length ? Math.max(...tests.map((x) => x.score)) : null;
      const cover = t.words[0] ? photo(t.words[0], { alt: tr('Ảnh chủ đề ') + t.title }) : null;
      return h('article.card.topic-card' + (st === 'locked' ? '.locked' : ''),
        h('div.cover', cover, h('span.num', i + 1), st === 'locked' ? h('div.lock', icon('lock', { size: 34, label: tr('Chưa mở khóa') })) : null),
        h('div.body',
          h('div.row.between', h('b.with-ic', topicIcon(t, 18), t.title), h('span.tag.' + (color || 'x'), label)),
          h('div.bar', h('i', { style: { width: (n / t.words.length) * 100 + '%' } })),
          h('div.small.muted', tr('{c}/{n} từ', { c: n, n: t.words.length }) + (best !== null ? ' · ' + tr('Kiểm tra: {p}%', { p: Math.round(best * 100) }) : '')),
          st === 'test-ready' ? h('a.btn.green.small', { href: '#/quiz/' + t.id }, icon('test', { size: 16 }), tr('Làm bài kiểm tra')) : null,
          st === 'review-needed' ? h('a.btn.primary.small', { href: '#/review/need' }, icon('repeat', { size: 16 }), tr('Ôn {n} từ', { n: prof.needReview.length })) : null,
          st === 'learning' ? h('a.btn.small', { href: '#/daily' }, icon('calendar', { size: 16 }), tr('Học từ hôm nay')) : null,
          st === 'group-quiz' ? h('a.btn.green.small', { href: '#/group' }, icon('trophy', { size: 16 }), tr('Mini-game nhóm')) : null,
          st === 'passed' ? h('a.btn.small', { href: '#/quiz/' + t.id }, icon('repeat', { size: 16 }), tr('Thi lại')) : null));
    })));
}

/** Easy everyday words: always open, only for drawing (no lesson, test or review). */
function easyCard() {
  const e = easyTopic();
  const sample = shuffle(e.words).slice(0, 6);
  return h('article.card.topic-card.easy-topic',
    h('div.cover.easy-cover', h('div.easy-words', sample.map((w) => h('span', { lang: 'en' }, w.en))), h('span.num', icon('star', { size: 18 }))),
    h('div.body',
      h('div.row.between', h('b.with-ic', topicIcon(e, 18), tr('Từ thông dụng')), h('span.tag.green', tr('Luôn mở'))),
      h('div.small.muted', tr('{n} từ dễ ai cũng biết · chỉ dùng khi chơi vẽ, không tính vào tiến độ', { n: e.words.length })),
      h('a.btn.green.small', { href: '#/play/easy' }, icon('pencil', { size: 16 }), tr('Chơi vẽ'))));
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function renderQuiz(root, topicId) {
  const t = topicById(topicId);
  const idx = topics().indexOf(t);
  const st = t ? P.topicStatus(idx) : 'locked';
  if (P.active().group) {
    // In a study group the topic test is the group mini-game.
    clear(root).append(back('#/topics', tr('Chủ đề')), h('div.card.quiz.empty', icon('users', { size: 40 }), h('h2', tr('Kiểm tra bằng mini-game nhóm')), h('a.btn.primary', { href: '#/group' }, tr('Đến trang nhóm'))));
    return;
  }
  if (!t || st === 'locked' || st === 'learning' || st === 'review-needed') {
    clear(root).append(back('#/topics', tr('Chủ đề')),
      h('div.card.quiz', h('h2', tr('Chưa thể làm bài kiểm tra')),
        h('p', st === 'review-needed' ? tr('Ôn lại từ chưa nhớ trước') : tr('Học hết các từ của chủ đề trước')),
        st === 'review-needed' ? h('a.btn.primary', { href: '#/review/need' }, icon('repeat', { size: 18 }), tr('Ôn tập')) : h('a.btn', { href: '#/daily' }, icon('calendar', { size: 18 }), tr('Học từ'))));
    return;
  }
  const qs = shuffle(t.words).map((w, i) => ({ w, type: i % 2 ? 'type' : 'choice' }));
  const results = [];
  let k = 0;
  const box = h('section.card.quiz.stack');
  clear(root).append(back('#/topics', tr('Chủ đề')), h('div.page-title', icon('test', { size: 28 }), tr('Kiểm tra: {topic}', { topic: t.title })), box);

  const next = () => {
    if (k >= qs.length) return finish();
    const { w, type } = qs[k];
    const bar = h('div.bar', h('i', { style: { width: (k / qs.length) * 100 + '%' } }));
    const feedback = h('div');
    const nextBtn = h('button.btn.primary', { hidden: true, onclick: () => { k++; next(); } }, k === qs.length - 1 ? tr('Xem kết quả') : [tr('Câu tiếp'), icon('next', { size: 18 })]);
    const answer = (ok, given) => {
      results.push({ wordId: w.id, ok, given });
      feedback.replaceChildren(h('div.notice.result' + (ok ? '.good' : '.bad'), icon(ok ? 'checkCircle' : 'xCircle', { size: 22 }),
        h('span', h('b', ok ? tr('Chính xác! ') : tr('Chưa đúng. ')), tr('Đáp án: '), h('b', w.en), ` ${w.ipa} – ${w.vi}`), speakBtn(w.en, tr('Nghe phát âm'), '.small')));
      nextBtn.hidden = false;
      nextBtn.focus();
      autoSpeak(w.en);
    };
    clear(box).append(h('div.row.between', h('b', tr('Câu {i}/{n}', { i: k + 1, n: qs.length })), h('span.small.muted', type === 'choice' ? tr('Chọn từ') : tr('Gõ từ'))), bar);
    if (type === 'choice') {
      const opts = shuffle([w, ...shuffle(t.words.filter((x) => x !== w)).slice(0, 3)]);
      const btns = opts.map((o) => h('button.btn', { onclick: () => {
        btns.forEach((b, i) => { b.disabled = true; if (opts[i] === w) b.classList.add('right'); });
        if (o !== w) btns[opts.indexOf(o)].classList.add('wrong');
        answer(o === w, o.en);
      } }, o.en));
      box.append(photoFigure(w, { short: true }), h('p', { style: { textAlign: 'center', margin: 0 } }, h('b', w.vi)), h('div.options', btns));
    } else {
      const inp = h('input.answer-input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: tr('Nhập từ tiếng Anh…'), 'aria-label': tr('Đáp án') });
      const form = h('form.stack', { onsubmit: (e) => {
        e.preventDefault();
        if (inp.disabled || !inp.value.trim()) return;
        const ok = [w.en, ...w.alt].map(normalizeAnswer).includes(normalizeAnswer(inp.value));
        inp.disabled = true;
        inp.classList.add(ok ? 'right' : 'wrong');
        answer(ok, inp.value);
      } }, inp, h('button.btn.primary', { type: 'submit' }, tr('Kiểm tra')));
      box.append(h('div', { style: { textAlign: 'center' } }, h('div.meaning', w.vi), h('div.muted', w.explain), h('div.letter-hint', [...w.en].map((c, i) => (i === 0 ? c : /[\s-]/.test(c) ? ' ' : '_')).join(' '))), form);
      setTimeout(() => inp.focus(), 50);
    }
    box.append(feedback, h('div.row', { style: { justifyContent: 'flex-end' } }, nextBtn));
  };

  const finish = () => {
    const r = P.recordTest(t.id, results);
    const nextTopic = topics()[idx + 1];
    clear(box).append(
      h('div.big-score', Math.round(r.score * 100) + '%'),
      h('p', { style: { textAlign: 'center' } }, tr('{c}/{n} câu đúng · cần {p}%', { c: r.correct, n: r.total, p: Math.round(P.PASS_RATE * 100) })),
      r.passed
        ? h('div.notice.result.good', icon('star', { size: 22 }), h('span', tr('Đạt! '), nextTopic ? [tr('Đã mở khóa '), h('b', nextTopic.title)] : tr('Đã học hết lộ trình')))
        : h('div.notice.result.bad', icon('info', { size: 22 }), h('span', tr('Chưa đạt – ôn lại các từ dưới đây'))),
      r.missed.length ? h('div', h('h3', tr('Từ cần ôn')), h('div.today-mini', r.missed.map((id) => t.words.find((x) => x.id === id)).map((w) => h('button.mini-word', { onclick: () => speak(w.en) }, photo(w), h('span', { lang: 'en' }, w.en), h('small', w.vi))))) : null,
      h('div.row', r.passed ? h('a.btn.primary', { href: '#/' }, tr('Về trang chủ')) : h('a.btn.primary', { href: '#/review/need' }, icon('repeat', { size: 18 }), tr('Ôn các từ chưa nhớ')), h('a.btn', { href: '#/topics' }, tr('Xem lộ trình'))));
  };
  next();
}
