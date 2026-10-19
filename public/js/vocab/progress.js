// Per-profile learning progress (stored in this browser).
//
// Rules from the design document:
//  * one topic at a time; 5 new words per weekday (Mon–Fri) from the current topic
//  * Saturday and Sunday are review days (no new words)
//  * when every word of the topic has been introduced -> end-of-topic test
//  * >= 80% unlocks the next topic, otherwise the missed words must be reviewed first
//  * learning history and retention are kept per profile
//  * a profile that joined a study group follows the group's schedule instead (the server hands
//    the group its daily words; the topic test is the group mini-game) – see net/groups.js

import { topics, word } from './data.js';
import { AVATAR_KEYS, registerAvatarPic, isDrawnAvatar } from '../ui/icons.js';

import { tr } from '../i18n.js';
const KEY = 'sw:v4'; // v4: TOEIC 450+ word list (v3 beginner progress is not carried over)
export const WORDS_PER_DAY = 5;
export const PASS_RATE = 0.8;
const HISTORY_MAX = 2000;

const AVATARS = AVATAR_KEYS; // colour keys; the avatar face is the player's initials (see ui/icons.js)

let state = load();

function blankProfile(name, avatar) {
  return {
    id: 'p' + Math.random().toString(36).slice(2, 10),
    name: name || tr('Người chơi'),
    avatar: avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)], // colour key, or "p…" for a drawn avatar
    pic: null, // the drawn avatar (PNG data URL) when avatar is a "p…" key
    createdAt: new Date().toISOString(),
    topicIdx: 0,
    introduced: {}, // wordId -> date first delivered
    batches: {}, // date -> [wordIds]
    viewed: {}, // wordId -> true once the flashcard was opened
    tests: {}, // topicId -> [{date, score, total, correct, missed}]
    passed: {}, // topicId -> date
    needReview: [], // missed in the last failed topic test
    stats: {}, // wordId -> {seen, ok, bad, last, step, due, lastDay, nextType} (Word Recall schedule)
    history: [], // {t, w, k: guess|draw|recall|practice|test|learn|fast, ok, c?: challenge type, gap?: days}
    group: null, // {code, memberId, secret, name} when the profile belongs to a study group
    groupMirror: null, // last synced {phase, topicIdx, delivered, topicSize, syncedAt}
    groupOutbox: [], // progress reports not sent yet
    fast: {}, // Quick Learn personal bests: "<mode>:<topicId|today>" -> {score, at}
  };
}

function load() {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    s = null;
  }
  if (!s || !s.profiles) s = { profiles: {}, active: null, settings: {} };
  if (!Object.keys(s.profiles).length) {
    const p = blankProfile(tr('Người chơi 1'));
    s.profiles[p.id] = p;
    s.active = p.id;
  }
  if (!s.profiles[s.active]) s.active = Object.keys(s.profiles)[0];
  // Earlier builds stored an emoji as the avatar: map it to a colour key.
  Object.values(s.profiles).forEach((p, i) => {
    if (!AVATARS.includes(p.avatar) && !(isDrawnAvatar(p.avatar) && p.pic)) p.avatar = AVATARS[i % AVATARS.length];
    if (p.pic) registerAvatarPic(p.avatar, p.pic);
    p.group ||= null;
    p.groupMirror ||= null;
    p.groupOutbox ||= [];
    p.fast ||= {};
  });
  s.settings = { simDate: null, ttsRate: 0.85, ...s.settings };
  return s;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: progress stays in memory for this session */
  }
}

export const avatars = AVATARS;
export const settings = () => state.settings;
export function setSetting(k, v) {
  state.settings[k] = v;
  save();
}

// ------------------------------------------------------------- profiles

export const profiles = () => Object.values(state.profiles);
export const active = () => state.profiles[state.active];
export const profile = (id) => state.profiles[id];

export function createProfile(name, avatar) {
  const p = blankProfile(name, avatar);
  state.profiles[p.id] = p;
  state.active = p.id;
  save();
  return p;
}

export function switchProfile(id) {
  if (state.profiles[id]) state.active = id;
  save();
}

