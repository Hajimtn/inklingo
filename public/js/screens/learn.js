// Dashboard (home), Daily Vocabulary (flashcards), single word page and the pre-match preview.

import { h, clear, speak, dialog } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { photo, photoFigure, topics, topicIcon, word } from '../vocab/data.js';
import * as P from '../vocab/progress.js';

import { tr } from '../i18n.js';
const POS = { n: tr('danh từ'), v: tr('động từ'), adj: tr('tính từ'), adv: tr('trạng từ') };
const POS_SHORT = { n: 'n', v: 'v', adj: 'adj', adv: 'adv' };
const OFFLINE = tr('Cần chạy server (npm start) để chơi online');

export const speakBtn = (text, label = tr('Nghe phát âm'), cls = '') =>
  h('button.btn.icon-btn.speak-btn' + cls, { type: 'button', onclick: (e) => { e.stopPropagation(); speak(text); }, title: label, 'aria-label': `${label}: ${text}` }, icon('volume', { size: 20 }));

/** Where "continue" leads today, depending on the schedule. */
function nextStep(batch, t, prof) {
  const firstNew = batch.words.find((w) => !prof.viewed[w.id]);
  if (firstNew) return { href: '#/daily/' + firstNew.id, label: tr('Tiếp tục học') };
  if (batch.words.length) return { href: '#/review', label: tr('Ôn tập') };
  return {
    test: { href: '#/quiz/' + t.id, label: tr('Làm bài kiểm tra') },
    'group-quiz': { href: '#/group', label: tr('Mini-game nhóm') },
    'group-sync': { href: '#/group', label: tr('Đến trang nhóm') },
    'review-needed': { href: '#/review/need', label: tr('Ôn từ chưa nhớ') },
  }[batch.reason] || { href: '#/review', label: tr('Ôn tập') };
}

const REASON = {
  weekend: tr('Cuối tuần – ngày ôn tập'),
  test: tr('Đã học hết chủ đề'),
  'review-needed': tr('Cần ôn lại từ chưa nhớ'),
  done: tr('Đã hoàn thành lộ trình'),
  'group-quiz': tr('Hết chủ đề – mini-game nhóm'),
  'group-sync': tr('Đang chờ lịch học của nhóm'),
};

/** One row of a word list: photo, word, meaning, speaker, learned checkbox. */
function wordRow(w, prof, { href, onChange, active } = {}) {
  const box = h('input.check-box', { type: 'checkbox', checked: !!prof.viewed[w.id], 'aria-label': tr('Đã học {w}', { w: w.en }), title: tr('Đã học'),
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { (e.target.checked ? P.markViewed : P.unmarkViewed)(w.id); onChange?.(); } });
  return h('li.vrow' + (active ? '.active' : ''), { onclick: () => href && (location.hash = href), tabindex: href ? 0 : null, onkeydown: (e) => e.key === 'Enter' && href && (location.hash = href) },
    photo(w, { className: 'vrow-img', alt: '' }),
    h('div.vrow-text', h('b', { lang: 'en' }, w.en), h('small', `(${POS_SHORT[w.pos] || w.pos}) ${w.vi}`)),
    h('button.icon-plain.vrow-say', { type: 'button', 'aria-label': 'Nghe ' + w.en, title: 'Nghe', onclick: (e) => { e.stopPropagation(); speak(w.en); } }, icon('volume', { size: 18 })),
    box);
}

function ring(fraction, size = 96) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const el = h('div.ring', { style: { width: size + 'px', height: size + 'px' }, role: 'img', 'aria-label': `${Math.round(f * 100)}%` });
  el.innerHTML = `<svg viewBox="0 0 96 96"><circle class="ring-bg" cx="48" cy="48" r="${r}"/><circle class="ring-fg" cx="48" cy="48" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/></svg>`;
  el.append(h('b', Math.round(f * 100) + '%'));
  return el;
}

// Decorative strokes around the hero cards (original shapes, not a vocabulary image).
const DOODLE = `<svg class="hero-doodle" viewBox="0 0 400 300" aria-hidden="true" fill="none" stroke-linecap="round">
  <path d="M60 70c-14-8-22-20-24-34M78 58c-4-14-2-26 6-36M330 60c10-10 22-16 36-16M342 82c14-2 26 2 36 10M44 210c-14 4-26 2-36-6M60 236c-8 10-18 16-30 18M350 220c14 6 22 16 26 30M326 238c4 14 2 26-6 36" stroke="#bc4b24" stroke-width="5"/>
  <path d="M110 40c6-8 14-10 22-6" stroke="#e8a37f" stroke-width="4"/></svg>`;

