// Quick Learn rounds: introductions, option counts, wrong picks, scoring and the fast-mode clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FastRound, points, rng, PHOTO_TYPES, MAX_POINTS, TIME } from '../public/js/shared/fast-core.js';

const NEW = ['a', 'b', 'c', 'd', 'e'];
const KNOWN = ['k1', 'k2', 'k3'];
const EXTRA = ['x1', 'x2', 'x3', 'x4', 'x5'];

/** Plays a round, answering right (after `wrongFirst` wrong picks) every time. */
function play(round, { wrongFirst = () => 0, ms = 1000 } = {}) {
  const steps = [];
  for (let s = round.next(); s.kind !== 'end'; s = round.next()) {
    steps.push(s);
    if (s.kind !== 'ask') continue;
    const wrong = s.options.filter((o) => o !== s.id).slice(0, wrongFirst(s));
    for (const o of wrong) assert.equal(round.answer(o, ms).done, false);
    assert.equal(round.answer(s.id, ms).done, true);
  }
  return steps;
}

test('each new word is introduced, then asked straight away with the word and its sound', () => {
  const r = new FastRound({ newIds: NEW, extraIds: EXTRA, length: 30, rnd: rng(1) });
  const steps = play(r);
  const intros = steps.filter((s) => s.kind === 'intro').map((s) => s.id);
  assert.deepEqual(intros, NEW);
  for (const id of NEW) {
    const i = steps.findIndex((s) => s.kind === 'intro' && s.id === id);
    assert.equal(steps[i + 1].kind, 'ask');
    assert.equal(steps[i + 1].id, id);
    assert.equal(steps[i + 1].type, 'seeHear');
  }
  assert.equal(steps.filter((s) => s.kind === 'ask').length, 30);
  assert.equal(r.finished, true);
});

test('options grow from 2 to 4, always include the answer, never repeat', () => {
  const r = new FastRound({ newIds: NEW, knownIds: KNOWN, extraIds: EXTRA, length: 40, rnd: rng(2) });
  const asks = play(r).filter((s) => s.kind === 'ask');
  assert.deepEqual([asks[0], asks[10], asks[30]].map((s) => s.options.length), [2, 3, 4]);
  for (const s of asks) {
    assert.ok(s.options.includes(s.id));
    assert.equal(new Set(s.options).size, s.options.length);
  }
  for (let i = 1; i < asks.length; i++) {
    if (r.active.length > 1 && asks[i - 1].id === asks[i].id) assert.fail('the same word twice in a row');
  }
  assert.ok(asks.some((s) => !PHOTO_TYPES.has(s.type)), 'later questions also ask for the English word');
});

test('a wrong pick removes that option, costs the points and brings the word back sooner', () => {
  const r = new FastRound({ newIds: ['a', 'b'], extraIds: EXTRA, length: 12, rnd: rng(3) });
  r.next(); // intro a
  const q = r.next();
  const wrong = q.options.find((o) => o !== q.id);
  assert.deepEqual(r.answer(wrong, 500), { right: false, points: 0, done: false });
  assert.equal(r.answer(wrong, 500).done, false, 'the same wrong option twice is ignored');
  const res = r.answer(q.id, 500);
  assert.equal(res.right, true);
  assert.equal(res.points, 0, 'no points after a wrong pick');
  assert.equal(r.streak, 0);
  assert.ok(r.words.get('a').weight > 3);
  assert.equal(r.accuracy, 0);
});

test('points: first try only, faster and longer streaks earn more, capped', () => {
  assert.equal(points(800, 1, false), 0);
  assert.ok(points(500, 1, true) > points(4000, 1, true));
  assert.ok(points(1000, 6, true) > points(1000, 1, true));
  assert.ok(points(0, 99, true) <= MAX_POINTS);
  const r = new FastRound({ newIds: NEW, extraIds: EXTRA, length: 20, rnd: rng(4) });
  play(r, { ms: 600 });
  assert.equal(r.firstTryRight, 20);
  assert.equal(r.bestStreak, 20);
  assert.ok(r.score > 20 * 180 && r.score <= 20 * MAX_POINTS);
});

test('fast mode: the time bar drains, right answers refill it, an empty bar ends the round', () => {
  const r = new FastRound({ newIds: NEW, extraIds: EXTRA, length: 40, timed: true, rnd: rng(5) });
  r.next();
  const q = r.next();
  r.tick(6000);
  assert.ok(Math.abs(r.time - (1 - 6 * TIME.drainPerSec)) < 1e-9);
  r.answer(q.id, 6000);
  assert.ok(r.time > 1 - 6 * TIME.drainPerSec);
  r.tick(60_000);
  assert.equal(r.time, 0);
  assert.equal(r.finished, true);
  assert.equal(r.next().kind, 'end');
  const slow = new FastRound({ newIds: NEW, length: 10 });
  slow.tick(600_000);
  assert.equal(slow.finished, false, 'slow mode has no clock');
});

test('known words are asked without an introduction; an empty round ends at once', () => {
  const r = new FastRound({ knownIds: KNOWN, extraIds: EXTRA, length: 6, rnd: rng(6) });
  const steps = play(r);
  assert.equal(steps.filter((s) => s.kind === 'intro').length, 0);
  assert.ok(steps.every((s) => KNOWN.includes(s.id)));
  assert.deepEqual(new FastRound({}).next(), { kind: 'end' });
  const out = r.results();
  assert.equal(out.reduce((n, x) => n + x.asked, 0), 6);
});

test('topic rounds: words waiting for their introduction still serve as wrong options', () => {
  const ids = ['t1', 't2', 't3', 't4', 't5', 't6'];
  const r = new FastRound({ newIds: ids, extraIds: ids, length: 10, rnd: rng(7) });
  assert.equal(r.next().kind, 'intro');
  const q = r.next();
  assert.equal(q.options.length, 2, 'a real choice on the very first question');
  assert.ok(q.options.every((o) => ids.includes(o)));
});
