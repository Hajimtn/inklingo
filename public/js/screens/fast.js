// Quick Learn ("Học nhanh"): fast picture/word recognition rounds (rules in shared/fast-core.js).
//   #/fast                      hub: today's words + one round per topic
//   #/fast/today/<slow|fast>    today's new words + words due (counts as learning)
//   #/fast/<topicId>/<mode>     a whole topic as a game (fast mode has a public leaderboard)
//   #/fast/top/<topicId>        leaderboard

import { h, clear, toast, speak } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';
import { topics, topicById, word, photo, topicIcon } from '../vocab/data.js';
import { FastRound, PHOTO_TYPES, QUESTIONS } from '../shared/fast-core.js';
import * as P from '../vocab/progress.js';
import { tr } from '../i18n.js';

const DAILY_QUESTIONS = 30;
const MODES = { slow: tr('Chậm'), fast: tr('Nhanh') };
const PROMPTS = {
  seeHear: tr('Chọn ảnh đúng'),
  audio: tr('Nghe rồi chọn ảnh'),
  photo: tr('Đây là từ nào?'),
  meaning: tr('Từ tiếng Anh nào có nghĩa này?'),
};

let stopCurrent = null;
/** Stop the clock and key handler of a running round (called when leaving the screen). */
export function leaveFast() {
  stopCurrent?.();
  stopCurrent = null;
}

const withPhoto = (ids) => ids.filter((id) => word(id)?.images?.length);