export function renderHome(root, { serverOk }) {
  const prof = P.active();
  const t = P.currentTopic();
  const batch = P.todayBatch();
  const list = topics();
  const introduced = P.introducedIn(t).length;
  const step = nextStep(batch, t, prof);

  // ---- hero with three real photos of today's words
  const fanWords = (batch.words.length ? batch.words : t.words).slice(0, 3);
  const order = [fanWords[1], fanWords[0], fanWords[2]].filter(Boolean);
  const art = h('div.hero-art', { html: DOODLE });
  art.prepend(h('div.hero-blob'));
  order.forEach((w, i) => {
    const center = order.length === 1 || i === 1;
    art.append(h('button.fan-card.fan-' + (order.length === 1 ? 1 : i), { type: 'button', 'aria-label': w.en, onclick: () => (location.hash = prof.introduced[w.id] ? '#/word/' + w.id : '#/daily') },
      photo(w, { alt: '' }), center ? h('span', { lang: 'en' }, w.en) : null));
  });
  const hero = h('section.card.hero',
    h('div.hero-text',
      h('div.eyebrow', 'TOEIC B1 – B2'),
      h('h1', tr('Vẽ, đoán và'), h('br'), h('em', tr('nhớ từ.'))),
      h('p.hero-sub', tr('Học từ vựng qua hình ảnh, vẽ tay và trò chơi.')),
      h('div.hero-actions',
        h('a.btn.primary.big', { href: step.href }, icon('play', { size: 20 }), batch.words.length ? tr('Bắt đầu học hôm nay') : step.label, icon('arrowRight', { size: 18 })),
        h('a.btn.big' + (serverOk ? '' : '.disabled'), { href: serverOk ? '#/play/quick' : null, 'aria-disabled': serverOk ? null : 'true', title: serverOk ? tr('Ghép phòng công khai') : OFFLINE }, icon('users', { size: 20 }), tr('Chơi nhanh')))),
    art);

  // ---- topics row (current topic first)
  const topicCard = (x) => {
    const st = P.topicStatus(x.index);
    const n = P.introducedIn(x).length;
    return h('a.tcard' + (x === t ? '.current' : '') + (st === 'locked' ? '.locked' : ''), { href: x === t ? '#/daily' : '#/topics', title: x.title },
      h('div.tcard-cover', x.words[0] ? photo(x.words[0], { alt: '' }) : null, st === 'locked' ? h('span.tcard-lock', icon('lock', { size: 14 })) : null),
      h('div.tcard-body', h('b', x.title), h('small', `${n}/${x.words.length}`), h('div.bar', h('i', { style: { width: (n / x.words.length) * 100 + '%' } }))));
  };
  const topicsRow = h('section.dash-section.topics-sec',
    h('div.section-head', h('h2', tr('Chủ đề')), h('a.link-more', { href: '#/topics' }, tr('Xem tất cả'), icon('arrowRight', { size: 16 }))),
    h('div.topic-row', [t, ...list.filter((x) => x !== t)].map(topicCard)));

  // ---- quick actions
  const tile = (cls, ic, title, sub, href, disabled) => h('a.qtile.' + cls + (disabled ? '.disabled' : ''), { href: disabled ? null : href, 'aria-disabled': disabled ? 'true' : null, title: disabled ? OFFLINE : null },
    h('span.qtile-ic', icon(ic, { size: 24 })), h('span.qtile-text', h('b', title), h('small', sub)));
  const quick = h('section.dash-section.quick-sec',
    h('div.section-head', h('h2', tr('Học nhanh'))),
    h('div.quick-grid',
      tile('q-red', 'pencil', tr('Tạo phòng'), tr('Chơi với bạn bè'), '#/play/create'),
      tile('q-blue', 'login', tr('Vào phòng'), tr('Nhập mã phòng'), '#/play/join', !serverOk),
      tile('q-green', 'cards', tr('Học từ mới'), tr('Tiếp tục chủ đề'), '#/daily'),
      tile('q-yellow', 'repeat', tr('Ôn tập'), P.dueWords().length ? tr('{n} từ đến hạn', { n: P.dueWords().length }) : 'Word Recall', '#/review')));

  // ---- right column: progress + today's words
  const doneTopics = Math.min(prof.topicIdx, list.length);
  const overall = (doneTopics + (P.allTopicsDone(prof) ? 0 : introduced / t.words.length)) / list.length;
  const mini = (cls, ic, n, label) => h('div.mini-stat.' + cls, icon(ic, { size: 20 }), h('div', h('b', n), h('small', label)));
  const progress = h('section.card.side-card.progress-card',
    h('div.section-head', h('h2', tr('Tiến độ học tập')), h('a.btn.small', { href: '#/stats' }, tr('Xem chi tiết'), icon('arrowRight', { size: 14 }))),
    h('div.progress-main', ring(introduced / t.words.length),
      h('div.progress-info', h('div', h('b', `${Math.min(prof.topicIdx + 1, list.length)} / ${list.length}`), tr(' chủ đề')), h('div.bar', h('i', { style: { width: overall * 100 + '%' } })), h('small.muted', t.title))),
    h('div.mini-stats',
      mini('m-red', 'cards', P.learnedWords().length, tr('từ đã học')),
      mini('m-blue', 'repeat', P.inReview(prof), tr('đang ôn')),
      mini('m-orange', 'flame', P.studyStreak(prof), tr('ngày liên tiếp'))));

  const listEl = h('ul.vlist');
  const btnBox = h('div');
  const refreshBtn = () => {
    const s = nextStep(batch, t, prof);
    clear(btnBox).append(h('a.btn.primary.big.wide', { href: s.href }, s.label, icon('arrowRight', { size: 18 })));
  };
  listEl.append(...batch.words.map((w) => wordRow(w, prof, { href: '#/daily/' + w.id, onChange: refreshBtn })));
  refreshBtn();
  const vocab = h('section.card.side-card.vocab-card',
    h('div.section-head', h('h2', tr('Từ vựng hôm nay')), h('span.small.muted', tr('{c}/{n} từ', { c: introduced, n: t.words.length }))),
    batch.words.length ? listEl : h('div.side-empty', icon('info', { size: 22 }), h('span', REASON[batch.reason] || '')),
    btnBox);

  clear(root).append(h('div.dash', h('div.dash-main', hero, topicsRow, quick), h('aside.dash-side', progress, vocab)));
}

