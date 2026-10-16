// "Đấu trường chủ đề" – the end-of-topic group mini-game (no drawing).
// Shared by the server (authoritative) and the tests. Four rounds cover every word of the topic once:
//   1 photo   – real photo, pick the word (4 options)
//   2 listen  – hear the word, type it
//   3 gap     – example sentence with the word blanked (TOEIC Part 5 style), pick the word
//   4 meaning – Vietnamese meaning, type the English word
// A QuizRun drives one attempt: a single member (play-anytime within the window) or several
// members on one shared timeline (live). Timers keep running if a player leaves, so an attempt
// cannot be paused to look answers up.

import { normalizeAnswer } from './game-core.js';

export const ROUNDS = [
  { type: 'photo', label: 'Nhìn ảnh', limit: 12_000 },
  { type: 'listen', label: 'Nghe & gõ', limit: 20_000 },
  { type: 'gap', label: 'Điền câu', limit: 20_000 },
  { type: 'meaning', label: 'Nghĩa → từ', limit: 20_000 },
];
export const PASS_RATE = 0.8;
export const QUIZ_WINDOW_MS = 48 * 3600_000;
export const ANSWER_GRACE_MS = 800; // network latency allowance after the visible deadline
export const MAX_POINTS = 100; // per question: 50 for a correct answer + up to 50 for speed
export const LIVE_COUNTDOWN_MS = 3_000;
export const REVEAL_MS = { live: 3_500, solo: 2_500 };

const ROUND_OF = Object.fromEntries(ROUNDS.map((r, i) => [r.type, i]));

// ------------------------------------------------------------------ helpers

/** Deterministic PRNG so every member gets the same question set for a quiz id. */
export function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Inflected forms a sentence may use for a word (receipt -> receipts, ship -> shipped, ...). */
export function wordForms(en) {
  const w = en.toLowerCase();
  const forms = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'er', w + 'ers']);
  if (w.endsWith('y')) ['ies', 'ied'].forEach((s) => forms.add(w.slice(0, -1) + s));
  if (w.endsWith('e')) forms.add(w.slice(0, -1) + 'ing');
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) ['ed', 'ing'].forEach((s) => forms.add(w + w.at(-1) + s));
  return [...forms].sort((a, b) => b.length - a.length);
}

/** Blank the word in its example sentence; null when the sentence does not contain it. */
export function gapSentence(sentence, en) {
  const re = new RegExp(`\\b(?:${wordForms(en).map(esc).join('|')})\\b`, 'i');
  if (!re.test(sentence)) return null;
  return sentence.replace(re, '_____');
}

/** Light obfuscation for the listening round: the browser needs the text for speech synthesis. */
export const encodeSay = (s) => Buffer_from(encodeURIComponent(s)).split('').reverse().join('');
export const decodeSay = (s) => decodeURIComponent(atob_(s.split('').reverse().join('')));
function Buffer_from(s) {
  return typeof btoa === 'function' ? btoa(s) : globalThis.Buffer.from(s, 'binary').toString('base64');
}
function atob_(s) {
  return typeof atob === 'function' ? atob(s) : globalThis.Buffer.from(s, 'base64').toString('binary');
}

export const lengthMask = (en) => [...en].map((c) => (/[\s-]/.test(c) ? c : '_')).join('');

// ------------------------------------------------------------------ question set

/**
 * words: [{id, en, alt, vi, pos, ex:[en, vi], images:[{file}]}] for one topic.
 * Returns questions with answers (server side only). Every word is asked exactly once.
 */
