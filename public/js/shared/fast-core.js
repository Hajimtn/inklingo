// Quick Learn ("Học nhanh"): many short recognition questions over a small set of words.
// Shared by the browser (the game) and the Node tests. No DOM access here.
//
// A round introduces new words one at a time (a card with photo, word, sound and meaning), asks
// each new word right away, then mixes it in with the words already met. Options grow from 2 to 4.
// A wrong pick only removes that option: the player keeps choosing until right, and the word comes
// back sooner. Words answered fast and right come back less often.
//
// Question types (the options are photos or English words):
//   seeHear  word + sound      -> pick the photo   (always the first question for a word)
//   audio    sound only        -> pick the photo
//   photo    photo             -> pick the English word
//   meaning  Vietnamese meaning-> pick the English word

export const QUESTIONS = 40;
export const PHOTO_TYPES = new Set(['seeHear', 'audio']);
const LATER_TYPES = ['audio', 'photo', 'meaning', 'seeHear'];

// Fast mode: a shared time bar (1 = full) that drains a little faster as the round goes on;
// every right answer refills part of it. Empty bar = round over.
export const TIME = { drainPerSec: 1 / 12, speedUp: 1 / 50, refillFirst: 0.22, refillRetry: 0.08 };
export const MAX_POINTS = 300; // per question: 100 + up to 100 for speed + up to 100 streak bonus

/** Points for a right answer: only on the first try; faster answers and longer streaks earn more. */
export function points(ms, streak, firstTry) {
  if (!firstTry) return 0;
  const speed = Math.round(100 * Math.max(0, 1 - ms / 5000));
  return 100 + speed + 10 * Math.min(10, Math.max(0, streak - 1));
}

/** Small seeded PRNG (mulberry32) so a round can be replayed in tests. */
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rnd) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class FastRound {
  /**
   * @param {object} o
   * @param {string[]} o.newIds     words to introduce during the round, in order
   * @param {string[]} [o.knownIds] words already learned: asked from the start, no introduction
   * @param {string[]} [o.extraIds] more words (with photos) used as wrong options; may include
   *   words still waiting to be introduced, so even the first question has a choice
   * @param {number}   [o.length]   number of questions
   * @param {boolean}  [o.timed]    fast mode (time bar)
   * @param {() => number} [o.rnd]
   */
  constructor({ newIds = [], knownIds = [], extraIds = [], length = QUESTIONS, timed = false, rnd = Math.random }) {
    this.rnd = rnd;
    this.length = length;
    this.timed = timed;
    this.pending = [...new Set(newIds)];
    this.active = [];
    this.extra = [...new Set(extraIds)];
    this.words = new Map(); // id -> { asked, right, wrong, weight, isNew }
    for (const id of shuffle([...new Set(knownIds)].filter((id) => !this.pending.includes(id)), rnd)) this._activate(id, false);
    this.asked = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.firstTryRight = 0;
    this.time = 1;
    this.over = false;
    this.current = null;
    this.lastTarget = null;
    this.sinceIntro = Infinity;
  }

  _activate(id, isNew) {
    this.active.push(id);
    this.words.set(id, { asked: 0, right: 0, wrong: 0, weight: isNew ? 3 : 1, isNew });
  }

  get finished() {
    return this.over || this.asked >= this.length;
  }

  /** Next step: { kind: 'intro', id } | { kind: 'ask', id, type, options } | { kind: 'end' }. */
  next() {
    if (this.finished || (!this.active.length && !this.pending.length)) return (this.current = { kind: 'end' });
    // Introduce the next new word once the last one has been asked twice (or straight away when
    // there is nothing to ask yet), keeping a few questions at the end for mixing.
    const left = this.length - this.asked;
    if (this.pending.length && (this.active.length < 1 || this.sinceIntro >= 2) && left > 2) {
      const id = this.pending.shift();
      this._activate(id, true);
      this.sinceIntro = 0;
      this.justIntroduced = id;
      return (this.current = { kind: 'intro', id });
    }
    const id = this.justIntroduced || this._pickTarget();
    this.justIntroduced = null;
    const w = this.words.get(id);
    const type = w.right === 0 ? 'seeHear' : LATER_TYPES[(w.right - 1) % LATER_TYPES.length];
    const n = this.asked < 6 ? 2 : this.asked < 16 ? 3 : 4;
    const others = shuffle(this.active.filter((x) => x !== id), this.rnd);
    const fill = shuffle(this.extra.filter((x) => x !== id && !others.includes(x)), this.rnd);
    const options = shuffle([id, ...[...others, ...fill].slice(0, n - 1)], this.rnd);
    this.lastTarget = id;
    this.wrongThisQ = 0;
    this.removed = [];
    return (this.current = { kind: 'ask', id, type, options });
  }

  _pickTarget() {
    const pool = this.active.length > 1 ? this.active.filter((x) => x !== this.lastTarget) : this.active;
    const total = pool.reduce((s, id) => s + this.words.get(id).weight, 0);
    let r = this.rnd() * total;
    for (const id of pool) {
      r -= this.words.get(id).weight;
      if (r <= 0) return id;
    }
    return pool[pool.length - 1];
  }

  /**
   * The player picked `id` after `ms` milliseconds. Returns { right, points, done }:
   * done = the question is over (right answer); a wrong pick removes that option only.
   */
  answer(id, ms = 0) {
    const q = this.current;
    if (!q || q.kind !== 'ask' || this.finished) return { right: false, points: 0, done: true };
    const w = this.words.get(q.id);
    if (id !== q.id) {
      if (!q.options.includes(id) || this.removed.includes(id)) return { right: false, points: 0, done: false };
      this.removed.push(id);
      this.wrongThisQ++;
      w.wrong++;
      w.weight += 2; // missed: comes back sooner
      this.streak = 0;
      return { right: false, points: 0, done: false };
    }
    const firstTry = this.wrongThisQ === 0;
    if (firstTry) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.firstTryRight++;
      w.right++;
      w.weight = Math.max(0.4, w.weight * (ms < 2500 ? 0.5 : 0.75));
    }
    const pts = points(ms, this.streak, firstTry);
    this.score += pts;
    w.asked++;
    this.asked++;
    this.sinceIntro++;
    if (this.timed) this.time = Math.min(1, this.time + (firstTry ? TIME.refillFirst : TIME.refillRetry));
    return { right: true, points: pts, done: true };
  }

  /** Fast mode clock: drain the time bar by `dtMs`. Returns the bar (0..1). */
  tick(dtMs) {
    if (!this.timed || this.finished) return this.time;
    this.time = Math.max(0, this.time - (dtMs / 1000) * TIME.drainPerSec * (1 + this.asked * TIME.speedUp));
    if (this.time === 0) this.over = true;
    return this.time;
  }

  /** Per-word outcome for the summary and the learning record. */
  results() {
    return [...this.words.entries()].map(([id, w]) => ({ id, isNew: w.isNew, asked: w.asked, right: w.right, wrong: w.wrong }));
  }

  get accuracy() {
    return this.asked ? this.firstTryRight / this.asked : 0;
  }
}
