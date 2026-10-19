// Authoritative game rules shared by the Node server (online rooms) and the browser
// (same-device "pass the device" mode). No DOM access here.
//
// The room owns: turn order, the secret word, the timer, answer validation and scoring.
// Messages are delivered through the injected send(playerId, message) function. The secret
// word is only ever sent to the current drawer; guessers receive a mask (letter count).
//
// Each turn starts with the drawer choosing one of CHOICES word cards: two from the room's pool
// and one easy everyday word (all three easy in an easy-only room). Online, the first card is
// taken if nobody chooses within CHOOSE_MS.

export const LIMITS = { rounds: [1, 6], drawTime: [30, 180], maxPlayers: [2, 12] };
export const DEFAULT_SETTINGS = { rounds: 2, drawTime: 80, maxPlayers: 8 };
export const PRE_MS = 3500;
export const CHOOSE_MS = 10000;
export const CHOICES = 3;
export const REVEAL_MS = 15000;
export const DRAWER_GRACE_MS = 10000; // a drawer who reloads the page keeps the turn
export const QUORUM_GRACE_MS = 15000; // game ends only if < 2 players stay disconnected

// Drawing Assistant levels: 1 meaning + photo, 2 scene, 3 elements, 4 step-by-step, 5 ghost sketch.
// The highest level used caps the drawer's points for that turn.
export const ASSIST_MULT = [1, 1, 0.9, 0.8, 0.7, 0.6];
export const ASSIST_NAMES = ['—', 'Nghĩa', 'Tình huống', 'Thành phần', 'Từng bước', 'Ghost Sketch'];

