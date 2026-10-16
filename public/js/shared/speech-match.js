// Spoken answers: compare what the speech recogniser heard with the expected word, letter by letter.
// Pure functions (no DOM) so they can be unit-tested in Node.

const letters = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 -]/g, '').trim();
const bare = (s) => letters(s).replace(/[ -]/g, '');

/**
 * Align `target` against `heard` (edit distance with backtrace). Returns one cell per target
 * character: {ch, ok, heard} where heard is the letter the recogniser put there ('' = missing);
 * spaces/hyphens of the target are kept as separators ({sep: true}). `extra` counts letters the
 * recogniser added; `sim` is 1 − distance / longest length.
 */
export function alignLetters(target, heard) {
  const t = letters(target);
  const a = [...t].filter((c) => !/[ -]/.test(c));
  const b = [...bare(heard)];
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const out = Array(n);
  let extra = 0;
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      out[i - 1] = { ch: a[i - 1], ok: a[i - 1] === b[j - 1], heard: b[j - 1] };
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out[i - 1] = { ch: a[i - 1], ok: false, heard: '' };
      i--;
    } else {
      extra++;
      j--;
    }
  }
  // Put the target's word separators back between the letter cells.
  const cells = [];
  let k = 0;
  for (const c of t) cells.push(/[ -]/.test(c) ? { ch: c, sep: true } : out[k++]);
  const len = Math.max(n, m) || 1;
  return { cells, extra, sim: 1 - d[n][m] / len };
}

/**
 * Judge recognition alternatives ([{text, conf}], best first) against the accepted answers.
 * Only the first `topN` alternatives are used. ok: one of them is an accepted answer. The score (0–100) is the letter
 * similarity of the closest alternative, scaled by the recogniser's confidence when it reports one
 * (Safari reports 0 = unknown); an answer found only in a lower alternative loses 10%.
 */
export function judgeSpeech(alts, answers, topN = 3) {
  const accepted = answers.map(bare).filter(Boolean);
  const list = (alts || []).filter((x) => x && bare(x.text)).slice(0, topN);
  if (!list.length) return { ok: false, score: 0, heard: '', target: answers[0], align: alignLetters(answers[0], '') };
  let best = null;
  list.forEach((alt, rank) => {
    for (const ans of answers) {
      const al = alignLetters(ans, alt.text);
      if (!best || al.sim > best.al.sim || (al.sim === best.al.sim && rank < best.rank)) best = { alt, rank, ans, al };
    }
  });
  const ok = list.some((x) => accepted.includes(bare(x.text)));
  const conf = best.alt.conf > 0 ? best.alt.conf : 1;
  const score = Math.round(Math.max(0, Math.min(1, best.al.sim * conf * (best.rank > 0 ? 0.9 : 1))) * 100);
  return { ok, score, heard: best.alt.text.trim(), target: best.ans, align: best.al };
}
