// Public Quick Learn leaderboard: tokens, plausibility checks, names, ranking and persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FastBoard, cleanName, TOP_N, MIN_MS_PER_Q } from '../server/fast-board.js';
import { fileStore } from '../server/store.js';
import { MAX_POINTS } from '../public/js/shared/fast-core.js';

function board() {
  let now = 1_000_000;
  const file = fileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'fast-')));
  const b = new FastBoard({ store: file, topics: ['office', 'travel'], now: () => now });
  return { b, file, advance: (ms) => (now += ms) };
}

test('a score needs a fresh token, a real topic and a possible value', () => {
  const { b, advance } = board();
  assert.throws(() => b.start('nope'), /chủ đề/);
  const { token } = b.start('office');
  assert.throws(() => b.submit({ token, name: 'An', score: 100, answered: 40, correct: 1 }), /không hợp lệ/, 'too fast');
  advance(40 * MIN_MS_PER_Q);
  assert.throws(() => b.submit({ token, name: 'An', score: 40 * MAX_POINTS + 1, answered: 40, correct: 40 }), /không hợp lệ/);
  assert.throws(() => b.submit({ token, name: 'An', score: 100, answered: 41, correct: 1 }), /không hợp lệ/);
  const r = b.submit({ token, name: '  An​  ', avatar: 'c3', score: 5000, answered: 40, correct: 35 });
  assert.equal(r.rank, 1);
  assert.equal(r.top[0].name, 'An');
  assert.throws(() => b.submit({ token, name: 'An', score: 6000, answered: 40, correct: 40 }), /đã gửi/, 'one score per round');
  assert.throws(() => b.submit({ token: 'made-up', name: 'An', score: 1, answered: 1, correct: 1 }), /không hợp lệ/);
});

test('ranking keeps the best TOP_N per topic and survives a restart', () => {
  const { b, file, advance } = board();
  for (let i = 0; i < TOP_N + 5; i++) {
    const { token } = b.start('travel');
    advance(30_000);
    b.submit({ token, name: 'P' + i, avatar: 'x', score: 1000 + i * 10, answered: 40, correct: 30 }, 'ip' + i);
  }
  const top = b.top('travel');
  assert.equal(top.length, TOP_N);
  assert.equal(top[0].score, 1000 + (TOP_N + 4) * 10);
  assert.equal(top[0].avatar, 'c7', 'unknown avatar keys fall back to a colour');
  assert.deepEqual(b.top('office'), []);
  const { token } = b.start('travel');
  advance(30_000);
  assert.equal(b.submit({ token, name: 'Low', score: 10, answered: 40, correct: 1 }).rank, 0, 'not in the top');
  const again = new FastBoard({ store: file, topics: ['office', 'travel'] });
  assert.deepEqual(again.top('travel'), top);
});

test('names: cleaned, required, no rude words; normal Vietnamese names pass', () => {
  assert.equal(cleanName('  Nguyễn   Văn  Long  '), 'Nguyễn Văn Long');
  assert.equal(cleanName('Cường'), 'Cường');
  assert.equal(cleanName('Đông'), 'Đông');
  assert.equal(cleanName('x'.repeat(30)).length, 18);
  assert.throws(() => cleanName('   '), /Thiếu tên/);
  assert.throws(() => cleanName('đm fuck you'), /không phù hợp/);
  assert.throws(() => cleanName('Lồn'), /không phù hợp/);
});

test('rate limit per address', () => {
  const { b, advance } = board();
  let err = null;
  for (let i = 0; i < 45 && !err; i++) {
    const { token } = b.start('office');
    advance(20_000);
    try { b.submit({ token, name: 'Spam', score: 1, answered: 40, correct: 1 }, '1.2.3.4'); } catch (e) { err = e; }
  }
  assert.equal(err?.status, 429);
});