export function updateProfile(id, patch) {
  Object.assign(state.profiles[id], patch);
  save();
}

/** Colour avatar ("c3") or a drawn one (key "p…" + its PNG data URL). */
export function setAvatar(id, key, pic = null) {
  const p = state.profiles[id];
  p.avatar = key;
  p.pic = pic;
  if (pic) registerAvatarPic(key, pic);
  save();
}

export function deleteProfile(id) {
  delete state.profiles[id];
  if (!Object.keys(state.profiles).length) {
    const p = blankProfile(tr('Người chơi 1'));
    state.profiles[p.id] = p;
  }
  if (!state.profiles[state.active]) state.active = Object.keys(state.profiles)[0];
  save();
}

export function resetProgress(id) {
  const p = state.profiles[id];
  const fresh = blankProfile(p.name, p.avatar);
  fresh.id = p.id;
  fresh.createdAt = p.createdAt;
  fresh.group = p.group; // stays in the group; the next sync restores the group schedule
  fresh.pic = p.pic;
  state.profiles[id] = fresh;
  save();
}

// ------------------------------------------------------------- dates

const pad = (n) => String(n).padStart(2, '0');
export function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today() {
  return state.settings.simDate || dateStr(new Date());
}
function parse(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function weekday(ds = today()) {
  return parse(ds).getDay(); // 0 Sun .. 6 Sat
}
export const isWeekend = (ds = today()) => weekday(ds) === 0 || weekday(ds) === 6;
export const DAY_NAMES = [tr('Chủ nhật'), tr('Thứ Hai'), tr('Thứ Ba'), tr('Thứ Tư'), tr('Thứ Năm'), tr('Thứ Sáu'), tr('Thứ Bảy')];
export function addDays(ds, n) {
  const d = parse(ds);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

// ------------------------------------------------------------- topic progression

export function currentTopic(p = active()) {
  const list = topics();
  return list[Math.min(p.topicIdx, list.length - 1)];
}

export const allTopicsDone = (p = active()) => p.topicIdx >= topics().length;

export function introducedIn(topic, p = active()) {
  return topic.words.filter((w) => p.introduced[w.id]);
}

export function topicStatus(idx, p = active()) {
  if (idx < p.topicIdx) return 'passed';
  if (idx > p.topicIdx) return 'locked';
  const t = topics()[idx];
  if (p.group) return ['quiz-ready', 'quiz-open'].includes(p.groupMirror?.phase) ? 'group-quiz' : 'learning';
  if (introducedIn(t, p).length < t.words.length) return 'learning';
  return p.needReview.length ? 'review-needed' : 'test-ready';
}

/**
 * Today's new words. Creates the batch on first call of a weekday. Returns
 * { words, reason } where reason explains an empty list (weekend / test / done).
 */
export function todayBatch(p = active()) {
  const d = today();
  if (p.batches[d]) return { words: p.batches[d].map(word).filter(Boolean), reason: null, date: d };
  if (allTopicsDone(p)) return { words: [], reason: 'done', date: d };
  if (p.group) {
    // Group schedule: words only come from the server (never chosen locally).
    const ph = p.groupMirror?.phase;
    if (ph === 'quiz-ready' || ph === 'quiz-open') return { words: [], reason: 'group-quiz', date: d };
    if (ph === 'done') return { words: [], reason: 'done', date: d };
    if (isWeekend(d) && p.groupMirror) return { words: [], reason: 'weekend', date: d };
    return { words: [], reason: 'group-sync', date: d };
  }
  const t = currentTopic(p);
  const fresh = t.words.filter((w) => !p.introduced[w.id]);
  const firstEver = !Object.keys(p.introduced).length;
  // Weekends are review days. Exception: a brand-new profile gets its first batch any day,
  // otherwise there would be nothing to review or play with.
  if (isWeekend(d) && !firstEver) return { words: [], reason: 'weekend', date: d };
  if (!fresh.length) return { words: [], reason: p.needReview.length ? 'review-needed' : 'test', date: d };
  const batch = fresh.slice(0, WORDS_PER_DAY);
  p.batches[d] = batch.map((w) => w.id);
  for (const w of batch) p.introduced[w.id] = d;
  save();
  return { words: batch, reason: null, date: d };
}

// Learning more than the daily five: on request, 5 more words of the current topic at a time,
// up to DAY_MAX words a day. Today's words have to be opened first; study groups keep the shared
// schedule (their words come from the server).
export const DAY_MAX = 25;

/** Whether 5 more words can be learned now: { ok, n } or { ok: false, reason }. */
export function moreWordsStatus(p = active()) {
  if (p.group) return { ok: false, reason: 'group' };
  if (allTopicsDone(p)) return { ok: false, reason: 'done' };
  const d = today();
  todayBatch(p); // the regular batch of a weekday comes first
  const batch = p.batches[d] || [];
  if (batch.some((id) => !p.viewed[id])) return { ok: false, reason: 'unseen' };
  if (batch.length >= DAY_MAX) return { ok: false, reason: 'limit' };
  const fresh = currentTopic(p).words.filter((w) => !p.introduced[w.id]);
  if (!fresh.length) return { ok: false, reason: p.needReview.length ? 'review-needed' : 'test' };
  return { ok: true, n: Math.min(WORDS_PER_DAY, fresh.length, DAY_MAX - batch.length) };
}

/** Add the next words of the current topic to today's batch. Returns the new words ([] if not allowed). */
export function learnMore(p = active()) {
  const st = moreWordsStatus(p);
  if (!st.ok) return [];
  const d = today();
  const more = currentTopic(p).words.filter((w) => !p.introduced[w.id]).slice(0, st.n);
  p.batches[d] = [...(p.batches[d] || []), ...more.map((w) => w.id)];
  for (const w of more) p.introduced[w.id] = d;
  save();
  return more;
}

export function markViewed(wordId, p = active()) {
  if (p.viewed[wordId]) return;
  p.viewed[wordId] = true;
  log(p, wordId, 'learn', true);
  save();
  const batch = p.batches[today()];
  if (p.group && batch?.includes(wordId) && batch.every((id) => p.viewed[id])) hooks.learned?.(p);
}

/** Undo "learned" from the checkbox in the word list (the word stays in the schedule). */
export function unmarkViewed(wordId, p = active()) {
  if (!p.viewed[wordId]) return;
  delete p.viewed[wordId];
  save();
}

/**
 * Consecutive study days ending today (or the last weekday): a day counts when the profile learned,
 * reviewed, played or took a test. Saturday/Sunday without activity do not break the streak, and
 * today does not break it before the first activity of the day.
 */
export function studyStreak(p = active()) {
  const days = new Set(p.history.map((x) => dateStr(new Date(x.t))));
  let d = today();
  let n = 0;
  if (!days.has(d)) d = addDays(d, -1);
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    if (days.has(d)) n++;
    else if (!isWeekend(d)) break;
  }
  return n;
}

/** Learned words that have not passed the day-30 Word Recall check yet. */
export const inReview = (p = active()) => learnedWords(p).filter((w) => recallStep(w.id, p) < MASTERED_STEP).length;

export function weekWords(p = active()) {
  // Words introduced in the last 7 days (for the weekend review screen).
  const d = today();
  const from = addDays(d, -6);
  return Object.entries(p.introduced).filter(([, day]) => day >= from && day <= d).map(([id]) => word(id)).filter(Boolean);
}

export function learnedWords(p = active()) {
  return Object.keys(p.introduced).map(word).filter(Boolean);
}

// ------------------------------------------------------------- stats & spaced review

function log(p, wordId, kind, ok) {
  p.history.push({ t: Date.now(), w: wordId, k: kind, ok: !!ok });
  trimHistory(p);
}
function trimHistory(p) {
  if (p.history.length > HISTORY_MAX) p.history.splice(0, p.history.length - HISTORY_MAX);
}

function stat(p, wordId) {
  return (p.stats[wordId] ||= { seen: 0, ok: 0, bad: 0, last: 0, step: 0 });
}

/** Result of recalling a word (guessing in a match, review card, test question). */
export function recordRecall(wordId, ok, kind, p = active()) {
  if (!p || !word(wordId)) return;
  const s = stat(p, wordId);
  s.seen++;
  s.last = Date.now();
  if (ok) s.ok++;
  else s.bad++;
  let cleared = null;
  if (ok && kind === 'review') {
    const i = p.needReview.indexOf(wordId);
    if (i !== -1) {
      p.needReview.splice(i, 1);
      cleared = [wordId];
    }
  }
  log(p, wordId, kind, ok);
  save();
  if (p.group && (kind === 'review' || kind === 'guess')) hooks.recall?.(p, { ok, source: kind, cleared });
}

// ------------------------------------------------------------- Quick Learn

/** Personal best for a Quick Learn board ("fast:office", "slow:today"…). */
export const fastBest = (key, p = active()) => p.fast?.[key]?.score || 0;

/**
 * A finished Quick Learn round. `results` = [{id, isNew, asked, right, wrong}]. In the daily round
 * the new words count as learned (like opening their card) and each word asked is logged as a
 * recognition practice; topic rounds are a game and only keep the personal best.
 * Returns true for a new personal best.
 */
export function recordFast(key, score, results, { daily = false } = {}, p = active()) {
  p.fast ||= {};
  const best = score > fastBest(key, p);
  if (best) p.fast[key] = { score, at: Date.now() };
  if (daily) {
    for (const r of results) {
      if (!r.asked || !word(r.id)) continue;
      if (r.isNew && !p.viewed[r.id]) markViewed(r.id, p);
      const s = stat(p, r.id);
      s.seen++;
      s.last = Date.now();
      if (r.wrong) s.bad++;
      else s.ok++;
      log(p, r.id, 'fast', !r.wrong);
    }
  }
  save();
  return best;
}

/** Points the profile scored in a drawing match started from its group page. */
export function recordMatchPoints(points, p = active()) {
  if (p?.group && points > 0) hooks.match?.(p, points);
}

// ------------------------------------------------------------- study group link

let hooks = {};
export const setGroupHooks = (h) => (hooks = h);

export function setGroupLink(p, link) {
  p.group = link;
  if (!link) p.groupMirror = null;
  p.groupOutbox = [];
  save();
}

export function pushGroupReport(p, r) {
  const last = p.groupOutbox.at(-1);
  if (last && r.kind === 'recall' && last.kind === 'recall' && last.source === r.source) {
    last.ok += r.ok;
    last.bad += r.bad;
    if (r.cleared) last.cleared = [...(last.cleared || []), ...r.cleared];
  } else {
    p.groupOutbox.push(r);
  }
  p.groupOutbox = p.groupOutbox.slice(-50);
  save();
}
export function takeGroupReports(p) {
  const out = p.groupOutbox || [];
  p.groupOutbox = [];
  save();
  return out;
}
export function returnGroupReports(p, reports) {
  p.groupOutbox = [...reports, ...(p.groupOutbox || [])].slice(-50);
  save();
}

/**
 * Mirror the group's schedule into the profile so every screen (daily words, review, matches)
 * keeps working unchanged: current topic, the days' word batches, words to re-study.
 */
export function applyGroupState(p, st) {
  const list = topics();
  p.topicIdx = Math.min(st.topicIdx, list.length);
  const cur = st.topicId;
  for (const [day, ids] of Object.entries(st.batches || {})) {
    const valid = ids.filter((id) => word(id));
    // Batches before the member joined are only taken over for the topic being studied now.
    const inCurrent = valid.some((id) => word(id).topic === cur);
    if (!inCurrent && day < st.joinedDay) continue;
    p.batches[day] = valid;
    for (const id of valid) p.introduced[id] ||= day;
  }
  p.needReview = (st.my?.needReview || []).filter((id) => word(id));
  for (const h of st.history || []) p.passed[h.topicId] ||= today();
  p.groupMirror = {
    phase: st.phase, topicIdx: st.topicIdx, delivered: st.delivered, topicSize: st.topicSize, name: st.name, syncedAt: Date.now(),
    recallBoard: (st.members || []).map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, n: m.recalledWeek || 0, me: m.id === st.me })),
  };
  if (p.group) p.group.name = st.name;
  save();
}

