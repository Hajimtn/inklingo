// Study groups + the end-of-topic mini-game (unit tests with a fake clock and fake timers).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GroupStore, weekKey, POINTS } from '../server/groups.js';
import { fileStore } from '../server/store.js';
import { buildQuestions, gapSentence, decodeSay, publicQuestion, QUIZ_WINDOW_MS, MAX_POINTS } from '../public/js/shared/quiz-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/vocab.json'), 'utf8'));
const T0 = Date.UTC(2026, 9, 12, 2, 0); // Monday 12 Oct 2026, 09:00 in UTC+7

function harness() {
  let now = T0;
  const timers = [];
  const inbox = new Map(); // memberKey -> messages
  const store = new GroupStore({
    topics: vocab.topics,
    now: () => now,
    send: (key, msg) => (inbox.get(key) || inbox.set(key, []).get(key)).push(msg),
    setTimer: (fn, ms) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
  });
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.live = false;
      next.fn();
    }
    now = end;
  };
  const day = (n) => (now = T0 + n * 864e5);
  const msgs = (code, id, type) => (inbox.get(`${code}:${id}`) || []).filter((m) => !type || m.type === type);
  return { store, advance, day, msgs, get now() { return now; } };
}

const setup = (n = 3) => {
  const h = harness();
  const a = h.store.create({ name: 'TOEIC 6', member: { name: 'An', avatar: 'c1' }, tz: 420 });
  const ids = [a.id];
  const secrets = { [a.id]: a.secret };
  for (let i = 1; i < n; i++) {
    const j = h.store.join(a.code, { member: { name: 'B' + i, avatar: 'c2' } });
    ids.push(j.id);
    secrets[j.id] = j.secret;
  }
  const g = h.store.get(a.code);
  return { ...h, g, code: a.code, ids, secrets };
};

/** Hand out every word of the current topic (one weekday per batch). */
function learnWholeTopic(ctx, startDay = 0) {
  let d = startDay;
  while (ctx.g.phase === 'learning') {
    ctx.day(d);
    const today = ctx.store.today(ctx.g);
    ctx.store.view(ctx.g, ctx.ids[0], today);
    d++;
  }
  return d;
}

test('quiz questions: every word once, 4 rounds, gap sentences contain a blank, no answer leaks', () => {
  const t = vocab.topics[0];
  const qs = buildQuestions(t.words, 'seed-1');
  assert.equal(qs.length, t.words.length);
  assert.deepEqual(new Set(qs.map((q) => q.wordId)).size, t.words.length);
  assert.deepEqual([...new Set(qs.map((q) => q.type))], ['photo', 'listen', 'gap', 'meaning']);
  for (const q of qs) {
    if (q.options) {
      assert.equal(q.options.length, 4);
      assert.ok(q.options.includes(q.en));
    }
    if (q.type === 'gap') assert.ok(q.sentence.includes('_____') && !new RegExp(`\\b${q.en}\\b`, 'i').test(q.sentence), q.sentence);
    const pub = JSON.stringify(publicQuestion(q, 0, qs.length, 'api/qimg/X/1/0'));
    assert.ok(!pub.includes(q.wordId + '.webp') && !pub.includes(q.wordId + '.jpg') && !pub.includes('"wordId"'), 'public question must not name the file/word id');
    if (q.type === 'listen') assert.equal(decodeSay(publicQuestion(q, 0, 1).say), q.en);
  }
  assert.deepEqual(buildQuestions(t.words, 'seed-1'), qs, 'same seed -> same questions for everyone');
  assert.equal(gapSentence('Please sign both copies of the contracts.', 'contract'), 'Please sign both copies of the _____.');
  assert.equal(gapSentence('She was scheduling interviews.', 'schedule'), 'She was _____ interviews.');
});

test('shared schedule: 5 words per weekday for the whole group, weekends off, quiz-ready at the end', () => {
  const c = setup(3);
  const mon = c.store.view(c.g, c.ids[0], '2026-10-12');
  assert.equal(mon.todayBatch.length, 5);
  const other = c.store.view(c.g, c.ids[2], '2026-10-12');
  assert.deepEqual(other.todayBatch, mon.todayBatch, 'everyone gets the same words');
  c.day(5); // Saturday
  assert.equal(c.store.view(c.g, c.ids[0], c.store.today(c.g)).todayBatch, null);
  c.day(4); // Friday
  learnWholeTopic(c, 1);
  const size = vocab.topics[0].words.length;
  assert.equal(c.store.delivered(c.g, vocab.topics[0].id).length, size);
  assert.equal(c.g.phase, 'quiz-ready');
});

