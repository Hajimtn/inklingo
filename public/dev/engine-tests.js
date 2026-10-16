// In-browser behaviour tests for the drawing engine. They drive the real pointer/keyboard
// handlers with dispatched events and then inspect the document pixels.
// Usage (on /dev/draw-test.html):  const m = await import('/dev/engine-tests.js'); await m.run(T)

import { DOC_W, DOC_H } from '/js/drawing/engine.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(engine, x, y) {
  const r = engine.view.getBoundingClientRect();
  return { clientX: r.left + (x / DOC_W) * r.width, clientY: r.top + (y / DOC_H) * r.height };
}

function fire(engine, type, x, y, extra = {}) {
  const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, ...client(engine, x, y), ...extra });
  engine.view.dispatchEvent(ev);
}

async function drag(engine, pts, extra = {}, steps = 6) {
  fire(engine, 'pointerdown', pts[0][0], pts[0][1], extra);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    for (let s = 1; s <= steps; s++) fire(engine, 'pointermove', ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, extra);
  }
  const last = pts[pts.length - 1];
  fire(engine, 'pointerup', last[0], last[1], extra);
  await sleep(60);
}

async function click(engine, x, y) {
  fire(engine, 'pointerdown', x, y);
  fire(engine, 'pointerup', x, y);
  await sleep(30);
}

function px(engine, x, y) {
  return [...engine.docCtx.getImageData(x, y, 1, 1).data];
}

function snapshot(engine) { return engine.docCtx.getImageData(0, 0, DOC_W, DOC_H).data.slice(); }
function diffInfo(a, b) {
  let n = 0, max = 0, at = null;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { n++; if (d > max) { max = d; at = [(i >> 2) % DOC_W, Math.floor((i >> 2) / DOC_W)]; } } }
  return { n, max, at };
}

function docHash(engine) {
  const d = engine.docCtx.getImageData(0, 0, DOC_W, DOC_H).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619);
  return h >>> 0;
}