export function recordDrawn(wordId, p = active()) {
  if (!p || !word(wordId)) return;
  const s = stat(p, wordId);
  s.seen++;
  s.last = Date.now();
  log(p, wordId, 'draw', true);
  save();
}

// ------------------------------------------------------------- Word Recall (spaced, delayed recall)
//
// A word is first checked the day after it was learned (never the same day: recognising a word you
// have just seen says little about memory). Each correct check pushes the next one further out –
// day 2 -> 4 -> 8 -> 15 -> 30, then every 60 days; a miss brings the word back tomorrow, two steps lower.

export const RECALL_GAPS = [1, 2, 4, 7, 15, 60]; // days to the next check once a word reaches step k
export const MASTERED_STEP = 5; // passed the day-30 check
export const RECALL_TYPES = ['listen', 'meaning', 'context'];
export const SESSION_MAX = 10;

export const recallStep = (wordId, p = active()) => p.stats[wordId]?.step || 0;

export function dueDate(wordId, p = active()) {
  const s = p.stats[wordId];
  if (s?.due) return s.due;
  return p.introduced[wordId] ? addDays(p.introduced[wordId], 1) : null;
}

export function isDue(wordId, p = active(), day = today()) {
  if (p.needReview.includes(wordId)) return true;
  const d = dueDate(wordId, p);
  return !!d && d <= day;
}

