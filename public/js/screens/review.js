// Review: flashcards made from the players' own drawings (fallback: the real photo).
// Shows the picture, asks for the English word, prioritises words that are often missed.

import { h, clear, speak, confirmDialog, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { speakBtn } from './learn.js';
import { word, photo, photoFigure } from '../vocab/data.js';
import { normalizeAnswer } from '../shared/game-core.js';
import { listDrawings, deleteDrawing } from '../store/drawings.js';
import * as P from '../vocab/progress.js';

export async function renderReview(root, mode) {
  const prof = P.active();
  const onlyNeeded = mode === 'need';
  // Drawings of words that are no longer in the word list (e.g. the old beginner set) are not shown.
  const drawings = (await listDrawings()).filter((d) => word(d.wordId));
  const latest = new Map();
  for (const d of drawings) if (!latest.has(d.wordId)) latest.set(d.wordId, d);
  const queue = P.reviewQueue(10, prof, onlyNeeded);

  const stage = h('section.card.stack');
  const side = h('aside.stack');
  clear(root).append(
    h('div.page-title', icon('repeat', { size: 28 }), onlyNeeded ? 'Ôn các từ chưa nhớ' : 'Ôn tập', P.isWeekend() ? h('span.tag.yellow', 'Ngày ôn tập cuối tuần') : null),
    h('div.review-grid', stage, side));

  if (prof.needReview.length) side.append(h('div.notice', icon('info', { size: 18 }), h('span', `${prof.needReview.length} từ cần ôn `, onlyNeeded ? null : h('a', { href: '#/review/need' }, 'Ôn ngay'))));
  side.append(gallery(drawings, () => renderReview(root, mode)));

  if (!queue.length) {
    stage.append(h('h2', onlyNeeded ? 'Đã ôn xong' : 'Chưa có từ để ôn'),
      h('div.row', h('a.btn.primary', { href: onlyNeeded ? '#/topics' : '#/daily' }, onlyNeeded ? [icon('test', { size: 18 }), 'Tới bài kiểm tra'] : [icon('calendar', { size: 18 }), 'Học từ hôm nay'])));
    return;
  }

  let k = 0;
  const results = [];
  const next = () => {
    if (k >= queue.length) return summary();
    const w = queue[k];
    const d = latest.get(w.id);
    const inp = h('input.answer-input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: 'Từ tiếng Anh là…', 'aria-label': 'Đáp án' });
    const hint = h('div.small.muted', { hidden: true }, `Nghĩa: ${w.vi} · ${w.en.length} chữ cái`);
    const feedback = h('div');
    const nextBtn = h('button.btn.primary', { hidden: true, onclick: () => { k++; next(); } }, k === queue.length - 1 ? 'Kết thúc' : ['Thẻ tiếp', icon('next', { size: 18 })]);
    const check = (e) => {
      e.preventDefault();
      if (inp.disabled || !inp.value.trim()) return;
      const ok = [w.en, ...w.alt].map(normalizeAnswer).includes(normalizeAnswer(inp.value));
      inp.disabled = true;
      inp.classList.add(ok ? 'right' : 'wrong');
      P.recordRecall(w.id, ok, 'review');
      results.push({ w, ok });
      feedback.replaceChildren(h('div.flashcard', { style: { marginTop: '8px' } },
        photoFigure(w, { short: true }),
        h('div.stack', h('div.notice.result' + (ok ? '.good' : '.bad'), icon(ok ? 'checkCircle' : 'xCircle', { size: 22 }), h('span', ok ? 'Nhớ rồi!' : 'Chưa nhớ')),
          h('div.row.word-head', h('div.word-big', { style: { fontSize: '34px' } }, w.en), speakBtn(w.en)),
          h('div.ipa', w.ipa), h('div.meaning', w.vi), h('div.example', h('div', w.ex[0]), h('div.vi', w.ex[1])))));
      speak(w.en);
      nextBtn.hidden = false;
      nextBtn.focus();
    };
    clear(stage).append(
      h('div.row.between', h('b', `Thẻ ${k + 1}/${queue.length}`), h('span.small.muted', d ? `Tranh của ${d.drawer}` : '')),
      h('div.bar', h('i', { style: { width: (k / queue.length) * 100 + '%' } })),
      d ? h('div.drawing-frame', h('img', { src: d.dataUrl, alt: 'Tranh vẽ để đoán' })) : h('div.photo-frame', { style: { maxWidth: '520px', margin: '0 auto', width: '100%' } }, photo(w, { alt: 'Ảnh để đoán' })),
      h('form.stack', { onsubmit: check }, h('p', { style: { margin: 0, fontWeight: 800 } }, 'Đây là từ gì?'), inp,
        h('div.row', h('button.btn.primary', { type: 'submit' }, 'Kiểm tra'), h('button.btn.small', { type: 'button', onclick: () => (hint.hidden = false) }, icon('bulb', { size: 16 }), 'Gợi ý'), hint)),
      feedback, h('div.row', { style: { justifyContent: 'flex-end' } }, nextBtn));
    setTimeout(() => inp.focus(), 50);
  };
  const summary = () => {
    const ok = results.filter((r) => r.ok).length;
    clear(stage).append(h('div.big-score', `${ok}/${results.length}`),
      h('div.today-mini', results.map((r) => h('button.mini-word', { onclick: () => speak(r.w.en) }, photo(r.w), h('span.with-ic', icon(r.ok ? 'checkCircle' : 'xCircle', { size: 14, className: r.ok ? 'ok' : 'bad' }), r.w.en), h('small', r.w.vi)))),
      h('div.row', h('button.btn.primary', { onclick: () => renderReview(root, mode) }, icon('repeat', { size: 18 }), 'Ôn tiếp'),
        onlyNeeded && !P.active().needReview.length ? h('a.btn.green', { href: '#/topics' }, icon('test', { size: 18 }), 'Làm lại bài kiểm tra') : null,
        h('a.btn', { href: '#/' }, 'Trang chủ')));
  };
  stage.append(h('h2', `${queue.length} thẻ`),
    h('div.row', h('button.btn.primary.big', { onclick: next }, icon('play', { size: 20 }), 'Bắt đầu ôn')));
}

function gallery(drawings, refresh) {
  const box = h('div.card.stack', h('h3.with-ic', icon('image', { size: 16 }), 'Tranh đã lưu'));
  if (!drawings.length) {
    box.append(h('p.small.muted', 'Chưa có tranh'));
    return box;
  }
  box.append(h('div.gallery', drawings.slice(0, 40).map((d) => {
    const w = word(d.wordId);
    return h('figure', h('img', { src: d.dataUrl, alt: w ? w.en : d.wordId }),
      h('figcaption', h('span', w ? w.en : d.wordId),
        h('button', { type: 'button', title: 'Xóa tranh', 'aria-label': 'Xóa tranh', class: 'icon-plain', onclick: async () => {
          if (await confirmDialog('Xóa tranh này?', 'Thẻ ôn tập từ tranh này sẽ mất.', 'Xóa', true)) { await deleteDrawing(d.id); toast('Đã xóa tranh'); refresh(); }
        } }, icon('trash', { size: 16 }))));
  })));
  return box;
}
