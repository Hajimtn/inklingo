// Spoken answers in Word Recall: letter alignment and the pronunciation score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignLetters, judgeSpeech } from '../public/js/shared/speech-match.js';

const show = (al) => al.cells.map((c) => (c.sep ? '_' : c.ok ? c.ch : `[${c.ch}>${c.heard || '-'}]`)).join('');

test('letter alignment marks wrong, missing and extra letters', () => {
  const a = alignLetters('stapler', 'stable');
  assert.equal(show(a), 'sta[p>b]le[r>-]');
  assert.equal(a.extra, 0);
  assert.equal(Math.round(a.sim * 100), 71);
  const b = alignLetters('filing cabinet', 'filling cabinet');
  assert.equal(show(b), 'filing_cabinet', 'word separator kept, extra letter counted');
  assert.equal(b.extra, 1);
  assert.equal(show(alignLetters('stapler', '')), '[s>-][t>-][a>-][p>-][l>-][e>-][r>-]');
});

test('judging recogniser alternatives: case/punctuation ignored, confidence scales the score', () => {
  const exact = judgeSpeech([{ text: 'Stapler.', conf: 0.93 }], ['stapler']);
  assert.equal(exact.ok, true);
  assert.equal(exact.score, 93);
  const unknownConf = judgeSpeech([{ text: 'stapler', conf: 0 }], ['stapler']);
  assert.equal(unknownConf.score, 100, 'Safari reports no confidence');
  const second = judgeSpeech([{ text: 'stable', conf: 0.8 }, { text: 'stapler', conf: 0 }], ['stapler']);
  assert.equal(second.ok, true);
  assert.equal(second.score, 90, 'found only in the 2nd alternative');
  assert.equal(second.heard, 'stapler');
  const wrong = judgeSpeech([{ text: 'stable', conf: 0.8 }], ['stapler']);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.score, 57);
  const tooFar = judgeSpeech([{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'stapler' }], ['stapler']);
  assert.equal(tooFar.ok, false, 'only the first 3 alternatives count');
  assert.equal(judgeSpeech([], ['stapler']).ok, false);
});

test('alternative answers and multi-word answers', () => {
  assert.equal(judgeSpeech([{ text: 'shipped', conf: 0.9 }], ['shipped', 'ship']).ok, true);
  assert.equal(judgeSpeech([{ text: 'filing cabinet', conf: 0.9 }], ['filing cabinet']).ok, true);
  assert.equal(judgeSpeech([{ text: 'filing-cabinet', conf: 0.9 }], ['filing cabinet']).ok, true);
});
