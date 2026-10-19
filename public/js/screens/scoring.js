// "How scores work": every place in the app that gives points or ranks players, explained with
// the numbers taken from the rules themselves (so the guide changes when a rule changes).

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { tr } from '../i18n.js';
import { guesserPoints, comboBonus, ASSIST_MULT, ASSIST_NAMES, HINT_AT } from '../shared/game-core.js';
import { GROUP_POINTS as G } from '../shared/group-points.js';
import { ROUNDS, MAX_POINTS as QUIZ_MAX, PASS_RATE as QUIZ_PASS } from '../shared/quiz-core.js';
import { MAX_POINTS as FAST_MAX, QUESTIONS as FAST_Q, TIME, TOP_N, points as fastPoints } from '../shared/fast-core.js';
import { PASS_RATE, RECALL_GAPS, MASTERED_STEP } from '../vocab/progress.js';

const pct = (x) => Math.round(x * 100) + '%';
const sec = (ms) => Math.round(ms / 1000);

/** One topic of the guide: where it shows, then the rules as a list. */
function part(id, ic, title, where, rules, example) {
  return h('details.score-part', { id: 'score-' + id },
    h('summary', h('span.with-ic', icon(ic, { size: 18 }), h('b', title)), h('small.muted', where)),
    h('ul', rules.map((r) => h('li', r))),
    example ? h('p.score-example', icon('info', { size: 15 }), h('span', example)) : null);
}