export function buildQuestions(words, seed) {
  const rand = rng(seed);
  const pool = shuffle(words, rand);
  const n = pool.length;
  const per = Math.floor(n / 4);
  const extra = n % 4; // the first `extra` rounds get one more question
  const want = ROUNDS.map((_, i) => per + (i < extra ? 1 : 0));
  const byType = { photo: [], listen: [], gap: [], meaning: [] };
  const rest = [];
  // Gap questions need a sentence that contains the word.
  for (const w of pool) {
    if (byType.gap.length < want[ROUND_OF.gap] && gapSentence(w.ex?.[0] || '', w.en)) byType.gap.push(w);
    else rest.push(w);
  }
  const shortfall = want[ROUND_OF.gap] - byType.gap.length;
  want[ROUND_OF.meaning] += shortfall;
  for (const type of ['photo', 'listen', 'meaning']) {
    while (byType[type].length < want[ROUND_OF[type]] && rest.length) {
      // Photo questions need a photo; everything in the shipped vocabulary has one.
      const k = type === 'photo' ? Math.max(0, rest.findIndex((w) => w.images?.length)) : 0;
      byType[type].push(rest.splice(k, 1)[0]);
    }
  }
  byType.meaning.push(...rest);

  const options = (w) => {
    const same = words.filter((x) => x.id !== w.id && x.pos === w.pos);
    const other = words.filter((x) => x.id !== w.id && x.pos !== w.pos);
    const picks = [...shuffle(same, rand), ...shuffle(other, rand)].slice(0, 3);
    return shuffle([w, ...picks], rand).map((x) => x.en);
  };
  const qs = [];
  for (const r of ROUNDS) {
    for (const w of byType[r.type]) {
      const q = { type: r.type, round: ROUND_OF[r.type], limit: r.limit, wordId: w.id, en: w.en, answers: [w.en, ...(w.alt || [])] };
      if (r.type === 'photo') Object.assign(q, { img: w.images[0].file, options: options(w) });
      if (r.type === 'listen') Object.assign(q, { pos: w.pos, mask: lengthMask(w.en) });
      if (r.type === 'gap') Object.assign(q, { sentence: gapSentence(w.ex[0], w.en), options: options(w) });
      if (r.type === 'meaning') Object.assign(q, { vi: w.vi, pos: w.pos, mask: lengthMask(w.en) });
      qs.push(q);
    }
  }
  return qs;
}

/** What a player may see before answering (no answer, no word id). */
export function publicQuestion(q, index, total, imgUrl) {
  const out = { index, total, type: q.type, round: q.round, roundLabel: ROUNDS[q.round].label, limit: q.limit };
  if (q.type === 'photo') Object.assign(out, { img: imgUrl, options: q.options });
  if (q.type === 'listen') Object.assign(out, { say: encodeSay(q.en), pos: q.pos, mask: q.mask });
  if (q.type === 'gap') Object.assign(out, { sentence: q.sentence, options: q.options });
  if (q.type === 'meaning') Object.assign(out, { vi: q.vi, pos: q.pos, mask: q.mask });
  return out;
}

export function checkAnswer(q, given) {
  const g = String(given ?? '').slice(0, 80);
  if (q.options) return g === q.en;
  return q.answers.map(normalizeAnswer).includes(normalizeAnswer(g));
}

export function answerPoints(ok, msLeft, limit) {
  if (!ok) return 0;
  return 50 + Math.round(50 * Math.max(0, Math.min(1, msLeft / limit)));
}

// ------------------------------------------------------------------ one attempt (solo or live)

export class QuizRun {
  /**
   * @param {object} o
   *  id, questions, memberIds, live, imgUrl(k)
   *  now(), setTimer(fn, ms) -> handle, clearTimer(handle)
   *  send(memberId, msg)
   *  onAnswer(memberId, k, result)  – persist each answer as it happens
   *  onFinish(results)              – {memberId: {answers, score, correct, total}}
   *  startIndex (resume after restart), answered (prior answers by member)
   */
  constructor(o) {
    Object.assign(this, { now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout, live: false, startIndex: 0 }, o);
    this.total = this.questions.length;
    this.k = this.startIndex - 1;
    this.phase = 'idle';
    this.answers = {}; // memberId -> {k: {ok, points, given}}
    for (const m of this.memberIds) this.answers[m] = { ...(o.answered?.[m] || {}) };
    this.timer = null;
  }

  start() {
    if (this.live && this.k < 0) {
      this.phase = 'countdown';
      this.countdownEnd = this.now() + LIVE_COUNTDOWN_MS;
      this._all({ type: 'gq-countdown', endsAt: this.countdownEnd, total: this.total, live: true, members: this.memberIds });
      this.timer = this.setTimer(() => this._next(), LIVE_COUNTDOWN_MS);
    } else {
      this._next();
    }
  }

  _all(msg) {
    for (const m of this.memberIds) this.send(m, msg);
  }