test('leaderboard: learning days with streak, capped review points, weekly key', () => {
  const c = setup(2);
  const [a] = c.ids;
  const m = c.g.members[a];
  for (let d = 0; d < 3; d++) {
    c.day(d);
    const today = c.store.today(c.g);
    c.store.view(c.g, a, today);
    c.store.report(c.g, m, { kind: 'learned' }, today);
    c.store.report(c.g, m, { kind: 'learned' }, today); // duplicate ignored
  }
  assert.equal(m.streak.count, 3);
  assert.equal(m.total, 10 + 12 + 14);
  c.store.report(c.g, m, { kind: 'recall', source: 'review', ok: 30, bad: 2 }, '2026-10-14');
  assert.equal(m.total, 36 + POINTS.reviewCap, 'review points are capped per day');
  c.store.report(c.g, m, { kind: 'recall', source: 'guess', ok: 5, bad: 0 }, '2026-10-14');
  assert.equal(m.total, 56, 'guesses count for recall only');
  const me = c.store.view(c.g, a, '2026-10-14').members.find((x) => x.id === a);
  assert.equal(me.recalledWeek, 30, 'Word Recall ranking counts delayed recalls, not drawing guesses');
  assert.equal(c.store.view(c.g, a, '2026-10-19').members.find((x) => x.id === a).recalledWeek, 0, 'the ranking restarts each week');
  assert.equal(m.recall.ok, 35);
  c.store.report(c.g, m, { kind: 'match', points: 900 }, '2026-10-14');
  assert.equal(m.total, 56 + POINTS.matchCap);
  assert.equal(weekKey('2026-10-18'), '2026-10-12');
  assert.equal(weekKey('2026-10-19'), '2026-10-19');
});

test('mini-game solo: same questions, server timing, score, re-study below 80%, topic advances', () => {
  const c = setup(2);
  learnWholeTopic(c);
  c.store.openQuiz(c.g);
  assert.equal(c.g.phase, 'quiz-open');
  const [a, b] = c.ids;
  const qs = c.g.quiz.questions;

  // A answers everything correctly and fast.
  const runA = c.store.startSolo(c.g, c.g.members[a]);
  for (let k = 0; k < qs.length; k++) {
    const q = c.msgs(c.code, a, 'gq-question').at(-1).q;
    assert.equal(q.index, k);
    assert.equal(runA.answer(a, k, qs[k].en).ok, true);
    c.advance(5000); // reveal pause
  }
  assert.ok(c.msgs(c.code, a, 'gq-done').length === 1);
  assert.throws(() => c.store.startSolo(c.g, c.g.members[a]), /đã chơi/);
  assert.equal(c.g.phase, 'quiz-open', 'still waiting for B');

  // B answers the first 5 right, then walks away: the clock keeps running.
  const runB = c.store.startSolo(c.g, c.g.members[b]);
  for (let k = 0; k < 5; k++) {
    runB.answer(b, k, qs[k].en);
    c.advance(5000);
  }
  assert.equal(runB.answer(b, 5, 'nonsense').ok, false);
  c.advance(60 * 60_000);
  assert.equal(c.g.phase, 'learning', 'quiz closed after everyone played');
  assert.equal(c.g.topicIdx, 1);
  const res = c.g.history[0].results;
  const ra = res.find((r) => r.memberId === a);
  const rb = res.find((r) => r.memberId === b);
  assert.equal(ra.correct, qs.length);
  assert.ok(ra.score > qs.length * 90 && ra.score <= qs.length * MAX_POINTS);
  assert.equal(rb.correct, 5);
  assert.equal(c.g.members[a].needReview.length, 0);
  assert.equal(c.g.members[b].needReview.length, qs.length - 5, 'B must re-study the missed words');
  assert.equal(c.g.history[0].forgot[0].misses, 1);
  assert.equal(c.g.members[a].total, Math.round(ra.score * POINTS.quizScale));
  // B clears re-study words through review reports.
  c.store.report(c.g, c.g.members[b], { kind: 'recall', source: 'review', ok: 2, bad: 0, cleared: c.g.members[b].needReview.slice(0, 2) }, '2026-10-20');
  assert.equal(c.g.members[b].needReview.length, qs.length - 7);
});