export async function run({ A, B, tb }) {
  const results = [];
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info: typeof info === 'string' ? info : JSON.stringify(info) });
  A.reset(); B.reset();
  if (window.T.events) window.T.events.length = 0;
  tb.setAlpha(1); tb.setSize(8); tb.setColor('#1b1b1f'); tb.setFilled(false);

  // 1. brush stroke, including a fast long jump between two samples
  tb.setTool('brush');
  await drag(A, [[100, 100], [700, 100]], {}, 1);
  check('Brush: nét liền khi di chuột nhanh (điểm giữa có mực)', px(A, 400, 100)[3] > 200, px(A, 400, 100));
  check('Brush: round cap (điểm trước đầu nét 3px có mực)', px(A, 97, 100)[3] > 100, px(A, 97, 100));

  // 2. closed rectangle + flood fill
  tb.setTool('rect');
  await drag(A, [[200, 300], [600, 600]]);
  tb.setColor('#c62828');
  tb.setTool('fill');
  await click(A, 400, 450);
  const inside = px(A, 400, 450), outside = px(A, 150, 450), nearEdge = px(A, 205, 450);
  check('Fill: tô đúng vùng kín', inside[0] === 198 && inside[3] === 255, inside);
  check('Fill: không tràn ra ngoài', outside[3] === 0, outside);
  check('Fill: viền sát nét không bị hở trắng', nearEdge[3] === 255, nearEdge);

  // 3. eraser truly erases (alpha -> 0)
  tb.setTool('eraser');
  tb.setSize(30);
  await drag(A, [[300, 450], [500, 450]]);
  check('Eraser: xóa thật (alpha = 0)', px(A, 400, 450)[3] === 0, px(A, 400, 450));

  // 4. undo / redo across erase and fill
  A.undo();
  check('Undo eraser: khôi phục màu', px(A, 400, 450)[3] === 255, px(A, 400, 450));
  A.redo();
  check('Redo eraser: xóa lại', px(A, 400, 450)[3] === 0);
  A.undo(); A.undo();
  check('Undo fill: bỏ màu tô', px(A, 400, 450)[3] === 0 && px(A, 200, 450)[3] > 200, px(A, 400, 450));
  A.redo();
  check('Redo fill', px(A, 450, 350)[3] === 255);

  // 5. Shift = equilateral, filled ellipse
  tb.setSize(6); tb.setColor('#1565c0'); tb.setTool('ellipse'); tb.setFilled(true);
  await drag(A, [[900, 200], [1150, 320]], { shiftKey: true });
  const ell = A.ops[A.ops.length - 1];
  check('Shift: elip thành hình tròn (w = h)', ell.kind === 'ellipse' && ell.w === ell.h && ell.fill, ell);
  check('Filled shape: tâm có màu', px(A, Math.round(ell.cx), Math.round(ell.cy))[2] > 150, px(A, Math.round(ell.cx), Math.round(ell.cy)));

  // 6. Ctrl = rotate while dragging a rectangle
  tb.setFilled(false); tb.setTool('rect');
  fire(A, 'pointerdown', 900, 600);
  for (let i = 1; i <= 5; i++) fire(A, 'pointermove', 900 + i * 40, 600 + i * 20);
  for (let i = 1; i <= 6; i++) fire(A, 'pointermove', 1100 - i * 25, 700 + i * 20, { ctrlKey: true });
  fire(A, 'pointerup', 950, 820, { ctrlKey: true });
  await sleep(50);
  const rr = A.ops[A.ops.length - 1];
  check('Ctrl: xoay hình chữ nhật', rr.kind === 'rect' && Math.abs(rr.rot) > 0.2 && rr.w > 150, rr);

  // 7. line tool with Shift snaps to 15°
  tb.setTool('line');
  await drag(A, [[1200, 100], [1500, 130]], { shiftKey: true });
  const ln = A.ops[A.ops.length - 1];
  check('Line + Shift: bắt góc 0°', ln.kind === 'line' && Math.abs(ln.y2 - ln.y1) < 0.5, ln);

  // 8. opacity: translucent stroke does not darken where it overlaps itself
  tb.setTool('brush'); tb.setSize(20); tb.setColor('#2e7d32'); tb.setAlpha(0.5);
  await drag(A, [[100, 850], [500, 850], [300, 850]]);
  const a1 = px(A, 200, 850)[3], a2 = px(A, 400, 850)[3];
  check('Opacity 50%: alpha ≈ 128, chồng nét không đậm thêm', Math.abs(a1 - 128) <= 2 && Math.abs(a2 - a1) <= 1, [a1, a2]);
  tb.setAlpha(1);

  // 9. eyedropper
  tb.setTool('picker');
  await click(A, 450, 350);
  check('Eyedropper: hút đúng màu và quay lại bút', A.state.color === '#c62828' && A.state.tool === 'brush', A.state);

  // 10. clear + undo
  const before = docHash(A);
  const beforePx = snapshot(A);
  A.clear();
  check('Clear: bảng trắng', A.isBlank());
  A.undo();
  check('Undo clear: khôi phục tranh', docHash(A) === before, diffInfo(beforePx, snapshot(A)));

  // 11. remote replica identical, and a late joiner replaying the event log
  await sleep(50);
  check('Realtime: canvas người đoán trùng khớp từng pixel', docHash(B) === docHash(A), [docHash(A), docHash(B)]);
  const persistent = (window.T.events || []).filter((e) => ['op', 'undo', 'redo'].includes(e.k));
  B.loadEvents(persistent);
  check('Join giữa lượt: replay log ra đúng tranh', docHash(B) === docHash(A));

  // 12. resize keeps the drawing and coordinates stay correct
  const wrap = A.wrap;
  const oldW = wrap.style.width;
  wrap.style.width = '60%';
  A.resize();
  await sleep(50);
  check('Resize: không mất hình', docHash(A) === before);
  tb.setTool('brush'); tb.setSize(10); tb.setColor('#ad1457');
  await click(A, 800, 950);
  const dot = px(A, 800, 950);
  check('Resize: tọa độ chính xác sau khi đổi kích thước', dot[0] === 173 && dot[3] === 255, dot);
  wrap.style.width = oldW;
  A.resize();

  // 13. HiDPI backing store
  const r = A.view.getBoundingClientRect();
  const dpr = Math.min(3, devicePixelRatio || 1);
  check('HiDPI: backing store = CSS size × devicePixelRatio', Math.abs(A.view.width - Math.round(r.width * dpr)) <= 1, [A.view.width, r.width, dpr]);

  // 14. wheel resizes the brush
  const s0 = A.state.size;
  A.view.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, ...client(A, 500, 500) }));
  check('Cuộn chuột tăng cỡ bút', A.state.size > s0, [s0, A.state.size]);

  // 15. keyboard shortcuts
  const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  key('e'); const t1 = A.state.tool; key('f'); const t2 = A.state.tool; key('b');
  check('Phím tắt E/F/B', t1 === 'eraser' && t2 === 'fill' && A.state.tool === 'brush', [t1, t2, A.state.tool]);
  const n = A.ops.length; key('z', { ctrlKey: true });
  check('Ctrl+Z hoàn tác', A.ops.length === n - 1);
  key('y', { ctrlKey: true });
  check('Ctrl+Y làm lại', A.ops.length === n);

  // 16. fill performance on the full document (drawer side; the dev page also replays to canvas B)
  A.reset(); B.reset();
  A._applyFill({ t: 'fill', x: 5, y: 5, color: '#00ff00', alpha: 1 }); // warm-up
  const times = [];
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    A._applyFill({ t: 'fill', x: 5, y: 5, color: k % 2 ? '#ff0000' : '#0000ff', alpha: 1 });
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  check('Fill toàn bảng 1600×1000 < 200ms (trung bình 3 lần)', avg < 200, Math.round(avg) + 'ms');
  A.reset(); B.reset();

  return results;
}