  _next() {
    this.clearTimer(this.timer);
    this.k++;
    if (this.k >= this.total) return this._finish();
    const q = this.questions[this.k];
    this.phase = 'question';
    this.qStart = this.now();
    this.qEnd = this.qStart + q.limit;
    this._all(this._questionMsg());
    this.timer = this.setTimer(() => this._reveal(), q.limit + ANSWER_GRACE_MS);
  }

  _questionMsg() {
    const q = this.questions[this.k];
    return { type: 'gq-question', live: this.live, q: publicQuestion(q, this.k, this.total, this.imgUrl?.(this.k)), endsAt: this.qEnd, answered: this._answeredIds() };
  }

  _answeredIds() {
    return this.memberIds.filter((m) => this.answers[m][this.k]);
  }

  answer(memberId, k, given) {
    if (!this.answers[memberId]) return { error: 'not-in-run' };
    if (this.answers[memberId][k]) return { error: 'duplicate' };
    if (this.phase !== 'question' || k !== this.k) return { error: 'closed' };
    const t = this.now();
    if (t > this.qEnd + ANSWER_GRACE_MS) return { error: 'late' };
    const q = this.questions[k];
    const ok = checkAnswer(q, given);
    const res = { ok, points: answerPoints(ok, this.qEnd - t, q.limit), given: String(given ?? '').slice(0, 80) };
    this.answers[memberId][k] = res;
    this.onAnswer?.(memberId, k, res);
    this.send(memberId, { type: 'gq-ack', index: k });
    if (this.live) this._all({ type: 'gq-answered', index: k, answered: this._answeredIds() });
    if (this.memberIds.every((m) => this.answers[m][k])) this._reveal();
    return res;
  }

  _reveal() {
    if (this.phase !== 'question') return;
    this.clearTimer(this.timer);
    this.phase = 'reveal';
    const q = this.questions[this.k];
    const ms = this.live ? REVEAL_MS.live : REVEAL_MS.solo;
    this.revealEnd = this.now() + ms;
    for (const m of this.memberIds) this.send(m, this._revealMsg(m));
    this.timer = this.setTimer(() => this._next(), ms);
    return q;
  }

  _revealMsg(m) {
    const q = this.questions[this.k];
    const mine = this.answers[m][this.k] || { ok: false, points: 0, given: '' };
    return {
      type: 'gq-reveal', index: this.k, total: this.total, live: this.live, endsAt: this.revealEnd,
      answer: { wordId: q.wordId, en: q.en, sentence: q.type === 'gap' ? q.sentence.replace('_____', q.en) : null },
      you: mine, score: this.score(m),
      others: this.live ? this.memberIds.map((id) => ({ id, ok: !!this.answers[id][this.k]?.ok, points: this.answers[id][this.k]?.points || 0, score: this.score(id) })) : null,
    };
  }

  /** Solo players may skip the short reveal pause. */
  skip(memberId) {
    if (!this.live && this.phase === 'reveal' && this.memberIds.includes(memberId)) this._next();
  }

  score(m) {
    return Object.values(this.answers[m] || {}).reduce((s, a) => s + a.points, 0);
  }

  /** Current screen for a (re)connecting member. */
  snapshot(m) {
    if (this.phase === 'countdown') return { type: 'gq-countdown', endsAt: this.countdownEnd, total: this.total, live: true, members: this.memberIds };
    if (this.phase === 'question') {
      const msg = this._questionMsg();
      if (this.answers[m]?.[this.k]) msg.youAnswered = true;
      return msg;
    }
    if (this.phase === 'reveal') return this._revealMsg(m);
    return null;
  }

  results() {
    const out = {};
    for (const m of this.memberIds) {
      const a = this.answers[m];
      out[m] = {
        answers: this.questions.map((q, k) => ({ wordId: q.wordId, ok: !!a[k]?.ok, points: a[k]?.points || 0 })),
        score: this.score(m),
        correct: Object.values(a).filter((x) => x.ok).length,
        total: this.total,
      };
    }
    return out;
  }

  _finish() {
    this.clearTimer(this.timer);
    this.phase = 'done';
    const res = this.results();
    for (const m of this.memberIds) this.send(m, { type: 'gq-done', ...res[m], missed: res[m].answers.filter((x) => !x.ok).map((x) => x.wordId) });
    this.onFinish?.(res);
  }

  stop() {
    this.clearTimer(this.timer);
    this.phase = 'done';
  }
}
