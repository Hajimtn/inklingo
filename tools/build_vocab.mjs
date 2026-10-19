// Builds public/data/vocab.json from content/*.json + public/data/images.json.
// Acceptance rule (GDD §12.6): a word is only shipped when it has at least one verified
// real photo with known source, author and licence. Words without one are reported and skipped.
// The easy everyday words (tools/easy_words/*.txt) are a separate, photo-less list used only as
// word cards when drawing; they never enter the learning path.
//
//   node tools/build_vocab.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(ROOT, 'content');
const images = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/images.json'), 'utf8'));

const errors = [];
const skipped = [];
const ids = new Set();
const topics = [];

for (const file of fs.readdirSync(contentDir).filter((f) => f.endsWith('.json')).sort()) {
  const t = JSON.parse(fs.readFileSync(path.join(contentDir, file), 'utf8'));
  const words = [];
  for (const w of t.words) {
    const where = `${file}:${w.id}`;
    if (ids.has(w.id)) errors.push(`${where} duplicate id`);
    ids.add(w.id);
    for (const k of ['en', 'vi', 'ipa', 'explain']) if (!w[k]) errors.push(`${where} missing ${k}`);
    if (!Array.isArray(w.ex) || w.ex.length !== 2) errors.push(`${where} example must be [en, vi]`);
    if (!Array.isArray(w.ideas) || w.ideas.length < 2) errors.push(`${where} needs >= 2 drawing ideas`);
    for (const [i, idea] of (w.ideas || []).entries()) {
      if (!idea.scene || !idea.elements?.length || !idea.steps?.length) errors.push(`${where} idea ${i} incomplete`);
    }
    const imgs = (images[w.id] || [])
      .filter((im) => im.file && im.page && im.license && im.author)
      // Some Commons user names carry decorative emoji; the UI shows none, so keep only the name text.
      .map((im) => ({ ...im, author: im.author.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu, '').replace(/\s{2,}/g, ' ').trim() }));
    if (!imgs.length) {
      skipped.push(w.id);
      continue;
    }
    // Hand-drawn line-art template for Ghost Sketch (public/data/ghosts/<id>.svg), when there is one.
    const sketch = fs.existsSync(path.join(ROOT, 'public/data/ghosts', w.id + '.svg'));
    words.push({ ...w, alt: w.alt || [], images: imgs, ...(sketch ? { sketch: true } : {}) });
  }
  topics.push({ id: t.id, title: t.title, vi: t.vi, icon: t.icon, cover: words[0]?.images[0]?.file || null, words });
}

// ---------------------------------------------------------------- easy everyday words
const easyDir = path.join(ROOT, 'tools/easy_words');
const toeicEn = new Set(topics.flatMap((t) => t.words.map((w) => w.en.toLowerCase())));
const easyWords = [];
for (const file of fs.readdirSync(easyDir).filter((f) => f.endsWith('.txt')).sort()) {
  let cat = null;
  fs.readFileSync(path.join(easyDir, file), 'utf8').split('\n').forEach((line, i) => {
    const where = `easy_words/${file}:${i + 1}`;
    if (!line.trim() || line.startsWith('#!')) return;
    if (line.startsWith('## ')) return void (cat = line.slice(3).trim());
    const [en, vi, ipa, pos, ...rest] = line.split('|').map((x) => x.trim());
    if (rest.length || !en || !vi || !/^\/.+\/$/.test(ipa || '') || !['n', 'v', 'adj', 'adv'].includes(pos)) return void errors.push(`${where} bad line`);
    const id = 'e-' + en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (ids.has(id)) errors.push(`${where} duplicate id ${id}`);
    if (toeicEn.has(en.toLowerCase())) errors.push(`${where} "${en}" is already a TOEIC word`);
    ids.add(id);
    easyWords.push({ id, en, vi, ipa, pos, cat, alt: [], easy: true });
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const easy = { id: 'easy', title: 'Everyday Words', vi: 'Từ thông dụng', icon: 'star', words: easyWords };
const out = { version: 4, builtAt: new Date().toISOString(), topics, easy };
fs.writeFileSync(path.join(ROOT, 'public/data/vocab.json'), JSON.stringify(out));
const total = topics.reduce((s, t) => s + t.words.length, 0);
for (const t of topics) console.log(`${t.id.padEnd(14)} ${String(t.words.length).padStart(3)} words`);
console.log(`total ${total} words shipped`);
console.log(`easy           ${easyWords.length} everyday words (word cards only)`);
if (skipped.length) console.log(`skipped (no verified photo): ${skipped.join(', ')}`);
