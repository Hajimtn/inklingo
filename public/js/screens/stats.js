// Statistics (per profile, from the local learning history) and a short help page.

import { h, clear, confirmDialog, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { topics, topicById, photo, topicIcon, word } from '../vocab/data.js';
import { listDrawings, deleteDrawing } from '../store/drawings.js';
import * as P from '../vocab/progress.js';

import { tr } from '../i18n.js';
const STATUS = {
  passed: [tr('Hoàn thành'), 'green'],
  learning: [tr('Đang học'), 'yellow'],
  'test-ready': [tr('Kiểm tra'), 'blue'],
  'review-needed': [tr('Cần ôn'), 'red'],
  'group-quiz': ['Mini-game', 'blue'],
  locked: [tr('Chưa mở'), ''],
};

export async function renderStats(root) {
  const prof = P.active();
  const ret = P.retention();
  // Drawings of words that are no longer in the word list (e.g. the old beginner set) are not shown.
  const saved = (await listDrawings()).filter((d) => word(d.wordId));
  const drawings = saved.length;
  const tile = (cls, ic, value, label) => h('div.kpi.' + cls, h('span.kpi-ic', icon(ic, { size: 22 })), h('div', h('b', value), h('small', label)));

  const topicRows = topics().map((t, i) => {
    const st = P.topicStatus(i);
    const [label, color] = STATUS[st] || STATUS.locked;
    const n = P.introducedIn(t).length;
    const tests = prof.tests[t.id] || [];
    const best = tests.length ? Math.max(...tests.map((x) => x.score)) : null;
    return h('li.trow' + (st === 'locked' ? '.locked' : ''),
      h('span.trow-ic', topicIcon(t, 18)),
      h('div.trow-main', h('div.row.between', h('b', t.title), h('span.small.muted', `${n}/${t.words.length}`)), h('div.bar', h('i', { style: { width: (n / t.words.length) * 100 + '%' } }))),
      h('span.tag' + (color ? '.' + color : ''), label),
      h('span.trow-score', best === null ? '–' : Math.round(best * 100) + '%'));
  });

  const weak = P.learnedWords().map((w) => ({ w, r: P.wordRetention(w.id, prof) })).filter((x) => x.r !== null).sort((a, b) => a.r - b.r).slice(0, 8);
  const tests = Object.entries(prof.tests).flatMap(([id, list]) => list.map((x) => ({ ...x, id }))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);

  clear(root).append(
    h('div.page-head', h('h1.page-title', tr('Thống kê')), h('span.tag.blue', prof.name)),
    h('div.kpi-grid',
      tile('m-red', 'cards', P.learnedWords().length, tr('từ đã học')),
      tile('m-green', 'checkCircle', ret === null ? '–' : Math.round(ret * 100) + '%', tr('tỷ lệ nhớ')),
      tile('m-orange', 'flame', P.studyStreak(prof), tr('ngày liên tiếp')),
      tile('m-blue', 'repeat', P.inReview(prof), tr('đang ôn')),
      tile('m-purple', 'image', drawings, tr('tranh đã lưu'))),
    h('div.stats-grid',
      h('section.card.side-card', h('div.section-head', h('h2', tr('Chủ đề')), h('span.small.muted', tr('Điểm kiểm tra'))), h('ol.tlist', topicRows)),
      h('div.stack',
        h('section.card.side-card', h('div.section-head', h('h2', tr('Từ hay quên'))),
          weak.length ? h('ul.vlist', weak.map(({ w, r }) => h('li.vrow', { tabindex: 0, onclick: () => (location.hash = '#/word/' + w.id), onkeydown: (e) => e.key === 'Enter' && (location.hash = '#/word/' + w.id) },
            photo(w, { className: 'vrow-img', alt: '' }), h('div.vrow-text', h('b', { lang: 'en' }, w.en), h('small', w.vi)), h('span.pct' + (r < 0.5 ? '.low' : ''), Math.round(r * 100) + '%'))))
            : h('div.side-empty', icon('info', { size: 22 }), h('span', tr('Chưa có dữ liệu – hãy ôn tập vài lượt')))),
        h('section.card.side-card', h('div.section-head', h('h2', tr('Bài kiểm tra'))),
          tests.length ? h('ul.plain-list', tests.map((x) => h('li', h('span', topicById(x.id)?.title || x.id), h('span.small.muted', x.date), h('b' + (x.score >= P.PASS_RATE ? '.ok' : '.bad'), Math.round(x.score * 100) + '%'))))
            : h('div.side-empty', icon('test', { size: 22 }), h('span', tr('Chưa làm bài kiểm tra nào')))))),
    saved.length ? gallery(saved, () => renderStats(root)) : null);
}

function gallery(drawings, refresh) {
  return h('section.card.side-card.stats-gallery', h('div.section-head', h('h2', tr('Tranh đã lưu')), h('span.small.muted', drawings.length)),
    h('div.gallery', drawings.slice(0, 40).map((d) => {
      const w = word(d.wordId);
      return h('figure', h('img', { src: d.dataUrl, alt: w.en }),
        h('figcaption', h('span', w.en),
          h('button', { type: 'button', title: tr('Xóa tranh'), 'aria-label': tr('Xóa tranh'), class: 'icon-plain', onclick: async () => {
            if (await confirmDialog(tr('Xóa tranh này?'), tr('Tranh sẽ bị xóa khỏi máy này.'), tr('Xóa'), true)) { await deleteDrawing(d.id); toast(tr('Đã xóa tranh')); refresh(); }
          } }, icon('trash', { size: 16 }))));
    })));
}

export function renderHelp(root) {
  const card = (cls, ic, title, ...lines) => h('section.card.help-card', h('span.qtile-ic.' + cls, icon(ic, { size: 24 })), h('h2', title), h('ul', lines.map((l) => h('li', l))));
  const keys = [['B', tr('Bút')], ['E', tr('Tẩy')], ['F', tr('Đổ màu')], ['I', tr('Hút màu')], ['L / R / O', tr('Đường, chữ nhật, elip')], ['[ ]', tr('Cỡ bút')], ['Ctrl Z / Y', tr('Hoàn tác / làm lại')], ['Ctrl K', tr('Tìm kiếm')], ['← →', tr('Chuyển từ')]];
  clear(root).append(
    h('div.page-head', h('h1.page-title', tr('Trợ giúp'))),
    h('div.help-grid',
      card('q-green', 'calendar', tr('Học mỗi ngày'), tr('5 từ mới Thứ Hai – Thứ Sáu'), tr('Cuối tuần: ôn tập'), tr('Hết chủ đề → kiểm tra ≥ 80%')),
      card('q-red', 'pencil', tr('Vẽ & đoán'), tr('Người vẽ nhận từ bí mật'), tr('Người khác gõ đáp án tiếng Anh'), tr('Đoán càng nhanh càng nhiều điểm')),
      card('q-yellow', 'bulb', tr('Trợ lý vẽ'), tr('4 cấp gợi ý + Ghost Sketch'), tr('Dùng cấp cao → điểm tối đa giảm'), tr('Ghost chỉ người vẽ thấy')),
      card('q-blue', 'users', tr('Nhóm học'), tr('Cả nhóm cùng 5 từ mỗi ngày'), tr('Mini-game cuối chủ đề trong 48 giờ'), tr('Dưới 80% → ôn bù')),
      h('section.card.help-card.keys', h('span.qtile-ic.q-purple', icon('settings', { size: 24 })), h('h2', tr('Phím tắt')),
        h('dl', keys.map(([k, v]) => [h('dt', h('kbd', k)), h('dd', v)])))));
}