// ------------------------------------------------------------------ flashcard

function flashcard(w, { index, total, prev, next, lastAction } = {}) {
  let imgIdx = 0;
  const fig = h('div', photoFigure(w));
  return h('div.flashcard',
    h('div', fig, w.images.length > 1 ? h('button.btn.small', { style: { marginTop: '8px' }, onclick: () => { imgIdx = (imgIdx + 1) % w.images.length; clear(fig).append(photoFigure(w, { index: imgIdx })); } }, icon('image', { size: 16 }), tr('Ảnh khác ({n})', { n: w.images.length })) : null),
    h('div.stack.word-info',
      h('div.row.between', h('span.tag.blue', POS[w.pos] || w.pos), total ? h('span.small.muted', `${index + 1}/${total}`) : null),
      h('div.row.word-head', h('div.word-big', { lang: 'en' }, w.en), speakBtn(w.en)),
      h('div.ipa', w.ipa),
      h('div.meaning', w.vi),
      h('div.muted', w.explain),
      h('div.example', h('div.row.between', { style: { flexWrap: 'nowrap', alignItems: 'flex-start' } }, h('div', { lang: 'en' }, w.ex[0]), speakBtn(w.ex[0], tr('Nghe câu ví dụ'), '.small')), h('div.vi', w.ex[1])),
      h('div', h('b.with-ic', icon('pencil', { size: 16 }), tr('Gợi ý vẽ')), h('ul.ideas-list', w.ideas.map((idea) => h('li', idea.scene)))),
      prev || next || lastAction ? h('div.row.nav-row',
        prev ? h('button.btn', { onclick: prev }, icon('back', { size: 18 }), tr('Trước')) : h('span'),
        next ? h('button.btn.primary', { onclick: next }, tr('Từ tiếp theo'), icon('next', { size: 18 })) : lastAction || null) : null));
}

