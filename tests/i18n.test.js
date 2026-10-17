// Interface language: every tr('…') key used in the browser code has an English entry,
// placeholders/plurals work, and finished server texts are translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

globalThis.localStorage = { store: { 'sw:prefs': JSON.stringify({ lang: 'en' }) }, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };
const { tr, tServer } = await import('../public/js/i18n.js');
const EN = (await import('../public/js/i18n/en.js')).default;

function* jsFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'i18n') yield* jsFiles(f); } else if (f.endsWith('.js')) yield f;
  }
}

test('every UI string has an English translation', () => {
  const missing = [];
  for (const f of jsFiles('public/js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?<![\w.$])tr\('((?:[^'\\\n]|\\.)*)'/g)) {
      const key = m[1].replace(/\\'/g, "'");
      if (!(key in EN)) missing.push(`${path.relative('.', f)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('placeholders, plurals and untranslated fallbacks', () => {
  assert.equal(tr('Đã lưu hồ sơ'), 'Profile saved');
  assert.equal(tr('{n} từ', { n: 1 }), '1 word');
  assert.equal(tr('{n} từ', { n: 5 }), '5 words');
  assert.equal(tr('Lượt của {name}', { name: 'An' }), 'An’s turn');
  assert.equal(tr('Một câu chưa có'), 'Một câu chưa có', 'unknown text falls back to Vietnamese');
});

test('server texts are translated, with their values kept', () => {
  assert.equal(tServer('Bạn gửi quá nhanh, chờ một chút.'), 'You are sending too fast, wait a moment.');
  assert.equal(tServer('Lan đã vào phòng.'), 'Lan joined the room.');
  assert.equal(tServer('Bạn đã gửi “stapler” rồi.'), 'You already sent “stapler”.');
  assert.equal(tServer('Nhóm đã đủ 12 người'), 'The group is full (12 people)');
  assert.equal(tServer('Một thông báo lạ'), 'Một thông báo lạ');
});