test('mini-game answers: late, duplicate and wrong-question answers are rejected', () => {
  const c = setup(1);
  learnWholeTopic(c);
  c.store.openQuiz(c.g);
  const [a] = c.ids;
  const run = c.store.startSolo(c.g, c.g.members[a]);
  const q0 = c.g.quiz.questions[0];
  assert.equal(run.answer(a, 1, 'x').error, 'closed');
  c.advance(q0.limit + 100); // after the visible deadline, inside the grace window
  assert.equal(run.answer(a, 0, q0.en).points, 50, 'correct but no speed bonus');
  assert.equal(run.answer(a, 0, q0.en).error, 'duplicate');
});

test('mini-game live: shared timeline, others see who answered, lobby needs 2 players', () => {
  const c = setup(3);
  learnWholeTopic(c);
  c.store.openQuiz(c.g);
  const [a, b, x] = c.ids;
  c.store.joinLobby(c.g, c.g.members[a]);
  assert.throws(() => c.store.startLive(c.g, c.g.members[a]), /2 người/);
  c.store.joinLobby(c.g, c.g.members[b]);
  assert.deepEqual(c.msgs(c.code, a, 'gq-lobby').at(-1).members, [a, b]);
  const run = c.store.startLive(c.g, c.g.members[b]);
  assert.ok(c.msgs(c.code, a, 'gq-countdown').length && c.msgs(c.code, b, 'gq-countdown').length);
  c.advance(3000);
  const qs = c.g.quiz.questions;
  run.answer(a, 0, qs[0].en);
  assert.deepEqual(c.msgs(c.code, b, 'gq-answered').at(-1).answered, [a]);
  assert.equal(c.msgs(c.code, a, 'gq-reveal').length, 0, 'waits for everyone or the timer');
  run.answer(b, 0, 'wrong');
  const rev = c.msgs(c.code, b, 'gq-reveal').at(-1);
  assert.equal(rev.answer.en, qs[0].en);
  assert.equal(rev.others.length, 2);
  // X (not in the live run) can still play alone later; the quiz stays open until then.
  c.advance(qs.length * 30_000);
  assert.equal(c.g.phase, 'quiz-open');
  assert.ok(c.store.eligible(c.g, x));
});

test('48 h window: absent members count as 0 and must re-study the whole topic', () => {
  const c = setup(2);
  learnWholeTopic(c);
  c.store.openQuiz(c.g);
  c.advance(QUIZ_WINDOW_MS + 1000);
  c.store.tick();
  assert.equal(c.g.phase, 'learning');
  const r = c.g.history[0].results;
  assert.ok(r.every((x) => x.absent && x.score === 0));
  assert.equal(c.g.members[c.ids[1]].needReview.length, vocab.topics[0].words.length);
});

test('membership: max size, owner hand-over, kick, persistence and secret check', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sw-groups-')), 'groups.json');
  const s1 = new GroupStore({ store: fileStore(path.dirname(file)), topics: vocab.topics, now: () => T0 });
  const a = s1.create({ name: 'G', member: { name: 'Owner', avatar: 'c0' }, tz: 420 });
  const others = Array.from({ length: 11 }, (_, i) => s1.join(a.code, { member: { name: 'P' + i } }));
  assert.throws(() => s1.join(a.code, { member: { name: 'Late' } }), /12/);
  const g = s1.get(a.code);
  assert.throws(() => s1.kick(g, others[0].id, others[1].id), /trưởng nhóm/);
  assert.throws(() => s1.rename(g, others[0].id, 'Hacked'), /trưởng nhóm/, 'only the leader renames the group');
  assert.throws(() => s1.rename(g, a.id, '   '), /tên nhóm/);
  s1.rename(g, a.id, '  TOEIC   sáng\u0007 thứ 7 – nhóm rất là dài dài dài  ');
  assert.equal(g.name, 'TOEIC sáng thứ 7 – nhóm rất là');
  assert.equal(s1.view(g, a.id, s1.today(g)).name, g.name);
  s1.kick(g, a.id, others[1].id);
  assert.equal(Object.keys(g.members).length, 11);
  s1.leave(g, a.id);
  assert.equal(g.ownerId, others[0].id, 'oldest member becomes owner');
  s1.save();
  const s2 = new GroupStore({ store: fileStore(path.dirname(file)), topics: vocab.topics, now: () => T0 });
  assert.ok(s2.auth(a.code, others[0].id, others[0].secret));
  assert.throws(() => s2.auth(a.code, others[0].id, 'wrong-secret'), /xác thực/);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(others[0].secret), 'only a hash of the secret is stored');
});