export function normalizeAnswer(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

export function maskWord(word, revealed = []) {
  const show = new Set(revealed);
  return [...word].map((c, i) => (/[A-Za-z]/.test(c) && !show.has(i) ? '_' : c)).join('');
}

// Letter hints for guessers: when nobody has guessed after these fractions of the drawing time,
// one more letter of the word is shown. Never more than a third of the letters (none for short words).
export const HINT_AT = [0.5, 0.7, 0.85];
export function hintCount(word) {
  const n = (word.match(/[A-Za-z]/g) || []).length;
  return Math.min(HINT_AT.length, n <= 3 ? 0 : Math.floor(n / 3));
}

export function guesserPoints(remainingFraction) {
  const f = Math.max(0, Math.min(1, remainingFraction));
  return Math.round(40 + 160 * f);
}

export function comboBonus(streak) {
  return 10 * Math.min(5, Math.max(0, streak - 1));
}

export function drawerPoints(basePointsOfGuessers, assistLevel) {
  const raw = basePointsOfGuessers.reduce((s, p) => s + p * 0.5, 0);
  return Math.round(raw * ASSIST_MULT[assistLevel || 0]);
}

const clampInt = (v, [lo, hi], d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

function shuffle(a, rnd = Math.random) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PERSISTENT_DRAW = new Set(['op', 'undo', 'redo']);
const LIVE_DRAW = new Set(['lv', 'ls', 'lx']);

export class GameRoom {
  /**
   * @param {object} o
   * @param {string} o.code
   * @param {Map<string,{id:string,en:string,answers:string[]}>} o.dictionary  every known word
   * @param {string[]} o.wordIds   ordered pool for this room (today's words first)
   * @param {string[]} [o.easyIds] easy everyday words offered as one of the cards
   * @param {(pid:string,msg:object)=>void} o.send
   * @param {boolean} [o.local]    same-device mode: the drawer starts the timer manually
   */
  constructor({ code, dictionary, wordIds, easyIds = [], settings, send, isPublic = false, local = false, now = () => Date.now(), timers }) {
    this.code = code;
    this.dict = dictionary;
    this.send = send;
    this.isPublic = isPublic;
    this.local = local;
    this.now = now;
    this.timers = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
    this.settings = { ...DEFAULT_SETTINGS };
    this.updateSettings(settings || {});
    this.players = new Map();
    this.order = [];
    this.hostId = null;
    this.state = 'lobby'; // lobby | playing | ended
    this.round = 0;
    this.turnPos = -1;
    this.turn = null;
    this.turnCount = 0;
    this.timer = null;
    this.grace = {};
    this.lastRanking = null;
    this.createdAt = now();
    this.easyIds = easyIds.filter((id) => dictionary.has(id));
    this.easySet = new Set(this.easyIds);
    this.easyQueue = [];
    this.setWordPool(wordIds || []);
  }

  // ------------------------------------------------------------------ helpers

  setWordPool(ids) {
    this.pool = [...new Set(ids)].filter((id) => this.dict.has(id));
    this.easyOnly = this.pool.length > 0 && this.pool.every((id) => this.easySet.has(id));
    // A learning pool keeps its order (today's words first); the easy list is in file order, so mix it.
    this.queue = this.easyOnly ? shuffle(this.pool) : this.pool.slice();
  }

  updateSettings(s) {
    this.settings.rounds = clampInt(s.rounds ?? this.settings.rounds, LIMITS.rounds, DEFAULT_SETTINGS.rounds);
    this.settings.drawTime = clampInt(s.drawTime ?? this.settings.drawTime, LIMITS.drawTime, DEFAULT_SETTINGS.drawTime);
    this.settings.maxPlayers = clampInt(s.maxPlayers ?? this.settings.maxPlayers, LIMITS.maxPlayers, DEFAULT_SETTINGS.maxPlayers);
  }

  connected() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  broadcast(msg, exceptId) {
    for (const p of this.players.values()) if (p.connected && p.id !== exceptId) this.send(p.id, msg);
  }

  publicPlayers() {
    const t = this.turn;
    return this.order.concat([...this.players.keys()].filter((id) => !this.order.includes(id))).map((id) => {
      const p = this.players.get(id);
      return {
        id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected, streak: p.streak,
        host: p.id === this.hostId,
        drawing: !!t && t.drawerId === p.id && t.phase !== 'reveal',
        guessed: !!t && t.guessed.has(p.id),
      };
    });
  }

  publicRoom() {
    return {
      code: this.code, state: this.state, settings: { ...this.settings }, hostId: this.hostId,
      round: this.round, players: this.publicPlayers(), poolSize: this.pool.length, easyOnly: this.easyOnly, isPublic: this.isPublic, local: this.local, groupCode: this.groupCode || null,
    };
  }

  publicTurn() {
    const t = this.turn;
    if (!t) return null;
    const w = t.wordId ? this.dict.get(t.wordId) : null;
    const out = {
      index: t.index, drawerId: t.drawerId, phase: t.phase, round: this.round, rounds: this.settings.rounds,
      mask: w ? maskWord(w.en, t.revealed) : '', drawTime: this.settings.drawTime, endAt: t.endAt, startAt: t.startAt, now: this.now(),
      assist: t.assist, chooseEndAt: t.chooseEndAt,
    };
    if (t.phase === 'reveal') Object.assign(out, t.result);
    return out;
  }

  _syncPlayers() {
    this.broadcast({ type: 'players', players: this.publicPlayers(), hostId: this.hostId });
  }

  _clearTimer() {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
  }

  _after(ms, fn) {
    this._clearTimer();
    this.timer = this.timers.set(() => { this.timer = null; fn(); }, ms);
  }

  // ------------------------------------------------------------------ membership

  join(pid, { name, avatar } = {}) {
    let p = this.players.get(pid);
    if (!p) {
      if (this.players.size >= this.settings.maxPlayers) return { error: 'Phòng đã đầy.' };
      p = { id: pid, name: String(name || 'Player').slice(0, 18), avatar: avatar || 'c7', score: 0, streak: 0, connected: true, ready: false, joinedAt: this.now(), rate: [] };
      this.players.set(pid, p);
      if (this.state === 'playing') this.order.push(pid); // late joiner draws later this round
    } else {
      p.connected = true;
      if (name) p.name = String(name).slice(0, 18);
      if (avatar) p.avatar = avatar;
    }
    if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = pid;
    if (this.connected().length >= 2) this._clearGrace('quorum');
    if (this.turn && this.turn.drawerId === pid) this._clearGrace('drawer');
    const t = this.turn;
    this.send(pid, {
      type: 'welcome', you: pid, room: this.publicRoom(), turn: this.publicTurn(),
      events: t && t.phase !== 'pre' ? t.events : [],
      ranking: this.state === 'ended' ? this.lastRanking : null,
    });
    if (t && t.drawerId === pid && t.phase !== 'reveal') this._sendSecret();
    this.broadcast({ type: 'system', text: `${p.name} đã vào phòng.` }, pid);
    this._syncPlayers();
    return { ok: true };
  }

  /** Socket dropped. The player keeps their score and can reconnect. */
  disconnect(pid) {
    const p = this.players.get(pid);
    if (!p || !p.connected) return;
    p.connected = false;
    this.broadcast({ type: 'system', text: `${p.name} đã mất kết nối.` });
    this._afterMembershipChange(pid, true);
  }

  _setGrace(key, ms, fn) {
    if (this.grace[key]) this.timers.clear(this.grace[key]);
    this.grace[key] = this.timers.set(() => { delete this.grace[key]; fn(); }, ms);
  }

  _clearGrace(key) {
    if (this.grace[key]) this.timers.clear(this.grace[key]);
    delete this.grace[key];
  }

  remove(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    const idx = this.order.indexOf(pid);
    if (idx !== -1) {
      this.order.splice(idx, 1);
      if (idx <= this.turnPos) this.turnPos--;
    }
    this.players.delete(pid);
    if (p.connected) this.broadcast({ type: 'system', text: `${p.name} đã rời phòng.` });
    p.connected = false;
    this._afterMembershipChange(pid);
  }

  _afterMembershipChange(pid, soft = false) {
    if (this.hostId === pid || !this.players.get(this.hostId)?.connected) {
      const next = this.connected()[0];
      this.hostId = next ? next.id : null;
      if (next) this.broadcast({ type: 'system', text: `${next.name} là chủ phòng mới.` });
    }
    const t = this.turn;
    if (this.state === 'playing') {
      if (this.connected().length < 2) {
        if (soft) this._setGrace('quorum', QUORUM_GRACE_MS, () => { if (this.state === 'playing' && this.connected().length < 2) this._endGame('Không đủ người chơi để tiếp tục.'); });
        else this._endGame('Không đủ người chơi để tiếp tục.');
      }
      if (this.state !== 'playing') {
        // game ended above
      } else if (t && t.drawerId === pid && t.phase !== 'reveal') {
        const idx = t.index;
        if (soft) this._setGrace('drawer', DRAWER_GRACE_MS, () => { if (this.turn && this.turn.index === idx && !this.players.get(pid)?.connected) this._endTurn('drawer-left'); });
        else this._endTurn('drawer-left');
      } else if (t && t.phase === 'draw') {
        this._checkAllGuessed();
      } else if (t && t.phase === 'reveal') {
        this._checkAllReady();
      }
    }
    this._syncPlayers();
  }

  isEmpty() {
    return this.connected().length === 0;
  }

  // ------------------------------------------------------------------ messages

  handle(pid, msg) {
    const p = this.players.get(pid);
    if (!p || !msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'settings':
        if (pid === this.hostId && this.state === 'lobby') {
          this.updateSettings(msg.settings || {});
          if (Array.isArray(msg.wordIds) && msg.wordIds.length) this.setWordPool(msg.wordIds);
          this.broadcast({ type: 'room', room: this.publicRoom() });
        }
        break;
      case 'start': return this.start(pid);
      case 'restart':
        if (pid === this.hostId && this.state === 'ended') this._toLobby();
        break;
      case 'guess': return this._guess(p, String(msg.text || ''));
      case 'draw': return this._draw(pid, msg.ev);
      case 'assist': return this._assist(pid, msg.level);
      case 'choose':
        if (this.turn?.phase === 'choose' && this.turn.drawerId === pid) this._choose(msg.wordId);
        break;
      case 'begin': // same-device mode: drawer has seen the word and starts the clock
        if (this.local && this.turn?.phase === 'pre' && this.turn.drawerId === pid) this._beginDraw();
        break;
      case 'skip':
        if (this.turn && this.turn.drawerId === pid && this.turn.phase !== 'reveal') this._endTurn('skipped');
        break;
      case 'ready':
        if (this.turn?.phase === 'reveal') {
          p.ready = true;
          this.broadcast({ type: 'ready', count: this.connected().filter((x) => x.ready).length, total: this.connected().length });
          this._checkAllReady();
        }
        break;
      case 'leave': return this.remove(pid);
    }
  }

  start(pid) {
    if (pid !== this.hostId || this.state !== 'lobby') return;
    if (this.connected().length < 2) {
      this.send(pid, { type: 'error', text: 'Cần ít nhất 2 người chơi.' });
      return;
    }
    if (!this.pool.length) {
      this.send(pid, { type: 'error', text: 'Chưa có từ vựng cho phòng này.' });
      return;
    }
    for (const p of this.players.values()) { p.score = 0; p.streak = 0; }
    this.order = this.connected().map((p) => p.id);
    for (const p of [...this.players.values()]) if (!p.connected) this.players.delete(p.id);
    this.state = 'playing';
    this.round = 1;
    this.turnPos = -1;
    this.turnCount = 0;
    this.queue = this.easyOnly ? shuffle(this.pool) : this.pool.slice();
    this.broadcast({ type: 'room', room: this.publicRoom() });
    this._nextTurn();
  }

  _toLobby() {
    this._clearTimer();
    this.state = 'lobby';
    this.turn = null;
    this.round = 0;
    for (const p of this.players.values()) { p.score = 0; p.streak = 0; }
    this.broadcast({ type: 'room', room: this.publicRoom() });
  }

  _pickWord() {
    if (!this.queue.length) {
      const last = this.turn?.wordId;
      this.queue = shuffle(this.pool);
      if (this.queue.length > 1 && this.queue[0] === last) this.queue.push(this.queue.shift());
    }
    return this.queue.shift();
  }

  _pickEasy() {
    if (!this.easyQueue.length) this.easyQueue = shuffle(this.easyIds);
    return this.easyQueue.shift();
  }

  /** The word cards for a new turn: pool words first (the default pick), then easy words. */
  _choices() {
    const ids = [];
    const fromPool = this.easyOnly || !this.easyIds.length ? CHOICES : CHOICES - 1;
    for (let tries = 0; ids.length < Math.min(fromPool, this.pool.length) && tries < 10; tries++) {
      const id = this._pickWord();
      if (!ids.includes(id)) ids.push(id);
      else this.queue.push(id);
    }
    for (let tries = 0; ids.length < CHOICES && this.easyIds.length && tries < 10; tries++) {
      const id = this._pickEasy();
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  _sendChoices() {
    const t = this.turn;
    this.send(t.drawerId, {
      type: 'choices', turnIndex: t.index, endAt: t.chooseEndAt,
      options: t.options.map((id) => ({ id, en: this.dict.get(id).en, easy: this.easySet.has(id) })),
    });
  }

  _choose(wordId) {
    const t = this.turn;
    if (!t || t.phase !== 'choose') return;
    const id = t.options.includes(wordId) ? wordId : t.options[0];
    // Pool words that were not chosen come back later in the game.
    for (const o of t.options) if (o !== id && !this.easySet.has(o) && this.pool.includes(o)) this.queue.push(o);
    t.wordId = id;
    t.chooseEndAt = 0;
    t.phase = 'pre';
    this._clearTimer();
    this._sendSecret();
    // Same-device: the drawer starts the clock with 'begin'. Online the drawer has seen the word.
    if (this.local) this.broadcast({ type: 'turn', turn: this.publicTurn() });
    else this._beginDraw();
  }

  _nextTurn() {
    this._clearTimer();
    let pos = this.turnPos + 1;
    while (pos < this.order.length && !this.players.get(this.order[pos])?.connected) pos++;
    if (pos >= this.order.length) {
      if (this.round >= this.settings.rounds) return this._endGame();
      this.round++;
      pos = 0;
      while (pos < this.order.length && !this.players.get(this.order[pos])?.connected) pos++;
      if (pos >= this.order.length) return this._endGame('Không còn người chơi.');
    }
    this.turnPos = pos;
    const drawerId = this.order[pos];
    for (const p of this.players.values()) p.ready = false;
    this.turn = {
      index: ++this.turnCount, drawerId, wordId: null, options: this._choices(), phase: 'choose',
      chooseEndAt: this.local ? 0 : this.now() + CHOOSE_MS,
      startAt: 0, endAt: 0, guessed: new Map(), base: new Map(), tries: new Map(), events: [], assist: 0, result: null,
      revealed: [], hintTimers: [],
    };
    this.broadcast({ type: 'turn', turn: this.publicTurn() });
    this._sendChoices();
    this._syncPlayers();
    if (!this.local) this._after(CHOOSE_MS, () => this._choose(null));
  }

  _sendSecret() {
    const t = this.turn;
    if (t.phase === 'choose') return this._sendChoices();
    const w = this.dict.get(t.wordId);
    this.send(t.drawerId, { type: 'secret', turnIndex: t.index, wordId: w.id, word: w.en });
  }

  _beginDraw() {
    const t = this.turn;
    if (!t || t.phase !== 'pre') return;
    t.phase = 'draw';
    t.startAt = this.now();
    t.endAt = t.startAt + this.settings.drawTime * 1000;
    this.broadcast({ type: 'turn', turn: this.publicTurn() });
    this._after(this.settings.drawTime * 1000, () => this._endTurn('time'));
    const w = this.dict.get(t.wordId);
    t.hintTimers = HINT_AT.slice(0, hintCount(w.en)).map((f) => this.timers.set(() => this._hint(t), f * this.settings.drawTime * 1000));
  }

  _hint(t) {
    if (this.turn !== t || t.phase !== 'draw' || t.guessed.size) return; // someone already got it: no hint
    const w = this.dict.get(t.wordId);
    const hidden = [...w.en].map((c, i) => (/[A-Za-z]/.test(c) && !t.revealed.includes(i) ? i : -1)).filter((i) => i >= 0);
    if (hidden.length <= 1) return;
    t.revealed.push(hidden[Math.floor(Math.random() * hidden.length)]);
    this.broadcast({ type: 'turn', turn: this.publicTurn() });
    this.broadcast({ type: 'system', text: 'Gợi ý: hiện thêm 1 chữ cái' }, t.drawerId);
  }

  _clearHints() {
    for (const id of this.turn?.hintTimers || []) this.timers.clear(id);
    if (this.turn) this.turn.hintTimers = [];
  }

  _rateLimited(p) {
    const now = this.now();
    p.rate = p.rate.filter((t) => now - t < 3000);
    if (p.rate.length >= 8) return true;
    p.rate.push(now);
    return false;
  }

  _guess(p, raw) {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) return;
    if (this._rateLimited(p)) {
      this.send(p.id, { type: 'notice', text: 'Bạn gửi quá nhanh, chờ một chút.' });
      return;
    }
    const t = this.turn;
    const drawing = this.state === 'playing' && t && t.phase === 'draw';
    if (!drawing) {
      this.broadcast({ type: 'chat', from: p.id, name: p.name, text });
      return;
    }
    const w = this.dict.get(t.wordId);
    const norm = normalizeAnswer(text);
    const answers = w.answers.map(normalizeAnswer);
    if (p.id === t.drawerId) {
      if (answers.some((a) => a && norm.includes(a))) this.send(p.id, { type: 'notice', text: 'Người vẽ không được tiết lộ đáp án.' });
      else this.broadcast({ type: 'chat', from: p.id, name: p.name, text });
      return;
    }
    if (t.guessed.has(p.id)) {
      this.send(p.id, { type: 'notice', text: 'Bạn đã đoán đúng rồi — chờ người khác nhé.' });
      return;
    }
    if (!norm) return;
    let tries = t.tries.get(p.id);
    if (!tries) t.tries.set(p.id, (tries = new Set()));
    if (tries.has(norm)) {
      this.send(p.id, { type: 'notice', text: `Bạn đã gửi “${text}” rồi.` });
      return;
    }
    tries.add(norm);
    if (answers.includes(norm)) {
      const remaining = (t.endAt - this.now()) / (this.settings.drawTime * 1000);
      const base = guesserPoints(remaining);
      p.streak += 1;
      const bonus = comboBonus(p.streak);
      const pts = base + bonus;
      p.score += pts;
      t.guessed.set(p.id, pts);
      t.base.set(p.id, base);
      this.broadcast({ type: 'guessed', playerId: p.id, name: p.name, points: pts, combo: p.streak, bonus });
      this.send(p.id, { type: 'you-guessed', word: w.en, wordId: w.id, points: pts, combo: p.streak, bonus });
      this._syncPlayers();
      this._checkAllGuessed();
    } else {
      this.broadcast({ type: 'chat', from: p.id, name: p.name, text, guess: true });
    }
  }

  _checkAllGuessed() {
    const t = this.turn;
    if (!t || t.phase !== 'draw') return;
    const guessers = this.connected().filter((p) => p.id !== t.drawerId);
    if (guessers.length && guessers.every((p) => t.guessed.has(p.id))) this._endTurn('all-guessed');
  }

  _draw(pid, ev) {
    const t = this.turn;
    if (!t || t.phase !== 'draw' || t.drawerId !== pid || !ev || typeof ev.k !== 'string') return;
    if (!PERSISTENT_DRAW.has(ev.k) && !LIVE_DRAW.has(ev.k)) return;
    if (ev.k === 'op') {
      const op = ev.op;
      if (!op || !['stroke', 'shape', 'fill', 'clear'].includes(op.t)) return;
      if (op.pts && (!Array.isArray(op.pts) || op.pts.length > 20000)) return;
    }
    if (PERSISTENT_DRAW.has(ev.k)) {
      t.events.push(ev);
      if (t.events.length > 3000) t.events.splice(0, t.events.length - 3000);
    }
    this.broadcast({ type: 'draw', ev }, pid);
  }

  _assist(pid, level) {
    const t = this.turn;
    if (!t || t.drawerId !== pid || t.phase === 'reveal') return;
    const lv = Math.max(0, Math.min(5, Math.round(Number(level) || 0)));
    if (lv > t.assist) t.assist = lv;
    this.send(pid, { type: 'assist', level: t.assist, mult: ASSIST_MULT[t.assist] });
    this.broadcast({ type: 'assist-public', level: t.assist }, pid); // only the level, never content
  }

  _endTurn(reason) {
    const t = this.turn;
    if (!t || t.phase === 'reveal') return;
    if (!t.wordId) {
      // The drawer left (or skipped) before choosing: nothing was drawn, so no reveal.
      this._clearTimer();
      for (const o of t.options) if (!this.easySet.has(o) && this.pool.includes(o)) this.queue.unshift(o);
      return this._nextTurn();
    }
    this._clearTimer();
    this._clearHints();
    const drawer = this.players.get(t.drawerId);
    const deltas = {};
    for (const [id, pts] of t.guessed) deltas[id] = pts;
    let dPts = 0;
    if (drawer && reason !== 'drawer-left' && reason !== 'skipped') {
      dPts = drawerPoints([...t.base.values()], t.assist);
      drawer.score += dPts;
    }
    deltas[t.drawerId] = dPts;
    // Guessers who were present but missed lose their combo streak.
    for (const p of this.players.values()) if (p.id !== t.drawerId && !t.guessed.has(p.id)) p.streak = 0;
    const w = this.dict.get(t.wordId);
    t.phase = 'reveal';
    t.result = {
      reason, wordId: w.id, word: w.en, deltas, assist: t.assist, assistMult: ASSIST_MULT[t.assist],
      guessedIds: [...t.guessed.keys()], revealUntil: this.now() + REVEAL_MS,
    };
    this.broadcast({ type: 'turn-end', turn: this.publicTurn(), players: this.publicPlayers() });
    this._syncPlayers();
    this._after(REVEAL_MS, () => this._nextTurn());
  }

  _checkAllReady() {
    const c = this.connected();
    if (this.turn?.phase === 'reveal' && c.length && c.every((p) => p.ready)) this._nextTurn();
  }

  _endGame(note) {
    this._clearTimer();
    this._clearHints();
    if (this.turn && this.turn.wordId && this.turn.phase !== 'reveal') {
      // Reveal the word of an interrupted turn so it can still be learned.
      const w = this.dict.get(this.turn.wordId);
      this.broadcast({ type: 'system', text: `Từ của lượt dang dở: ${w.en}` });
    }
    this.state = 'ended';
    this.turn = null;
    this._clearGrace('drawer');
    this._clearGrace('quorum');
    const ranking = [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: i + 1 }));
    // equal scores share a rank
    for (let i = 1; i < ranking.length; i++) if (ranking[i].score === ranking[i - 1].score) ranking[i].rank = ranking[i - 1].rank;
    this.lastRanking = ranking;
    this.broadcast({ type: 'game-end', ranking, note: note || null, room: this.publicRoom() });
  }

  destroy() {
    this._clearTimer();
    this._clearGrace('drawer');
    this._clearGrace('quorum');
  }
}
