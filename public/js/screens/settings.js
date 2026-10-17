// Game settings of this device: appearance, language, voice. (Profile things are in account.js.)

import { h, clear, toast, speak, englishVoices } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { allWords } from '../vocab/data.js';
import { tr, LANGS } from '../i18n.js';
import * as prefs from '../ui/prefs.js';
import * as P from '../vocab/progress.js';

/** Row of toggle buttons; onPick(value) is called with the chosen value. */
function segmented(label, value, options, onPick) {
  const wrap = h('div.seg', { role: 'radiogroup', 'aria-label': label });
  const draw = (cur) => clear(wrap).append(...options.map(([v, text, ic]) => h('button.seg-btn' + (v === cur ? '.on' : ''), {
    type: 'button', role: 'radio', 'aria-checked': String(v === cur), onclick: () => { draw(v); onPick(v); },
  }, ic ? icon(ic, { size: 16 }) : null, text)));
  draw(value);
  return wrap;
}

const row = (label, control, hint) => h('div.set-row', h('div.set-label', h('b', label), hint ? h('small.muted', hint) : null), control);

export function renderSettings(root, rerender) {
  const again = () => renderSettings(root, rerender);
  const st = P.settings();

  const theme = segmented(tr('Giao diện'), prefs.get('theme'), [['light', tr('Sáng'), 'sun'], ['dark', tr('Tối'), 'moon'], ['system', tr('Theo hệ thống')]], (v) => prefs.set('theme', v));
  const font = segmented(tr('Cỡ chữ'), prefs.get('font'), [['s', tr('Nhỏ')], ['m', tr('Vừa')], ['l', tr('Lớn')]], (v) => prefs.set('font', v));
  const motion = segmented(tr('Hiệu ứng chuyển động'), prefs.get('motion'), [['full', tr('Bật')], ['reduced', tr('Giảm')]], (v) => prefs.set('motion', v));
  // Labels built when a module loads are in the old language: reload (state and page are kept).
  const lang = segmented(tr('Ngôn ngữ'), prefs.get('lang'), LANGS, (v) => { prefs.set('lang', v); location.reload(); });

  const voiceSel = h('select.input.set-select', { 'aria-label': tr('Giọng đọc'), onchange: (e) => { prefs.set('voice', e.target.value); speak('Hello, nice to meet you'); } });
  const fillVoices = () => {
    const vs = englishVoices();
    clear(voiceSel).append(h('option', { value: '' }, tr('Tự chọn (tiếng Anh Mỹ)')),
      ...vs.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === prefs.get('voice') }, `${v.name} · ${v.lang}`)));
    voiceSel.disabled = !vs.length;
  };
  fillVoices();
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', fillVoices, { once: true });
  const rateLabel = h('span.set-val', Math.round(prefs.get('rate') * 100) + '%');
  const rate = h('input.set-range', { type: 'range', min: 50, max: 120, step: 5, value: Math.round(prefs.get('rate') * 100), 'aria-label': tr('Tốc độ đọc'),
    oninput: (e) => { rateLabel.textContent = e.target.value + '%'; }, onchange: (e) => { prefs.set('rate', e.target.value / 100); speak('Hello, nice to meet you'); } });
  const auto = segmented(tr('Tự đọc từ'), prefs.get('autoSpeak') ? 'on' : 'off', [['on', tr('Bật')], ['off', tr('Tắt')]], (v) => prefs.set('autoSpeak', v === 'on'));

  const sim = h('input.input', { type: 'date', value: st.simDate || '', style: { width: '180px' }, 'aria-label': tr('Ngày giả lập') });

  clear(root).append(
    h('div.page-head', h('h1.page-title', tr('Cài đặt')), h('a.btn.small', { href: '#/account' }, icon('user', { size: 16 }), tr('Tài khoản'))),
    h('div.grid2',
      h('div.stack',
        h('section.card.stack', h('h2', tr('Giao diện')),
          row(tr('Chủ đề màu'), theme),
          row(tr('Cỡ chữ'), font),
          row(tr('Hiệu ứng chuyển động'), motion, tr('Giảm hiệu ứng nếu bạn dễ chóng mặt'))),
        h('section.card.stack', h('h2', tr('Ngôn ngữ')),
          row(tr('Ngôn ngữ giao diện'), lang, tr('Nghĩa và giải thích của từ vựng vẫn bằng tiếng Việt')))),
      h('div.stack',
        h('section.card.stack', h('h2', tr('Giọng đọc')),
          'speechSynthesis' in window
            ? [row(tr('Giọng'), voiceSel),
              row(tr('Tốc độ đọc'), h('div.row.set-rate', rate, rateLabel)),
              row(tr('Tự đọc từ'), auto, tr('Đọc từ khi hiện đáp án')),
              h('div.row', h('button.btn.small', { onclick: () => speak('Hello, nice to meet you') }, icon('volume', { size: 16 }), tr('Nghe thử')))]
            : h('p.small.muted', tr('Trình duyệt này không hỗ trợ đọc văn bản'))),
        h('section.card.stack', h('h2', tr('Nguồn ảnh')),
          h('div.row', h('a.btn', { href: '#/credits' }, icon('camera', { size: 18 }), tr('Tác giả & giấy phép')))),
        h('details.card.set-dev',
          h('summary', h('b', tr('Kiểm thử: ngày giả lập'))),
          h('p.small', h('b', `${P.DAY_NAMES[P.weekday()]} ${P.today()}`)),
          h('div.row', sim,
            h('button.btn.small', { onclick: () => { P.setSetting('simDate', sim.value || null); toast(sim.value ? tr('Đã đặt ngày giả lập') : tr('Dùng ngày thật')); again(); } }, tr('Áp dụng')),
            h('button.btn.small', { onclick: () => { P.setSetting('simDate', P.addDays(P.today(), 1)); toast(tr('Chuyển sang ngày {d}', { d: P.today() })); again(); } }, tr('+1 ngày')),
            h('button.btn.small', { onclick: () => { P.setSetting('simDate', null); again(); } }, tr('Ngày thật')))))));
}

export function renderCredits(root) {
  const words = allWords();
  const rows = [];
  for (const w of words) for (const im of w.images) rows.push({ w, im });
  clear(root).append(
    h('a.back-link', { href: '#/settings' }, icon('back', { size: 16 }), tr('Cài đặt')),
    h('div.page-title', icon('camera', { size: 28 }), tr('Nguồn ảnh & giấy phép'), h('span.tag.yellow', tr('{i} ảnh · {w} từ', { i: rows.length, w: words.length }))),
    h('div.card.stack',
      h('p.small.muted', tr('Ảnh chụp thật từ Wikimedia Commons · CC0 / PD / CC BY / CC BY-SA')),
      h('div', { style: { overflowX: 'auto' } }, h('table.credits-table',
        h('thead', h('tr', h('th', tr('Ảnh')), h('th', tr('Từ')), h('th', tr('Tệp gốc')), h('th', tr('Tác giả')), h('th', tr('Giấy phép')))),
        h('tbody', rows.map(({ w, im }) => h('tr',
          h('td', h('img', { src: im.file, alt: w.en, loading: 'lazy' })),
          h('td', h('b', w.en), h('div.small.muted', w.vi)),
          h('td', h('a', { href: im.page, target: '_blank', rel: 'noopener' }, im.title)),
          h('td', im.author),
          h('td', im.licenseUrl ? h('a', { href: im.licenseUrl, target: '_blank', rel: 'noopener' }, im.license) : im.license))))))));
}
