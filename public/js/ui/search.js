// Top-bar search: words (English or Vietnamese, accents optional) and topics. ⌘K / Ctrl+K focuses it.
// Words the profile has not been given yet are listed but locked, so the daily schedule stays intact.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { allWords, topics, photo, topicIcon } from '../vocab/data.js';
import * as P from '../vocab/progress.js';

import { tr } from '../i18n.js';
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function mountSearch(host) {
  const input = h('input.search-input', { type: 'search', placeholder: tr('Tìm từ vựng, chủ đề…'), autocomplete: 'off', spellcheck: false, 'aria-label': tr('Tìm kiếm'), role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-results' });
  const panel = h('div.search-panel#search-results', { role: 'listbox', hidden: true });
  const toggle = h('button.icon-plain.search-toggle', { type: 'button', 'aria-label': tr('Tìm kiếm'), title: tr('Tìm kiếm'), onclick: () => { host.classList.add('open'); input.focus(); } }, icon('search', { size: 20 }));
  let items = [];
  let sel = -1;

  const close = () => {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    host.classList.remove('open');
  };
  const go = (it) => {
    if (!it || it.locked) return;
    location.hash = it.href;
    input.value = '';
    input.blur();
    close();
  };
  const mark = () => items.forEach((it, i) => it.el.classList.toggle('sel', i === sel));

  const run = () => {
    const q = fold(input.value);
    clear(panel);
    items = [];
    sel = -1;
    if (!q) return close();
    const prof = P.active();
    const ts = topics().filter((t) => fold(t.title).includes(q) || fold(t.vi).includes(q)).slice(0, 3)
      .map((t) => ({ href: '#/topics', el: h('div.sr', { role: 'option' }, h('span.sr-ic', topicIcon(t, 18)), h('span.sr-text', h('b', t.title), h('small', tr('Chủ đề')))) }));
    const score = (w) => (fold(w.en).startsWith(q) ? 0 : fold(w.vi).startsWith(q) ? 1 : 2);
    const ws = allWords().filter((w) => fold(w.en).includes(q) || fold(w.vi).includes(q)).sort((a, b) => score(a) - score(b) || a.en.localeCompare(b.en)).slice(0, 7)
      .map((w) => {
        const locked = !prof.introduced[w.id];
        return { href: '#/word/' + w.id, locked, el: h('div.sr' + (locked ? '.locked' : ''), { role: 'option', 'aria-disabled': locked ? 'true' : null },
          locked ? h('span.sr-ic', icon('lock', { size: 16 })) : photo(w, { className: 'sr-img', alt: '' }),
          h('span.sr-text', h('b', { lang: 'en' }, w.en), h('small', locked ? tr('Chưa học') : w.vi))) };
      });
    items = [...ts, ...ws];
    if (!items.length) panel.append(h('div.sr-empty', tr('Không tìm thấy')));
    items.forEach((it, i) => {
      it.el.addEventListener('mousedown', (e) => e.preventDefault());
      it.el.addEventListener('click', () => go(it));
      it.el.addEventListener('mousemove', () => { sel = i; mark(); });
      panel.append(it.el);
    });
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', run);
  input.addEventListener('focus', () => input.value && run());
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); sel = (sel + 1) % items.length; mark(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[sel] || items.find((it) => !it.locked)); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      host.classList.add('open');
      input.focus();
      input.select();
    }
  });

  clear(host).append(toggle, h('label.search-box', icon('search', { size: 18 }), input, h('kbd', isMac ? '⌘K' : 'Ctrl K')), panel);
}
