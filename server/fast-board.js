// Public Quick Learn leaderboard: the best fast-mode scores per topic.
//
// A score can only be sent for a round the server started (POST /api/fast/start gives a token),
// once per token, and it must be possible: no more than MAX_POINTS per question and no faster
// than MIN_MS_PER_Q per question since the round started. Names are cleaned and a short list of
// rude words is refused. This keeps casual cheating and spam out; it is not a secure exam.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAX_POINTS, QUESTIONS, TOP_N } from '../public/js/shared/fast-core.js';
import { AVATAR_KEY_RE } from './avatars.js';

export { TOP_N };
export const MIN_MS_PER_Q = 450;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_TOKENS = 5000;
const SUBMITS_PER_HOUR = 40;
// Rude words (Vietnamese without tone marks + English), matched inside the folded name.
const BLOCKED = ['dit', 'dmm', 'dcm', 'dume', 'deo', 'lon', 'buoi', 'cac', 'cave', 'fuck', 'shit', 'bitch', 'cunt', 'dick', 'nigg', 'porn', 'sex'];

export class BoardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');

/** Display name for the board: printable, 1–18 characters, no rude words. */
export function cleanName(raw) {
  const name = String(raw || '').replace(/[\p{C}\u200B-\u200F\u2028-\u202F\u2060-\u206F]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  if (!name) throw new BoardError('Thiếu tên');
  const f = fold(name);
  // Short words only count as a whole folded name or at a word start, so "Long" or "Cường" pass.
  const words = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').split(/[^a-z0-9]+/).filter(Boolean);
  const bad = BLOCKED.some((b) => (b.length <= 4 ? words.includes(b) || f === b : f.includes(b)));
  if (bad) throw new BoardError('Tên không phù hợp');
  return name;
}

export class FastBoard {
  constructor({ file, topics, now = () => Date.now() }) {
    this.file = file;
    this.topics = new Set(topics);
    this.now = now;
    this.tokens = new Map(); // token -> { topic, startedAt }
    this.recent = new Map(); // ip -> [timestamps]
    this.boards = {};
    try {
      this.boards = JSON.parse(fs.readFileSync(file, 'utf8')).boards || {};
    } catch {
      /* first run */
    }
  }

  start(topic) {
    if (!this.topics.has(topic)) throw new BoardError('Không có chủ đề này', 404);
    const now = this.now();
    if (this.tokens.size >= MAX_TOKENS) {
      for (const [k, t] of this.tokens) if (now - t.startedAt > TOKEN_TTL_MS) this.tokens.delete(k);
      if (this.tokens.size >= MAX_TOKENS) this.tokens.delete(this.tokens.keys().next().value);
    }
    const token = crypto.randomBytes(12).toString('base64url');
    this.tokens.set(token, { topic, startedAt: now });
    return { token };
  }

  top(topic) {
    if (!this.topics.has(topic)) throw new BoardError('Không có chủ đề này', 404);
    return (this.boards[topic] || []).slice(0, TOP_N);
  }

  submit({ token, name, avatar, score, answered, correct }, ip = '') {
    const t = this.tokens.get(String(token || ''));
    if (!t) throw new BoardError('Lượt chơi không hợp lệ hoặc đã gửi điểm', 409);
    const now = this.now();
    const hits = (this.recent.get(ip) || []).filter((x) => now - x < 3_600_000);
    if (hits.length >= SUBMITS_PER_HOUR) throw new BoardError('Gửi điểm quá nhiều, thử lại sau', 429);
    const n = Math.round(Number(answered));
    const s = Math.round(Number(score));
    const c = Math.round(Number(correct));
    if (!(n >= 1 && n <= QUESTIONS) || !(s >= 0 && s <= n * MAX_POINTS) || !(c >= 0 && c <= n)) throw new BoardError('Điểm không hợp lệ');
    if (now - t.startedAt < n * MIN_MS_PER_Q || now - t.startedAt > TOKEN_TTL_MS) throw new BoardError('Điểm không hợp lệ');
    const entry = { name: cleanName(name), avatar: AVATAR_KEY_RE.test(avatar) ? avatar : 'c7', score: s, answered: n, correct: c, at: now };
    this.tokens.delete(token);
    hits.push(now);
    this.recent.set(ip, hits);
    const list = (this.boards[t.topic] ||= []);
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    list.splice(TOP_N);
    const rank = list.indexOf(entry) + 1; // 0 = not in the top
    if (rank) this.save();
    return { rank, top: list.slice(0, TOP_N), topic: t.topic };
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ boards: this.boards }));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[fast] save failed', e.message);
    }
  }
}
