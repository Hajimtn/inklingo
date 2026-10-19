// "How scores work": every place in the app that gives points or ranks players, in a few short
// rows each ("what you do -> what you get"). The numbers come from the rules themselves, so the
// guide changes when a rule changes.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { tr } from '../i18n.js';
import { guesserPoints, comboBonus, ASSIST_MULT } from '../shared/game-core.js';
import { GROUP_POINTS as G } from '../shared/group-points.js';
import { MAX_POINTS as QUIZ_MAX, PASS_RATE as QUIZ_PASS } from '../shared/quiz-core.js';
import { MAX_POINTS as FAST_MAX, TOP_N, points as fastPoints } from '../shared/fast-core.js';
import { PASS_RATE } from '../vocab/progress.js';

const pct = (x) => Math.round(x * 100) + '%';

/** One card: title, then rows of [what you do, what you get], then an optional note. */
function part(id, ic, title, rows, note) {
  return h('section.score-part', { id: 'score-' + id },
    h('h3.with-ic', icon(ic, { size: 18 }), title),
    h('dl', rows.map(([what, pts]) => [h('dt', what), h('dd', pts)])),
    note ? h('p.small.muted', note) : null);
}

export function scoringGuide({ open } = {}) {
  const fastMin = fastPoints(5000, 1, true);
  const assistCut = `${pct(1 - ASSIST_MULT[2])}–${pct(1 - ASSIST_MULT[ASSIST_MULT.length - 1])}`;
  const parts = [
    part('draw', 'pencil', tr('Vẽ & đoán'), [
      [tr('Đoán đúng'), tr('{a}–{b} điểm, đoán càng sớm càng cao', { a: guesserPoints(0), b: guesserPoints(1) })],
      [tr('Đoán đúng nhiều lượt liền'), tr('+10 mỗi lượt (tối đa +{n})', { n: comboBonus(99) })],
      [tr('Người vẽ'), tr('½ điểm của những người đoán đúng; dùng trợ lý vẽ thì bớt {c}', { c: assistCut })],
    ]),
    part('group', 'users', tr('Bảng xếp hạng nhóm'), [
      [tr('Học hết từ trong ngày'), tr('{a} điểm, +{b} mỗi ngày học liên tiếp (tối đa +{c})', { a: G.learnDay, b: G.streakStep, c: G.streakStep * G.streakMax })],
      [tr('Mỗi từ nhớ đúng khi ôn'), tr('1 điểm (tối đa {n}/ngày)', { n: G.reviewCap })],
      [tr('Chơi phòng vẽ của nhóm'), tr('1 điểm cho mỗi 10 điểm trong trận (tối đa {n}/ngày)', { n: G.matchCap })],
      [tr('Mini-game cuối chủ đề'), tr('{p} điểm mini-game', { p: pct(G.quizScale) })],
    ], tr('“Nhớ %” dưới tên là tỷ lệ trả lời đúng, không cộng điểm. “Tuần này” tính từ Thứ Hai.')),
    part('quiz', 'trophy', tr('Mini-game nhóm'), [
      [tr('Trả lời đúng'), tr('{a}–{b} điểm, càng nhanh càng cao', { a: QUIZ_MAX / 2, b: QUIZ_MAX })],
      [tr('Sai hoặc hết giờ'), tr('0 điểm')],
    ], tr('Đúng từ {p} số câu là đạt; chưa đạt thì ôn lại từ sai.', { p: pct(QUIZ_PASS) })),
    part('fast', 'flame', tr('Học nhanh'), [
      [tr('Chọn đúng ngay lần đầu'), tr('{a}–{b} điểm: càng nhanh và đúng liên tiếp càng nhiều', { a: fastMin, b: FAST_MAX })],
      [tr('Chọn sai'), tr('0 điểm, mất chuỗi đúng liên tiếp')],
    ], tr('Bảng xếp hạng công khai: top {n} mỗi chủ đề, chế độ Nhanh.', { n: TOP_N })),
    part('recall', 'repeat', tr('Ôn tập & phát âm'), [
      [tr('Ôn tập (Word Recall)'), tr('Không có điểm, chỉ đếm số từ nhớ đúng')],
      [tr('Phát âm %'), tr('Máy nghe giống từ đúng bao nhiêu phần trăm')],
    ]),
    part('test', 'test', tr('Bài kiểm tra chủ đề'), [
      [tr('Đúng từ {p} số câu', { p: pct(PASS_RATE) }), tr('Mở chủ đề tiếp theo')],
    ]),
    part('stats', 'chart', tr('Thống kê'), [
      [tr('Tỷ lệ nhớ'), tr('% số lần bạn trả lời đúng')],
    ]),
  ];
  const guide = h('section.card.stack.score-guide', { id: 'scoring' },
    h('h2.with-ic', icon('help', { size: 20 }), tr('Cách tính điểm')),
    h('div.score-grid', parts));
  if (open) guide.querySelector('#score-' + open)?.classList.add('focus');
  return guide;
}
