// Public Quick Learn leaderboard: the best fast-mode scores per topic.
//
// A score can only be sent for a round the server started (POST /api/fast/start gives a token),
// once per token, and it must be possible: no more than MAX_POINTS per question and no faster
// than MIN_MS_PER_Q per question since the round started. Names are cleaned and a short list of
// rude words is refused. This keeps casual cheating and spam out; it is not a secure exam.
//
// The token carries its topic and start time, signed with a secret kept in the store, so a round
// stays valid even if the server forgets everything in memory meanwhile (on Cloudflare an idle
// Durable Object is unloaded after a minute or two). Used tokens are saved until they expire.

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { MAX_POINTS, QUESTIONS, TOP_N } from '../public/js/shared/fast-core.js';
import { AVATAR_KEY_RE } from './avatars.js';

export { TOP_N };
export const MIN_MS_PER_Q = 450;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const SUBMITS_PER_HOUR = 40;
const STORE_KEY = 'fast-board.json';
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
  constructor({ store = null, topics, now = () => Date.now() }) {
    this.store = store;
    this.topics = new Set(topics);
    this.now = now;
    this.recent = new Map(); // ip -> [timestamps]
    this.boards = {};
    this.used = {}; // token -> time it was used (kept until it would have expired)
    this.secret = null;
    try {
      const data = JSON.parse(store?.get(STORE_KEY) || '{}');
      this.boards = data.boards || {};
      this.used = data.used || {};
      this.secret = data.secret || null;
    } catch {
      /* first run */
    }
    if (!this.secret) {
      this.secret = crypto.randomBytes(24).toString('base64url');
      this.save();
    }
  }

  _sign(body) {
    return crypto.createHmac('sha256', this.secret).update(body).digest('base64url').slice(0, 22);
  }

  start(topic) {
    if (!this.topics.has(topic)) throw new BoardError('Không có chủ đề này', 404);
    const body = Buffer.from(JSON.stringify({ t: topic, s: this.now(), r: crypto.randomBytes(6).toString('base64url') })).toString('base64url');
    return { token: `${body}.${this._sign(body)}` };
  }

  /** The round a token stands for, or null when it is forged or malformed. */
  _round(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || sig !== this._sign(body)) return null;
    try {
      const { t, s } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return this.topics.has(t) && Number.isFinite(s) ? { topic: t, startedAt: s } : null;
    } catch {
      return null;
    }
  }

  top(topic) {
    if (!this.topics.has(topic)) throw new BoardError('Không có chủ đề này', 404);
    return (this.boards[topic] || []).slice(0, TOP_N);
  }

  submit({ token, name, avatar, score, answered, correct }, ip = '') {
    const t = this._round(token);
    if (!t || this.used[token]) throw new BoardError('Lượt chơi không hợp lệ hoặc đã gửi điểm', 409);
    const now = this.now();
    const hits = (this.recent.get(ip) || []).filter((x) => now - x < 3_600_000);
    if (hits.length >= SUBMITS_PER_HOUR) throw new BoardError('Gửi điểm quá nhiều, thử lại sau', 429);
    const n = Math.round(Number(answered));
    const s = Math.round(Number(score));
    const c = Math.round(Number(correct));
    if (!(n >= 1 && n <= QUESTIONS) || !(s >= 0 && s <= n * MAX_POINTS) || !(c >= 0 && c <= n)) throw new BoardError('Điểm không hợp lệ');
    if (now - t.startedAt < n * MIN_MS_PER_Q || now - t.startedAt > TOKEN_TTL_MS) throw new BoardError('Điểm không hợp lệ');
    const entry = { name: cleanName(name), avatar: AVATAR_KEY_RE.test(avatar) ? avatar : 'c7', score: s, answered: n, correct: c, at: now };
    for (const [k, at] of Object.entries(this.used)) if (now - at > TOKEN_TTL_MS) delete this.used[k];
    this.used[token] = now;
    hits.push(now);
    this.recent.set(ip, hits);
    const list = (this.boards[t.topic] ||= []);
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    list.splice(TOP_N);
    const rank = list.indexOf(entry) + 1; // 0 = not in the top
    this.save();
    return { rank, top: list.slice(0, TOP_N), topic: t.topic };
  }

  save() {
    try {
      this.store?.put(STORE_KEY, JSON.stringify({ boards: this.boards, used: this.used, secret: this.secret }));
    } catch (e) {
      console.error('[fast] save failed', e.message);
    }
  }
}
