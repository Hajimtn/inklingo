// Study groups: shared topic schedule, member leaderboard and the end-of-topic mini-game.
//
// Rules
//  * the whole group studies one topic at a time; every weekday the server hands the group the
//    next 5 words of that topic (same words for everyone); Saturday/Sunday are review days
//  * when every word of the topic has been handed out the mini-game can be opened (any member);
//    it stays open 48 h. Members play together (live) or alone, once each, on the same questions
//  * the quiz closes when everyone has played or the window ends; then the group moves to the
//    next topic. Members below 80 % (or absent) must re-study the words they missed
//  * leaderboard points: learning the day's words (+streak), correct review cards, drawing
//    matches started from the group page, and – the biggest share – the mini-game score
//
// Data is kept as one JSON value in a key-value store (see store.js). Members authenticate with a
// random secret stored on their device; only its SHA-256 hash is saved.

import crypto from 'node:crypto';
import { buildQuestions, QuizRun, QUIZ_WINDOW_MS, PASS_RATE, MAX_POINTS } from '../public/js/shared/quiz-core.js';
import { GROUP_POINTS } from '../public/js/shared/group-points.js';

export const MAX_MEMBERS = 12;
export const WORDS_PER_DAY = 5;
export const POINTS = GROUP_POINTS;

const STORE_KEY = 'groups.json';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

export function localDate(ms, tzMinutes) {
  const d = new Date(ms + tzMinutes * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const dayNum = (ds) => Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)) / 864e5;