/** Words of today's round: the new batch, then up to 10 learned words (due ones first). */
function todayWords() {
  const p = P.active();
  const fresh = P.todayBatch(p).words.map((w) => w.id);
  const due = P.dueWords(p).map((w) => w.id);
  const learned = P.learnedWords(p).map((w) => w.id);
  const known = [...new Set([...due, ...shuffle(learned)])].filter((id) => !fresh.includes(id)).slice(0, 10);
  const topic = P.currentTopic(p).words.map((w) => w.id);
  return { newIds: withPhoto(fresh), knownIds: withPhoto(known), extraIds: withPhoto([...topic, ...learned]) };
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function renderFast(root, arg, rest) {
  leaveFast();
  if (arg === 'top') return renderBoard(root, rest);
  if (arg === 'today') return play(root, { topicId: null, mode: rest === 'fast' ? 'fast' : 'slow' });
  if (arg && topicById(arg)) return play(root, { topicId: arg, mode: rest === 'slow' ? 'slow' : 'fast' });
  renderHub(root);
}

// ------------------------------------------------------------------ hub

function renderHub(root) {
  const p = P.active();
  let dailyMode = 'slow';
  let topicMode = 'fast';
  const seg = (get, set, after) => {
    const box = h('div.seg');
    const draw = () => clear(box).append(...Object.entries(MODES).map(([k, label]) => h('button', { type: 'button', class: get() === k ? 'on' : '', onclick: () => { set(k); draw(); after?.(); } },
      icon(k === 'fast' ? 'flame' : 'clock', { size: 16 }), label)));
    draw();
    return box;
  };
  const t = todayWords();
  const daily = h('section.card.fast-today.stack',
    h('div.row.between', h('h2.with-ic', icon('calendar', { size: 20 }), tr('Từ hôm nay')), seg(() => dailyMode, (v) => (dailyMode = v))),
    h('p.muted', t.newIds.length
      ? tr('{n} từ mới + {k} từ đã học · {q} câu · tính vào tiến độ học', { n: t.newIds.length, k: t.knownIds.length, q: DAILY_QUESTIONS })
      : t.knownIds.length ? tr('Hôm nay không có từ mới · ôn {k} từ đã học', { k: t.knownIds.length }) : tr('Chưa có từ nào – học từ hôm nay hoặc chọn một chủ đề bên dưới')),
    h('div.row', h('button.btn.primary', { disabled: !t.newIds.length && !t.knownIds.length, onclick: () => (location.hash = `#/fast/today/${dailyMode}`) }, icon('play', { size: 18 }), tr('Bắt đầu'))));

  const grid = h('div.fast-topics');
  const drawTopics = () => clear(grid).append(...topics().map((tp) => {
    const best = P.fastBest(`${topicMode}:${tp.id}`, p);
    return h('article.card.fast-topic',
      h('button.fast-topic-main', { type: 'button', onclick: () => (location.hash = `#/fast/${tp.id}/${topicMode}`) },
        tp.words[0] ? photo(tp.words[0], { alt: '' }) : null,
        h('span.fast-topic-name.with-ic', topicIcon(tp, 16), tp.title),
        h('small.muted', tr('{n} từ', { n: tp.words.length }) + (best ? ' · ' + tr('Kỷ lục: {s}', { s: best }) : ''))),
      h('a.btn.ghost.small', { href: `#/fast/top/${tp.id}` }, icon('trophy', { size: 15 }), tr('Bảng xếp hạng')));
  }));
  drawTopics();

  clear(root).append(
    h('div.page-head', h('h1.page-title', icon('flame', { size: 28 }), tr('Học nhanh'))),
    h('p.muted.fast-lead', tr('Nghe, nhìn và chọn thật nhanh. Từ mới được giới thiệu từng từ một rồi hỏi lại nhiều lần; chọn sai thì đáp án đó biến mất và từ sẽ quay lại sớm hơn.')),
    daily,
    h('div.row.between.fast-topics-head', h('h2', tr('Theo chủ đề')), seg(() => topicMode, (v) => (topicMode = v), drawTopics)),
    h('p.small.muted', tr('Mỗi lượt {q} câu từ cả chủ đề. Chế độ Nhanh có thanh thời gian và bảng xếp hạng công khai; chơi theo chủ đề không tính vào tiến độ học.', { q: QUESTIONS })),
    grid);
}

// ------------------------------------------------------------------ a round

async function startToken(topicId) {
  try {
    const r = await fetch('api/fast/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topicId }) });
    return r.ok ? (await r.json()).token : null;
  } catch {
    return null; // offline: the round still works, the score just cannot go on the board
  }
}

function play(root, { topicId, mode }) {
  const topic = topicId ? topicById(topicId) : null;
  const timed = mode === 'fast';
  const key = `${mode}:${topicId || 'today'}`;
  let words;
  if (topic) {
    const ids = withPhoto(topic.words.map((w) => w.id));
    words = { newIds: shuffle(ids), knownIds: [], extraIds: ids };
  } else {
    words = todayWords();
  }
  const round = new FastRound({ ...words, length: topic ? QUESTIONS : DAILY_QUESTIONS, timed });
  const token = topic && timed ? startToken(topic.id) : null;
  window.__swFast = round; // inspection hook for automated browser tests

  const bar = h('i');
  const timeBar = h('div.fast-time', { hidden: !timed }, bar);
  const count = h('b');
  const scoreEl = h('b');
  const streakEl = h('span.fast-streak');
  const stage = h('div.fast-stage');
  const card = h('section.card.fast-card',
    h('div.fast-top',
      h('a.btn.ghost.small', { href: '#/fast', 'aria-label': tr('Thoát') }, icon('close', { size: 16 })),
      h('span.small.muted', topic ? topic.title : tr('Từ hôm nay'), ' · ', MODES[mode]),
      h('span.fast-count', count),
      h('span.fast-score', icon('star', { size: 16 }), scoreEl, streakEl)),
    timeBar, stage);
  clear(root).append(card);

  let step = null;
  let askedAt = 0;
  let locked = false;
  let raf = 0;
  let last = performance.now();
  let keyHandler = null;

  const hud = () => {
    count.textContent = `${Math.min(round.asked + (step?.kind === 'ask' ? 1 : 0), round.length)}/${round.length}`;
    scoreEl.textContent = round.score;
    streakEl.textContent = round.streak > 1 ? ` · ${tr('chuỗi')} ${round.streak}` : '';
    bar.style.width = (round.time * 100).toFixed(1) + '%';
    bar.className = round.time < 0.25 ? 'low' : '';
  };

  // The clock only runs while a question is on screen (introductions are for learning).
  const loop = (t) => {
    const dt = t - last;
    last = t;
    if (timed && step?.kind === 'ask' && !locked) {
      round.tick(dt);
      hud();
      if (round.finished) return finish();
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  stopCurrent = () => {
    cancelAnimationFrame(raf);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    window.speechSynthesis?.cancel();
  };
  keyHandler = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (step?.kind === 'intro' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
    if (step?.kind === 'ask' && /^[1-4]$/.test(e.key)) stage.querySelectorAll('.fast-opt')[+e.key - 1]?.click();
  };
  document.addEventListener('keydown', keyHandler);

  const next = () => {
    step = round.next();
    locked = false;
    hud();
    if (step.kind === 'end') return finish();
    const w = word(step.id);
    if (step.kind === 'intro') return showIntro(w);
    showQuestion(w, step);
  };

  const showIntro = (w) => {
    clear(stage).append(h('div.fast-intro',
      h('span.tag.green', tr('Từ mới')),
      h('button.fast-intro-photo', { type: 'button', onclick: () => next(), 'aria-label': tr('Tiếp') }, photo(w, { alt: w.en })),
      h('div.row.center', h('div.fast-word', { lang: 'en' }, w.en), h('button.btn.small', { type: 'button', onclick: () => speak(w.en), 'aria-label': tr('Nghe phát âm') }, icon('volume', { size: 16 }))),
      h('div.muted', w.ipa, ' · ', h('b', w.vi)),
      h('button.btn.primary', { type: 'button', onclick: () => next() }, tr('Đã nhớ, tiếp'), icon('next', { size: 18 }))));
    speak(w.en);
  };

  const showQuestion = (w, q) => {
    const photos = PHOTO_TYPES.has(q.type);
    let prompt;
    if (q.type === 'seeHear') prompt = h('div.fast-prompt', h('div.fast-word', { lang: 'en' }, w.en), h('button.btn.small', { type: 'button', onclick: () => speak(w.en), 'aria-label': tr('Nghe lại') }, icon('volume', { size: 16 })));
    else if (q.type === 'audio') prompt = h('div.fast-prompt', h('button.btn.fast-listen', { type: 'button', onclick: () => speak(w.en), 'aria-label': tr('Nghe lại') }, icon('volume', { size: 30 })));
    else if (q.type === 'photo') prompt = h('div.fast-prompt.fast-prompt-photo', photo(w, { alt: '' }));
    else prompt = h('div.fast-prompt', h('div.fast-meaning', w.vi));
    const opts = h('div.fast-opts' + (photos ? '.photos' : '.words') + '.n' + q.options.length, q.options.map((id, i) => {
      const o = word(id);
      const btn = h('button.fast-opt', { type: 'button', 'aria-label': photos ? `${tr('Lựa chọn')} ${i + 1}` : o.en, onclick: () => pick(id, btn) },
        photos ? photo(o, { alt: '' }) : h('span', { lang: 'en' }, o.en),
        h('kbd', i + 1));
      return btn;
    }));
    clear(stage).append(h('div.small.muted.fast-ask', PROMPTS[q.type]), prompt, opts);
    if (q.type === 'seeHear' || q.type === 'audio') speak(w.en);
    askedAt = performance.now();
  };

  const pick = (id, btn) => {
    if (locked || step?.kind !== 'ask') return;
    const res = round.answer(id, performance.now() - askedAt);
    if (!res.right) {
      btn.classList.add('wrong');
      btn.disabled = true;
      hud();
      return;
    }
    locked = true;
    btn.classList.add('right');
    const w = word(step.id);
    if (step.type === 'photo' || step.type === 'meaning') speak(w.en);
    if (res.points) stage.append(h('div.fast-pop', `+${res.points}`));
    hud();
    setTimeout(next, res.points ? 650 : 900);
  };

  let ended = false;
  const finish = async () => {
    if (ended) return;
    ended = true;
    stopCurrent?.();
    stopCurrent = null;
    const results = round.results();
    const best = P.recordFast(key, round.score, results, { daily: !topic });
    const missed = results.filter((r) => r.wrong).sort((a, b) => b.wrong - a.wrong).map((r) => word(r.id)).filter(Boolean);
    const submitBox = h('div.stack');
    const again = () => { renderFast(root, topicId || 'today', mode); };
    clear(card).append(h('div.fast-end.stack',
      h('div.big-score', round.score),
      h('p.center.muted', round.over ? tr('Hết giờ!') : tr('Hoàn thành!'), ' ',
        tr('{c}/{n} câu đúng ngay lần đầu · chuỗi dài nhất {s}', { c: round.firstTryRight, n: round.asked, s: round.bestStreak })),
      best && round.score ? h('div.notice.result.good', icon('trophy', { size: 20 }), h('span', tr('Kỷ lục mới của bạn!'))) : h('p.center.small.muted', tr('Kỷ lục: {s}', { s: P.fastBest(key) })),
      !topic ? h('p.center.small.muted', tr('Từ mới hôm nay đã được tính là đã học. Ôn lại bằng Word Recall vào những ngày tới.')) : null,
      missed.length ? h('div', h('h3', tr('Từ hay chọn nhầm')), h('div.today-mini', missed.slice(0, 8).map((w) => h('button.mini-word', { type: 'button', onclick: () => speak(w.en) }, photo(w), h('span', { lang: 'en' }, w.en), h('small', w.vi))))) : null,
      submitBox,
      h('div.row.center',
        h('button.btn.primary', { type: 'button', onclick: again }, icon('repeat', { size: 18 }), tr('Chơi lại')),
        h('a.btn', { href: '#/fast' }, tr('Về Học nhanh')))));
    if (topic && timed && round.asked) offerSubmit(submitBox, topic, await token, round);
  };

  next();
}

/** Fast topic rounds: the player decides whether the score goes on the public board. */
function offerSubmit(box, topic, token, round) {
  const p = P.active();
  if (!token) return box.append(h('p.center.small.muted', tr('Offline – không gửi được điểm lên bảng xếp hạng')));
  const name = h('input.input', { value: p.name, maxLength: 18, 'aria-label': tr('Tên trên bảng xếp hạng') });
  const send = h('button.btn.green', { type: 'button', onclick: async () => {
    send.disabled = true;
    try {
      const r = await fetch('api/fast/score', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.value, avatar: p.avatar, score: round.score, answered: round.asked, correct: round.firstTryRight }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      clear(box).append(
        h('div.notice.result' + (data.rank ? '.good' : ''), icon('trophy', { size: 20 }), h('span', data.rank ? tr('Hạng {r} trên bảng {t}!', { r: data.rank, t: topic.title }) : tr('Chưa vào top {n} – thử lại nhé', { n: data.top.length }))),
        boardList(data.top, data.rank));
    } catch (e) {
      send.disabled = false;
      toast(e.message ? tr(e.message) : tr('Không gửi được điểm'), 'bad');
    }
  } }, icon('trophy', { size: 18 }), tr('Gửi điểm lên bảng xếp hạng'));
  box.append(h('div.card.fast-submit.stack',
    h('b', tr('Bảng xếp hạng công khai')),
    h('p.small.muted', tr('Tên và điểm của bạn sẽ hiện cho mọi người trên trang. Chỉ gửi nếu bạn muốn.')),
    h('div.row', name, send)));
}

function boardList(top, mine = 0) {
  if (!top.length) return h('p.muted.center', tr('Chưa có ai trên bảng này – hãy là người đầu tiên!'));
  return h('ol.fast-board', top.map((e, i) => h('li' + (i + 1 === mine ? '.me' : ''),
    h('span.rank', '#' + (i + 1)), avatar(e.name, e.avatar, 28), h('span.nm', e.name),
    h('span.small.muted', `${e.correct}/${e.answered}`), h('b', e.score))));
}

async function renderBoard(root, topicId) {
  const t = topicById(topicId);
  if (!t) return (location.hash = '#/fast');
  const body = h('div', h('p.muted', tr('Đang tải…')));
  clear(root).append(
    h('a.back-link', { href: '#/fast' }, icon('back', { size: 16 }), tr('Học nhanh')),
    h('div.page-head', h('h1.page-title.with-ic', topicIcon(t, 26), tr('Bảng xếp hạng: {t}', { t: t.title }))),
    h('p.small.muted', tr('Điểm cao nhất ở chế độ Nhanh, {q} câu mỗi lượt.', { q: QUESTIONS })),
    h('section.card', body),
    h('div.row', h('a.btn.primary', { href: `#/fast/${t.id}/fast` }, icon('play', { size: 18 }), tr('Chơi chủ đề này'))));
  try {
    const r = await fetch('api/fast/top?topic=' + encodeURIComponent(t.id));
    if (!r.ok) throw new Error();
    clear(body).append(boardList((await r.json()).top));
  } catch {
    clear(body).append(h('p.muted', tr('Offline – không tải được bảng xếp hạng')));
  }
}