export function scoringGuide({ open } = {}) {
  const maxCombo = comboBonus(99);
  const assist = ASSIST_MULT.slice(1).map((m, i) => `${tr(ASSIST_NAMES[i + 1])} ${pct(m)}`).join(' · ');
  const streakMaxPts = G.streakStep * G.streakMax;
  const fastEx = fastPoints(1000, 3, true);
  const gaps = RECALL_GAPS.slice(0, MASTERED_STEP).reduce((acc, g) => [...acc, (acc.at(-1) || 0) + g], []);

  const parts = [
    part('draw', 'pencil', tr('Vẽ & đoán'), tr('Điểm trong phòng vẽ, xếp hạng cuối trận'), [
      tr('Người đoán đúng: {min} + {span} × (thời gian còn lại ÷ thời gian vẽ), tức {min}–{max} điểm. Đoán càng sớm càng nhiều điểm.', { min: guesserPoints(0), span: guesserPoints(1) - guesserPoints(0), max: guesserPoints(1) }),
      tr('Combo: đoán đúng nhiều lượt liền nhau được thêm 10 điểm cho mỗi lượt từ lượt thứ 2, tối đa +{max}. Có mặt mà không đoán ra một lượt thì mất combo.', { max: maxCombo }),
      tr('Người vẽ: 50% tổng điểm gốc (không tính combo) của những người đoán đúng, nhân với hệ số của cấp trợ lý cao nhất đã dùng: {list}. Bỏ qua lượt hoặc rời phòng: 0 điểm.', { list: assist }),
      tr('Gợi ý chữ cái (ở {a}, {b} và {c} thời gian vẽ khi chưa ai đoán ra) không trừ điểm ai.', { a: pct(HINT_AT[0]), b: pct(HINT_AT[1]), c: pct(HINT_AT[2]) }),
      tr('Xếp hạng cuối trận theo tổng điểm; bằng điểm thì cùng hạng.'),
    ], tr('Ví dụ: vẽ 80 giây, bạn đoán đúng lúc còn 40 giây → {p} điểm; đang combo 3 lượt → thêm {b}.', { p: guesserPoints(0.5), b: comboBonus(3) })),

    part('group', 'users', tr('Bảng xếp hạng nhóm'), tr('Trang Nhóm: “Tuần này” và “Tổng”'), [
      tr('Mở hết từ của ngày: {base} điểm + {step} cho mỗi ngày học liên tiếp trước đó (tối đa +{max}).', { base: G.learnDay, step: G.streakStep, max: streakMaxPts }),
      tr('Word Recall: 1 điểm cho mỗi từ nhớ đúng (kiểm tra từ ngày hôm sau trở đi), tối đa {cap} điểm/ngày.', { cap: G.reviewCap }),
      tr('Phòng vẽ mở từ trang Nhóm: điểm trong trận ÷ 10, tối đa {cap} điểm/ngày.', { cap: G.matchCap }),
      tr('Mini-game cuối chủ đề: điểm mini-game × {k}. Đây là phần điểm lớn nhất.', { k: String(G.quizScale).replace('.', ',') }),
      tr('“Tuần này” tính từ Thứ Hai; “Tổng” là từ lúc vào nhóm. Bằng điểm thì xếp theo tên.'),
      tr('“Nhớ %” dưới tên = số lần trả lời đúng ÷ tổng số lần trả lời (Word Recall, đoán trong phòng vẽ, mini-game). Chỉ để xem, không cộng điểm.'),
    ], tr('Ví dụ: hôm nay mở hết 5 từ (ngày đầu) được {a}, chơi phòng vẽ của nhóm được 350 điểm → +{b}. Tổng {c}.', { a: G.learnDay, b: G.matchCap, c: G.learnDay + G.matchCap })),

    part('quiz', 'trophy', tr('Mini-game nhóm'), tr('Cuối mỗi chủ đề, mở trong 48 giờ'), [
      tr('Mỗi từ của chủ đề là một câu, chia 4 vòng: nhìn ảnh ({a}s), nghe & gõ ({b}s), điền câu ({c}s), nghĩa → từ ({d}s).', { a: sec(ROUNDS[0].limit), b: sec(ROUNDS[1].limit), c: sec(ROUNDS[2].limit), d: sec(ROUNDS[3].limit) }),
      tr('Trả lời đúng: 50 + 50 × (thời gian còn lại ÷ thời gian của câu), tức 50–{max} điểm. Sai hoặc hết giờ: 0.', { max: QUIZ_MAX }),
      tr('Đạt khi đúng từ {p} số câu trở lên. Dưới {p} hoặc không chơi thì phải ôn bù những từ sai.', { p: pct(QUIZ_PASS) }),
      tr('Bảng kết quả xếp theo điểm mini-game; điểm này × {k} được cộng vào bảng xếp hạng nhóm.', { k: String(G.quizScale).replace('.', ',') }),
    ]),

    part('fast', 'flame', tr('Học nhanh'), tr('Điểm mỗi lượt, kỷ lục và bảng xếp hạng công khai'), [
      tr('Chỉ lần chọn đầu tiên của câu mới có điểm: 100 + tốc độ (tối đa 100, trả lời trong 5 giây, càng nhanh càng nhiều) + chuỗi (10 × số câu đúng liên tiếp − 10, tối đa +100). Tối đa {max} điểm/câu.', { max: FAST_MAX }),
      tr('Chọn sai: đáp án đó mờ đi, câu đó còn 0 điểm và chuỗi về 0. Từ chọn sai sẽ được hỏi lại sớm hơn.'),
      tr('Chế độ Nhanh: thanh thời gian cạn dần (nhanh hơn theo số câu); đúng ngay lần đầu nạp lại {a}, đúng sau khi chọn sai nạp {b}. Cạn thanh là hết lượt.', { a: pct(TIME.refillFirst), b: pct(TIME.refillRetry) }),
      tr('Kỷ lục cá nhân lưu riêng cho từng chế độ và từng chủ đề (hoặc “Từ hôm nay”).'),
      tr('Bảng xếp hạng công khai: chỉ chế độ Nhanh theo chủ đề ({q} câu), giữ top {n}. Bằng điểm thì ai đạt trước xếp trên. Bạn tự chọn có gửi điểm hay không.', { q: FAST_Q, n: TOP_N }),
    ], tr('Ví dụ: đúng ngay trong 1 giây, đang chuỗi 3 câu → {p} điểm.', { p: fastEx })),

    part('recall', 'repeat', tr('Ôn tập (Word Recall) & phát âm'), tr('Không có điểm, chỉ đếm từ nhớ đúng'), [
      tr('Mỗi từ được kiểm tra lại vào ngày {days} sau khi học (đúng thì giãn lịch); sai thì quay lại ngày mai và lùi 2 bậc. Qua bậc cuối là “Đã thuộc”.', { days: gaps.join(', ') }),
      tr('“Tỷ lệ nhớ” = số câu đúng ÷ số câu, tách theo dạng câu; “Sau ≥ 7 ngày” chỉ tính các lần kiểm tra cách lần trước từ 7 ngày.'),
      tr('Bảng “Tuần này” (khi ở nhóm học): số từ mỗi người nhớ đúng trong Word Recall từ Thứ Hai.'),
      tr('Điểm phát âm (%) = độ giống từng chữ cái giữa từ đúng và từ máy nghe được × độ tự tin của máy nhận dạng (×0,9 nếu chỉ khớp phương án thứ 2–3). Tính là đúng khi một trong 3 phương án máy nghe là đáp án.'),
    ]),

    part('test', 'test', tr('Bài kiểm tra chủ đề'), tr('Mở khóa chủ đề tiếp theo'), [
      tr('Điểm = số câu đúng ÷ số câu, mỗi từ của chủ đề một câu.'),
      tr('Từ {p} trở lên: mở chủ đề tiếp. Dưới {p}: phải ôn lại các từ sai rồi thi lại.', { p: pct(PASS_RATE) }),
    ]),

    part('stats', 'chart', tr('Thống kê'), tr('Tỷ lệ nhớ chung và từ yếu'), [
      tr('Tỷ lệ nhớ chung = số lần đúng ÷ tổng số lần trả lời khi đoán trong phòng vẽ, ôn tập, Word Recall và bài kiểm tra.'),
      tr('“Từ hay quên” là những từ có tỷ lệ đúng thấp nhất (tính riêng từng từ).'),
    ]),
  ];
  if (open) parts.find((p) => p.id === 'score-' + open)?.setAttribute('open', '');
  return h('section.card.stack.score-guide', { id: 'scoring' },
    h('h2.with-ic', icon('help', { size: 20 }), tr('Cách tính điểm')),
    h('p.small.muted', tr('Mọi chỗ trong app có điểm hoặc xếp hạng. Bấm vào từng mục để xem công thức.')),
    ...parts);
}