export function renderDaily(root, focusId) {
  const prof = P.active();
  const batch = P.todayBatch();
  const t = P.currentTopic();
  let words = batch.words;
  let title = tr('Học hôm nay');
  if (!words.length) {
    // Weekend / test day: show this week's words for review instead.
    words = P.weekWords().slice(-10);
    title = batch.reason === 'weekend' ? tr('Ôn từ trong tuần') : tr('Từ gần đây');
  }
  const head = h('div.page-head', h('h1.page-title', title), h('span.tag.blue', topicIcon(t, 14), t.title));
  if (!words.length) {
    clear(root).append(head, h('div.card.empty', icon('calendar', { size: 40 }), h('h2', tr('Chưa có từ nào')), h('p.muted', REASON[batch.reason] || ''), h('a.btn.primary', { href: '#/' }, tr('Về trang chủ'))));
    return;
  }
  let current = Math.max(0, words.findIndex((w) => w.id === focusId));
  const listEl = h('ul.vlist');
  const count = h('span.small.muted');
  const card = h('section.card');
  const show = (i) => {
    current = i;
    const w = words[i];
    P.markViewed(w.id);
    count.textContent = `${words.filter((x) => prof.viewed[x.id]).length}/${words.length}`;
    clear(listEl).append(...words.map((x, k) => {
      const row = wordRow(x, prof, { active: k === i, onChange: () => show(current) });
      row.onclick = () => show(k);
      row.onkeydown = (e) => e.key === 'Enter' && show(k);
      row.tabIndex = 0;
      return row;
    }));
    clear(card).append(flashcard(w, {
      index: i, total: words.length,
      prev: i > 0 ? () => show(i - 1) : null,
      next: i < words.length - 1 ? () => show(i + 1) : null,
      lastAction: h('a.btn.green', { href: '#/play/create' }, icon('play', { size: 18 }), tr('Vào chơi')),
    }));
  };
  const onKey = (e) => {
    if (!document.body.contains(card)) return document.removeEventListener('keydown', onKey);
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'ArrowRight' && current < words.length - 1) show(current + 1);
    else if (e.key === 'ArrowLeft' && current > 0) show(current - 1);
  };
  document.addEventListener('keydown', onKey);
  clear(root).append(head, h('div.daily', h('section.card.side-card.daily-list', h('div.section-head', h('h2', tr('Danh sách')), count), listEl), card));
  show(current);
}

/** A single word (opened from search, the hero cards or a list). Only words already given out. */
export function renderWord(root, id) {
  const w = word(id);
  const prof = P.active();
  const back = h('a.back-link', { href: '#/', onclick: (e) => { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = '#/'); } }, icon('back', { size: 16 }), tr('Quay lại'));
  if (!w || !prof.introduced[w.id]) {
    clear(root).append(back, h('div.card.empty', icon('lock', { size: 40 }), h('h2', tr('Chưa học từ này')), h('a.btn.primary', { href: '#/daily' }, tr('Học hôm nay'))));
    return;
  }
  P.markViewed(w.id);
  const t = topics()[w.topicIndex];
  clear(root).append(back, h('div.page-head', h('h1.page-title', { lang: 'en' }, w.en), h('span.tag.blue', topicIcon(t, 14), t.title)), h('section.card', flashcard(w)));
}

/** Before a match: show today's new words once (GDD §3.1). Resolves when the player continues. */
export async function preMatchPreview() {
  const prof = P.active();
  const words = P.todayBatch().words;
  if (!words.length || words.every((w) => prof.viewed[w.id])) return true;
  const body = h('div.stack',
    h('div.today-mini', words.map((w) => h('button.mini-word', { type: 'button', onclick: () => speak(w.en) }, photo(w), h('span', { lang: 'en' }, w.en), h('small', `${w.ipa}`), h('small', w.vi)))));
  const ok = await dialog({ title: tr('5 từ mới hôm nay'), body, className: 'wide', buttons: [{ label: tr('Học kỹ hơn'), value: 'learn' }, { label: tr('Vào phòng'), value: true, primary: true }] });
  if (ok === 'learn') {
    location.hash = '#/daily';
    return false;
  }
  if (ok) words.forEach((w) => P.markViewed(w.id));
  return !!ok;
}
