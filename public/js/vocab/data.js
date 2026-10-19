// Vocabulary data access + real-photo rendering with attribution and verified fallbacks.

import { h } from '../ui/dom.js';
import { icon, hasIcon } from '../ui/icons.js';

import { tr } from '../i18n.js';
let vocab = null;
const byId = new Map();
const easyById = new Map();

export async function loadVocab() {
  if (vocab) return vocab;
  const res = await fetch('data/vocab.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(tr('Không tải được dữ liệu từ vựng'));
  vocab = await res.json();
  vocab.topics.forEach((t, ti) => {
    t.index = ti;
    t.words.forEach((w, wi) => {
      w.topic = t.id;
      w.topicIndex = ti;
      w.order = wi;
      byId.set(w.id, w);
    });
  });
  // Easy everyday words: word cards when drawing only (no photo, never part of the learning path).
  vocab.easy ||= { id: 'easy', title: 'Everyday Words', vi: 'Từ thông dụng', icon: 'star', words: [] };
  for (const w of vocab.easy.words) {
    w.topic = 'easy';
    easyById.set(w.id, w);
  }
  return vocab;
}

export const topics = () => vocab.topics;
export const topicById = (id) => vocab.topics.find((t) => t.id === id);
export const word = (id) => byId.get(id) || easyById.get(id);
/** Every TOEIC word (the learning path). Easy everyday words are separate: easyTopic(). */
export const allWords = () => [...byId.values()];
export const easyTopic = () => vocab.easy;
export const easyIds = () => [...easyById.keys()];
export const isEasy = (id) => easyById.has(id);

/** The topic's line icon (topic.icon is an icon name from ui/icons.js). */
export const topicIcon = (t, size = 20) => icon(t && hasIcon(t.icon) ? t.icon : 'book', { size, className: 'topic-ico' });

/** Dictionary in the shape GameRoom expects (used by same-device mode). */
export function dictionary() {
  const m = new Map();
  for (const w of [...byId.values(), ...easyById.values()]) m.set(w.id, { id: w.id, en: w.en, answers: [w.en, ...(w.alt || [])] });
  return m;
}

/**
 * <img> for a word's photo. Fallback chain: cached local copy -> original Wikimedia thumbnail ->
 * the word's other verified photos -> topic cover photo. Never an AI image or a placeholder.
 */
export function photo(w, { index = 0, className = '', alt } = {}) {
  const imgs = w.images || [];
  const chain = [];
  const order = [index, ...imgs.map((_, i) => i).filter((i) => i !== index)];
  for (const i of order) {
    const im = imgs[i];
    if (!im) continue;
    chain.push({ src: im.file, meta: im }, { src: im.remote, meta: im });
  }
  const t = topicById(w.topic);
  const cover = t && t.words[0] && t.words[0] !== w ? t.words[0].images[0] : null;
  if (cover) chain.push({ src: cover.file, meta: cover, isFallback: true });
  let k = 0;
  const img = h('img', { alt: alt ?? tr('Ảnh minh họa: {w}', { w: w.en }), loading: 'lazy', decoding: 'async', class: className, draggable: false });
  const apply = () => {
    const c = chain[k];
    img.src = c.src;
    img.dataset.credit = creditText(c.meta);
    img.dataset.fallback = c.isFallback ? '1' : '';
    img._meta = c.meta;
  };
  img.addEventListener('error', () => {
    if (++k < chain.length) apply();
  });
  if (chain.length) apply();
  return img;
}

export function creditText(im) {
  if (!im) return '';
  return `Ảnh: “${im.title}” – ${im.author} · ${im.license} · ${im.source}`;
}

/** Caption element with links to the source page and licence. */
export function credit(im, { short = false } = {}) {
  if (!im) return h('div.photo-credit');
  return h('div.photo-credit',
    tr('Ảnh thật: '), h('a', { href: im.page, target: '_blank', rel: 'noopener' }, short ? 'Wikimedia Commons' : im.title),
    ` – ${im.author} · `,
    im.licenseUrl ? h('a', { href: im.licenseUrl, target: '_blank', rel: 'noopener' }, im.license) : im.license);
}

/** Photo + credit that follows the actual image shown (after fallbacks). */
export function photoFigure(w, opts = {}) {
  const img = photo(w, opts);
  const box = h('div', h('div.photo-frame', img), credit(img._meta, opts));
  img.addEventListener('load', () => box.lastChild.replaceWith(credit(img._meta, opts)));
  return box;
}
