// Statistics (per profile, from the local learning history) and a short help page.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { topics, topicById, photo, topicIcon } from '../vocab/data.js';
import { listDrawings } from '../store/drawings.js';
import * as P from '../vocab/progress.js';

const STATUS = {
  passed: ['Hoàn thành', 'green'],
  learning: ['Đang học', 'yellow'],
  'test-ready': ['Kiểm tra', 'blue'],
  'review-needed': ['Cần ôn', 'red'],
  'group-quiz': ['Mini-game', 'blue'],
  locked: ['Chưa mở', ''],
};

export async function renderStats(root) {
  const prof = P.active();
  const ret = P.retention();
  const drawings = (await listDrawings()).length;
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
    h('div.page-head', h('h1.page-title', 'Thống kê'), h('span.tag.blue', prof.name)),
    h('div.kpi-grid',
      tile('m-red', 'cards', P.learnedWords().length, 'từ đã học'),
      tile('m-green', 'checkCircle', ret === null ? '–' : Math.round(ret * 100) + '%', 'tỷ lệ nhớ'),
      tile('m-orange', 'flame', P.studyStreak(prof), 'ngày liên tiếp'),
      tile('m-blue', 'repeat', P.inReview(prof), 'đang ôn'),
      tile('m-purple', 'image', drawings, 'tranh đã lưu')),
    h('div.stats-grid',
      h('section.card.side-card', h('div.section-head', h('h2', 'Chủ đề'), h('span.small.muted', 'Điểm kiểm tra')), h('ol.tlist', topicRows)),
      h('div.stack',
        h('section.card.side-card', h('div.section-head', h('h2', 'Từ hay quên')),
          weak.length ? h('ul.vlist', weak.map(({ w, r }) => h('li.vrow', { tabindex: 0, onclick: () => (location.hash = '#/word/' + w.id), onkeydown: (e) => e.key === 'Enter' && (location.hash = '#/word/' + w.id) },
            photo(w, { className: 'vrow-img', alt: '' }), h('div.vrow-text', h('b', { lang: 'en' }, w.en), h('small', w.vi)), h('span.pct' + (r < 0.5 ? '.low' : ''), Math.round(r * 100) + '%'))))
            : h('div.side-empty', icon('info', { size: 22 }), h('span', 'Chưa có dữ liệu – hãy ôn tập vài lượt'))),
        h('section.card.side-card', h('div.section-head', h('h2', 'Bài kiểm tra')),
          tests.length ? h('ul.plain-list', tests.map((x) => h('li', h('span', topicById(x.id)?.title || x.id), h('span.small.muted', x.date), h('b' + (x.score >= P.PASS_RATE ? '.ok' : '.bad'), Math.round(x.score * 100) + '%'))))
            : h('div.side-empty', icon('test', { size: 22 }), h('span', 'Chưa làm bài kiểm tra nào'))))));
}

export function renderHelp(root) {
  const card = (cls, ic, title, ...lines) => h('section.card.help-card', h('span.qtile-ic.' + cls, icon(ic, { size: 24 })), h('h2', title), h('ul', lines.map((l) => h('li', l))));
  const keys = [['B', 'Bút'], ['E', 'Tẩy'], ['F', 'Đổ màu'], ['I', 'Hút màu'], ['L / R / O', 'Đường, chữ nhật, elip'], ['[ ]', 'Cỡ bút'], ['Ctrl Z / Y', 'Hoàn tác / làm lại'], ['Ctrl K', 'Tìm kiếm'], ['← →', 'Chuyển từ']];
  clear(root).append(
    h('div.page-head', h('h1.page-title', 'Trợ giúp')),
    h('div.help-grid',
      card('q-green', 'calendar', 'Học mỗi ngày', '5 từ mới Thứ Hai – Thứ Sáu', 'Cuối tuần: ôn tập', 'Hết chủ đề → kiểm tra ≥ 80%'),
      card('q-red', 'pencil', 'Vẽ & đoán', 'Người vẽ nhận từ bí mật', 'Người khác gõ đáp án tiếng Anh', 'Đoán càng nhanh càng nhiều điểm'),
      card('q-yellow', 'bulb', 'Trợ lý vẽ', '4 cấp gợi ý + Ghost Sketch', 'Dùng cấp cao → điểm tối đa giảm', 'Ghost chỉ người vẽ thấy'),
      card('q-blue', 'users', 'Nhóm học', 'Cả nhóm cùng 5 từ mỗi ngày', 'Mini-game cuối chủ đề trong 48 giờ', 'Dưới 80% → ôn bù'),
      h('section.card.help-card.keys', h('span.qtile-ic.q-purple', icon('settings', { size: 24 })), h('h2', 'Phím tắt'),
        h('dl', keys.map(([k, v]) => [h('dt', h('kbd', k)), h('dd', v)])))));
}