/** Words to check today: missed test words first, then the most overdue, then the least known. */
export function dueWords(p = active(), onlyNeeded = false) {
  const day = today();
  const need = new Set(p.needReview);
  const pool = learnedWords(p).filter((w) => (onlyNeeded ? need.has(w.id) : isDue(w.id, p, day)));
  return pool.sort((a, b) => need.has(b.id) - need.has(a.id) || cmp(dueDate(a.id, p), dueDate(b.id, p)) || recallStep(a.id, p) - recallStep(b.id, p));
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The next day something becomes due (when nothing is due today). */
export function nextDue(p = active()) {
  const day = today();
  return learnedWords(p).map((w) => dueDate(w.id, p)).filter((d) => d && d > day).sort()[0] || null;
}

/** Extra practice when nothing is due: weakest words first. Practice never moves the schedule. */
export function practiceWords(limit = SESSION_MAX, p = active()) {
  const score = (w) => recallStep(w.id, p) * 2 - (wordRetention(w.id, p) ?? 0.5) + Math.random();
  return learnedWords(p).sort((a, b) => score(a) - score(b)).slice(0, limit);
}

/** Challenge type for a word: the three types take turns, so every word is heard, recalled and used. */
export function nextChallenge(wordId, available, p = active()) {
  const s = p.stats[wordId];
  let i = s?.nextType ?? [...wordId].reduce((a, c) => a + c.charCodeAt(0), 0) % RECALL_TYPES.length;
  for (let k = 0; k < RECALL_TYPES.length; k++, i++) {
    const t = RECALL_TYPES[i % RECALL_TYPES.length];
    if (available.includes(t)) return t;
  }
  return available[0];
}

const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

/**
 * One Word Recall answer. `counted` is false for extra practice and for the retry of a missed word
 * in the same session: those are logged but do not move the schedule or score group points.
 * `via` is 'type' or 'voice'; a spoken answer also logs its pronunciation score (0–100).
 */
export function recordWordRecall(wordId, type, ok, counted, { via = 'type', score } = {}, p = active()) {
  if (!p || !word(wordId)) return;
  const s = stat(p, wordId);
  const day = today();
  const since = s.lastDay || p.introduced[wordId];
  s.nextType = (RECALL_TYPES.indexOf(type) + 1) % RECALL_TYPES.length;
  if (!counted) {
    p.history.push({ t: Date.now(), w: wordId, k: 'practice', ok: !!ok, c: type, via, ...(score != null ? { s: score } : {}) });
    trimHistory(p);
    save();
    return;
  }
  s.seen++;
  s.last = Date.now();
  s.lastDay = day;
  if (ok) {
    s.ok++;
    s.step = Math.min(MASTERED_STEP, (s.step || 0) + 1);
    s.due = addDays(day, RECALL_GAPS[s.step]);
  } else {
    s.bad++;
    s.step = Math.max(0, (s.step || 0) - 2);
    s.due = addDays(day, RECALL_GAPS[0]);
  }
  let cleared = null;
  const i = p.needReview.indexOf(wordId);
  if (ok && i !== -1) {
    p.needReview.splice(i, 1);
    cleared = [wordId];
  }
  p.history.push({ t: Date.now(), w: wordId, k: 'recall', ok: !!ok, c: type, via, gap: since ? daysBetween(since, day) : 0, ...(score != null ? { s: score } : {}) });
  trimHistory(p);
  save();
  if (p.group) hooks.recall?.(p, { ok, source: 'review', cleared });
}

/** Accuracy of delayed recalls per challenge type, after a 7+ day gap, and words recalled this week. */
export function recallStats(p = active()) {
  const rows = p.history.filter((x) => x.k === 'recall');
  const rate = (list) => (list.length ? { ok: list.filter((x) => x.ok).length, n: list.length } : null);
  const day = today();
  const monday = addDays(day, -((weekday(day) + 6) % 7));
  const weekStart = parse(monday).getTime();
  const week = new Set(rows.filter((x) => x.ok && x.t >= weekStart).map((x) => x.w)).size;
  return {
    byType: Object.fromEntries(RECALL_TYPES.map((t) => [t, rate(rows.filter((x) => x.c === t))])),
    late: rate(rows.filter((x) => x.gap >= 7)),
    week,
  };
}

/** How many learned words sit at each step of the recall ladder. */
export function ladder(p = active()) {
  const out = Array(MASTERED_STEP + 1).fill(0);
  for (const w of learnedWords(p)) out[recallStep(w.id, p)]++;
  return out;
}

export function retention(p = active()) {
  const rec = p.history.filter((h) => h.k === 'guess' || h.k === 'review' || h.k === 'recall' || h.k === 'test');
  if (!rec.length) return null;
  return rec.filter((h) => h.ok).length / rec.length;
}

export function wordRetention(wordId, p = active()) {
  const s = p.stats[wordId];
  if (!s || s.ok + s.bad === 0) return null;
  return s.ok / (s.ok + s.bad);
}

// ------------------------------------------------------------- topic test

export function recordTest(topicId, results, p = active()) {
  // results: [{wordId, ok}]
  const correct = results.filter((r) => r.ok).length;
  const score = correct / results.length;
  const missed = results.filter((r) => !r.ok).map((r) => r.wordId);
  (p.tests[topicId] ||= []).push({ date: today(), score, total: results.length, correct, missed });
  for (const r of results) recordRecall(r.wordId, r.ok, 'test', p);
  const passed = score >= PASS_RATE;
  if (passed) {
    p.passed[topicId] = today();
    p.needReview = [];
    const idx = topics().findIndex((t) => t.id === topicId);
    if (idx === p.topicIdx) p.topicIdx++;
  } else {
    p.needReview = missed;
  }
  save();
  return { score, correct, total: results.length, passed, missed };
}

// ------------------------------------------------------------- words for a match

/**
 * Ordered word pool for a room hosted by this profile: today's words first, then other
 * learned words of the current topic, then review-priority words from earlier topics.
 */
export function matchWordIds(p = active()) {
  const batch = todayBatch(p).words.map((w) => w.id);
  const t = currentTopic(p);
  const topicLearned = introducedIn(t, p).map((w) => w.id).filter((id) => !batch.includes(id));
  const review = [...dueWords(p), ...practiceWords(15, p)].slice(0, 15).map((w) => w.id).filter((id) => !batch.includes(id) && !topicLearned.includes(id));
  const ids = [...batch, ...shuffle(topicLearned), ...review];
  if (ids.length) return ids;
  return t.words.slice(0, WORDS_PER_DAY).map((w) => w.id);
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