export const weekday = (ds) => new Date(dayNum(ds) * 864e5).getUTCDay();
const isWeekend = (ds) => [0, 6].includes(weekday(ds));
/** Monday of the date's week – the key of the weekly leaderboard. */
export function weekKey(ds) {
  const n = dayNum(ds);
  const back = (weekday(ds) + 6) % 7;
  const d = new Date((n - back) * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export class GroupError extends Error {
  constructor(text, status = 400) {
    super(text);
    this.status = status;
  }
}

export class GroupStore {
  /**
   * @param {object} o
   *  store     – key-value store (store.js) holding the "groups.json" value (null = memory only)
   *  topics    – [{id, title, words:[{id,en,alt,vi,pos,ex,images}]}] in learning order
   *  now       – clock (injectable for tests)
   *  devDates  – accept a client-supplied date (testing the weekly schedule); off in production
   *  send      – (memberKey, msg) delivers a realtime message to a connected member
   *  setTimer / clearTimer – injectable timers for the quiz runs
   */
  constructor({ store = null, topics, now = Date.now, devDates = false, send = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { store, topics, now, devDates, send, setTimer, clearTimer });
    this.groups = new Map();
    this.runs = new Map(); // `${code}:${memberId}` -> QuizRun (each member is in at most one run)
    this.lobbies = new Map(); // code -> {members: [ids], since}
    this.saveTimer = null;
    this.load();
  }

  // ---------------------------------------------------------------- persistence

  load() {
    const raw = this.store?.get(STORE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      for (const g of data.groups || []) this.groups.set(g.code, g);
    } catch (e) {
      console.error('[groups] could not read saved groups', e.message);
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.store) return;
    this.store.put(STORE_KEY, JSON.stringify({ version: 1, groups: [...this.groups.values()] }));
  }

  saveSoon() {
    if (!this.store || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  flush() {
    if (this.saveTimer) this.save();
  }

  // ---------------------------------------------------------------- helpers

  newCode() {
    let c;
    do c = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    while (this.groups.has(c));
    return c;
  }

  today(g, override) {
    if (this.devDates && typeof override === 'string' && DAY_RE.test(override)) return override;
    return localDate(this.now(), g.tz);
  }

  topic(g) {
    return this.topics[g.topicIdx] || null;
  }

  get(code) {
    const g = this.groups.get(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (!g) throw new GroupError('Không tìm thấy nhóm', 404);
    return g;
  }

  auth(code, memberId, secret) {
    const g = this.get(code);
    const m = g.members[memberId];
    if (!m || m.secretHash !== hash(secret)) throw new GroupError('Không xác thực được thành viên', 403);
    m.lastSeen = this.now();
    return { g, m };
  }

  cleanProfile(p = {}) {
    const name = String(p.name || '').trim().slice(0, 18);
    if (!name) throw new GroupError('Hãy nhập tên');
    return { name, avatar: /^(c\d{1,2}|p[0-9a-f]{16})$/.test(p.avatar) ? p.avatar : 'c7' };
  }

  addMember(g, profile) {
    if (Object.keys(g.members).length >= MAX_MEMBERS) throw new GroupError(`Nhóm đã đủ ${MAX_MEMBERS} người`);
    const id = 'm' + crypto.randomBytes(6).toString('hex');
    const secret = crypto.randomBytes(18).toString('base64url');
    g.members[id] = {
      id, ...this.cleanProfile(profile), secretHash: hash(secret), joinedAt: this.now(), joinedDay: this.today(g), lastSeen: this.now(),
      learned: {}, // date -> true (opened all of that day's words)
      streak: { count: 0, last: null },
      total: 0, weeks: {}, daily: {}, // daily[date] = {review, match}
      recall: { ok: 0, bad: 0 },
      needReview: [],
    };
    return { id, secret };
  }

  addPoints(m, n, day) {
    if (!(n > 0)) return;
    m.total += n;
    const wk = weekKey(day);
    m.weeks[wk] = (m.weeks[wk] || 0) + n;
  }

  // ---------------------------------------------------------------- group lifecycle

  /** Group name: printable text, 1–30 characters. */
  cleanGroupName(name) {
    const gname = String(name || '').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!gname) throw new GroupError('Hãy đặt tên nhóm');
    return gname;
  }

  create({ name, member, tz }) {
    const gname = this.cleanGroupName(name);
    const code = this.newCode();
    const g = {
      code, name: gname, createdAt: this.now(), tz: Number.isFinite(+tz) ? Math.max(-840, Math.min(840, Math.round(+tz))) : 420,
      ownerId: null, members: {}, topicIdx: 0, phase: 'learning', batches: {}, quiz: null, history: [],
    };
    this.groups.set(code, g);
    const cred = this.addMember(g, member);
    g.ownerId = cred.id;
    this.saveSoon();
    return { code, ...cred };
  }

  join(code, { member }) {
    const g = this.get(code);
    const cred = this.addMember(g, member);
    this.saveSoon();
    return { code: g.code, ...cred };
  }

  leave(g, memberId) {
    delete g.members[memberId];
    this.stopRun(g.code, memberId);
    const lobby = this.lobbies.get(g.code);
    if (lobby) lobby.members = lobby.members.filter((id) => id !== memberId);
    const ids = Object.keys(g.members);
    if (!ids.length) {
      this.groups.delete(g.code);
      this.lobbies.delete(g.code);
    } else if (g.ownerId === memberId) {
      g.ownerId = ids.sort((a, b) => g.members[a].joinedAt - g.members[b].joinedAt)[0];
    }
    if (this.groups.has(g.code)) this.maybeCloseQuiz(g);
    this.saveSoon();
  }

  rename(g, byId, name) {
    if (g.ownerId !== byId) throw new GroupError('Chỉ trưởng nhóm làm được', 403);
    g.name = this.cleanGroupName(name);
    this.saveSoon();
  }

  kick(g, byId, targetId) {
    if (g.ownerId !== byId) throw new GroupError('Chỉ trưởng nhóm làm được', 403);
    if (targetId === byId || !g.members[targetId]) throw new GroupError('Thành viên không hợp lệ');
    this.leave(g, targetId);
  }

  updateMember(m, profile) {
    Object.assign(m, this.cleanProfile(profile));
    this.saveSoon();
  }

  // ---------------------------------------------------------------- daily schedule

  delivered(g, topicId) {
    const out = [];
    for (const b of Object.values(g.batches)) if (b.topicId === topicId) out.push(...b.ids);
    return out;
  }

  /** Hand out today's 5 words if the group is learning and none were handed out today. */
  ensureToday(g, day) {
    if (g.phase !== 'learning' || g.batches[day]) return;
    const t = this.topic(g);
    if (!t) {
      g.phase = 'done';
      return;
    }
    const given = new Set(this.delivered(g, t.id));
    const fresh = t.words.filter((w) => !given.has(w.id));
    if (!fresh.length) {
      g.phase = 'quiz-ready';
      return;
    }
    // Weekends are review days – except the group's very first day, so there is something to study.
    if (isWeekend(day) && Object.keys(g.batches).length) return;
    g.batches[day] = { topicId: t.id, ids: fresh.slice(0, WORDS_PER_DAY).map((w) => w.id) };
    if (fresh.length <= WORDS_PER_DAY) g.phase = 'quiz-ready';
    this.saveSoon();
  }

  lastBatchDayBefore(g, day) {
    return Object.keys(g.batches).filter((d) => d < day).sort().at(-1) || null;
  }

  // ---------------------------------------------------------------- progress reports

  report(g, m, body, day) {
    const kind = body.kind;
    if (kind === 'learned') {
      if (!g.batches[day] || m.learned[day]) return;
      m.learned[day] = true;
      const prev = this.lastBatchDayBefore(g, day);
      m.streak = { count: prev && m.streak.last === prev ? m.streak.count + 1 : 1, last: day };
      this.addPoints(m, POINTS.learnDay + POINTS.streakStep * Math.min(m.streak.count - 1, POINTS.streakMax), day);
    } else if (kind === 'recall') {
      const ok = Math.max(0, Math.min(50, Math.floor(+body.ok || 0)));
      const bad = Math.max(0, Math.min(50, Math.floor(+body.bad || 0)));
      m.recall.ok += ok;
      m.recall.bad += bad;
      if (body.source === 'review') {
        const d = (m.daily[day] ||= { review: 0, match: 0 });
        const pts = Math.min(ok, POINTS.reviewCap - d.review);
        d.review += Math.max(0, pts);
        this.addPoints(m, pts, day);
        // Weekly Word Recall ranking: words recalled correctly after a delay.
        const wk = weekKey(day);
        (m.recalled ||= {})[wk] = (m.recalled[wk] || 0) + ok;
      }
      if (Array.isArray(body.cleared)) {
        const cleared = new Set(body.cleared.map(String));
        m.needReview = m.needReview.filter((id) => !cleared.has(id));
      }
    } else if (kind === 'match') {
      const d = (m.daily[day] ||= { review: 0, match: 0 });
      const pts = Math.min(Math.round(Math.max(0, Math.min(1000, +body.points || 0)) / 10), POINTS.matchCap - d.match);
      d.match += Math.max(0, pts);
      this.addPoints(m, pts, day);
    } else {
      throw new GroupError('Loại báo cáo không hợp lệ');
    }
    this.saveSoon();
  }

  // ---------------------------------------------------------------- mini-game

  openQuiz(g) {
    if (g.phase === 'quiz-open') return;
    if (g.phase !== 'quiz-ready') throw new GroupError('Chưa học hết chủ đề');
    const t = this.topic(g);
    const id = `${t.id}-${this.now().toString(36)}`;
    g.quiz = { id, topicId: t.id, openedAt: this.now(), deadline: this.now() + QUIZ_WINDOW_MS, questions: buildQuestions(t.words, id), attempts: {} };
    g.phase = 'quiz-open';
    this.saveSoon();
  }

  eligible(g, memberId) {
    return g.phase === 'quiz-open' && g.members[memberId] && !g.quiz.attempts[memberId];
  }

  runOf(code, memberId) {
    return this.runs.get(`${code}:${memberId}`) || null;
  }

  startRun(g, memberIds, live) {
    const q = g.quiz;
    for (const id of memberIds) q.attempts[id] = { startedAt: this.now(), live, answers: {}, done: false };
    const run = new QuizRun({
      id: q.id, questions: q.questions, memberIds, live, now: this.now, setTimer: this.setTimer, clearTimer: this.clearTimer,
      imgUrl: (k) => `api/qimg/${g.code}/${q.id}/${k}`,
      send: (mid, msg) => this.send(`${g.code}:${mid}`, msg),
      onAnswer: (mid, k, res) => {
        if (g.quiz?.id === q.id && q.attempts[mid]) q.attempts[mid].answers[k] = res;
        this.saveSoon();
      },
      onFinish: (results) => {
        for (const mid of memberIds) {
          this.runs.delete(`${g.code}:${mid}`);
          if (g.quiz?.id === q.id && q.attempts[mid]) Object.assign(q.attempts[mid], { done: true, score: results[mid].score, correct: results[mid].correct });
        }
        this.maybeCloseQuiz(g);
        this.saveSoon();
      },
    });
    for (const id of memberIds) this.runs.set(`${g.code}:${id}`, run);
    run.start();
    this.saveSoon();
    return run;
  }

  startSolo(g, m) {
    if (this.runOf(g.code, m.id)) return this.runOf(g.code, m.id);
    if (!this.eligible(g, m.id)) throw new GroupError(g.phase === 'quiz-open' ? 'Bạn đã chơi rồi' : 'Mini-game chưa mở');
    this.leaveLobby(g, m.id);
    return this.startRun(g, [m.id], false);
  }

  joinLobby(g, m) {
    if (!this.eligible(g, m.id)) throw new GroupError(g.phase === 'quiz-open' ? 'Bạn đã chơi rồi' : 'Mini-game chưa mở');
    const lobby = this.lobbies.get(g.code) || { members: [], since: this.now() };
    if (!lobby.members.includes(m.id)) lobby.members.push(m.id);
    this.lobbies.set(g.code, lobby);
    this.broadcastLobby(g);
  }

  leaveLobby(g, memberId) {
    const lobby = this.lobbies.get(g.code);
    if (!lobby) return;
    lobby.members = lobby.members.filter((id) => id !== memberId);
    if (!lobby.members.length) this.lobbies.delete(g.code);
    this.broadcastLobby(g, [memberId]);
  }

  broadcastLobby(g, extra = []) {
    const lobby = this.lobbies.get(g.code);
    const members = lobby ? lobby.members : [];
    for (const id of new Set([...members, ...extra])) this.send(`${g.code}:${id}`, { type: 'gq-lobby', members });
  }

  startLive(g, m) {
    const lobby = this.lobbies.get(g.code);
    if (!lobby || !lobby.members.includes(m.id)) throw new GroupError('Bạn chưa vào phòng chờ');
    const ids = lobby.members.filter((id) => this.eligible(g, id));
    if (ids.length < 2) throw new GroupError('Cần ít nhất 2 người');
    this.lobbies.delete(g.code);
    return this.startRun(g, ids, true);
  }

  stopRun(code, memberId) {
    const run = this.runOf(code, memberId);
    if (!run) return;
    run.memberIds = run.memberIds.filter((id) => id !== memberId);
    this.runs.delete(`${code}:${memberId}`);
    if (!run.memberIds.length) run.stop();
  }

  /** Attempts left unfinished by a server restart count with the answers given so far. */
  settleOrphans(g) {
    if (g.phase !== 'quiz-open') return;
    for (const [id, a] of Object.entries(g.quiz.attempts)) {
      if (a.done || this.runOf(g.code, id)) continue;
      const answers = Object.values(a.answers);
      Object.assign(a, { done: true, score: answers.reduce((s, x) => s + x.points, 0), correct: answers.filter((x) => x.ok).length });
    }
  }

  maybeCloseQuiz(g) {
    if (g.phase !== 'quiz-open') return false;
    this.settleOrphans(g);
    const ids = Object.keys(g.members);
    const running = ids.some((id) => this.runOf(g.code, id));
    const allDone = ids.every((id) => g.quiz.attempts[id]?.done);
    const expired = this.now() >= g.quiz.deadline;
    if (running || !(allDone || expired)) return false;
    this.closeQuiz(g);
    return true;
  }

  closeQuiz(g) {
    const q = g.quiz;
    const day = this.today(g);
    const total = q.questions.length;
    const wordMiss = Object.fromEntries(q.questions.map((x) => [x.wordId, 0]));
    const results = [];
    for (const m of Object.values(g.members)) {
      const a = q.attempts[m.id];
      const absent = !a;
      const missed = q.questions.filter((x, k) => !a?.answers[k]?.ok).map((x) => x.wordId);
      const correct = total - missed.length;
      const score = a?.score ?? 0;
      for (const id of missed) wordMiss[id]++;
      m.recall.ok += absent ? 0 : correct;
      m.recall.bad += absent ? 0 : missed.length;
      const pct = total ? correct / total : 0;
      m.needReview = pct >= PASS_RATE ? [] : missed;
      this.addPoints(m, Math.round(score * POINTS.quizScale), day);
      results.push({ memberId: m.id, name: m.name, avatar: m.avatar, score, correct, total, pct, absent, missed, passed: pct >= PASS_RATE });
    }
    results.sort((a, b) => b.score - a.score);
    const forgot = Object.entries(wordMiss).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([wordId, misses]) => ({ wordId, misses }));
    g.history.push({ topicId: q.topicId, quizId: q.id, openedAt: q.openedAt, closedAt: this.now(), maxScore: total * MAX_POINTS, results, forgot });
    g.quiz = null;
    this.lobbies.delete(g.code);
    g.topicIdx++;
    g.phase = this.topic(g) ? 'learning' : 'done';
    this.saveSoon();
  }

  /** Periodic check: close quizzes whose 48 h window has ended. */
  tick() {
    for (const g of this.groups.values()) this.maybeCloseQuiz(g);
  }

  // ---------------------------------------------------------------- view

  view(g, me, day) {
    this.ensureToday(g, day);
    this.maybeCloseQuiz(g);
    const t = this.topic(g);
    const wk = weekKey(day);
    const members = Object.values(g.members).map((m) => ({
      id: m.id, name: m.name, avatar: m.avatar, owner: m.id === g.ownerId,
      // A streak is alive while the member studied today or on the group's previous study day.
      learnedToday: !!m.learned[day], streak: m.streak.last === day || (m.streak.last && m.streak.last === this.lastBatchDayBefore(g, day)) ? m.streak.count : 0,
      total: m.total, week: m.weeks[wk] || 0, recalledWeek: m.recalled?.[wk] || 0,
      recall: m.recall.ok + m.recall.bad ? m.recall.ok / (m.recall.ok + m.recall.bad) : null,
      needReview: m.needReview.length,
      online: this.now() - m.lastSeen < 90_000,
    }));
    const q = g.quiz;
    const lobby = this.lobbies.get(g.code);
    const last = g.history.at(-1) || null;
    const meM = g.members[me];
    return {
      code: g.code, name: g.name, me, ownerId: g.ownerId, today: day, week: wk, phase: g.phase,
      topicIdx: g.topicIdx, topicId: t?.id || null,
      delivered: t ? this.delivered(g, t.id).length : 0, topicSize: t ? t.words.length : 0,
      // A batch of the topic that just ended is not shown under the new topic.
      todayBatch: g.batches[day] && g.batches[day].topicId === t?.id ? g.batches[day].ids : null,
      batches: Object.fromEntries(Object.entries(g.batches).map(([d, b]) => [d, b.ids])),
      joinedDay: meM.joinedDay,
      members,
      my: { needReview: meM.needReview, learnedToday: !!meM.learned[day] },
      quiz: q ? {
        id: q.id, topicId: q.topicId, deadline: q.deadline, total: q.questions.length,
        played: Object.keys(q.attempts).filter((id) => q.attempts[id].done),
        playing: Object.keys(q.attempts).filter((id) => !q.attempts[id].done),
        mine: q.attempts[me] ? { done: !!q.attempts[me].done, score: q.attempts[me].score ?? null, correct: q.attempts[me].correct ?? null } : null,
        lobby: lobby ? lobby.members : [],
      } : null,
      lastResult: last ? { ...last, results: last.results.map(({ missed, ...r }) => ({ ...r, missed: r.memberId === me ? missed : undefined })) } : null,
      history: g.history.map((h) => ({ topicId: h.topicId, closedAt: h.closedAt, avg: h.results.length ? h.results.reduce((s, r) => s + r.pct, 0) / h.results.length : 0 })),
    };
  }
}
