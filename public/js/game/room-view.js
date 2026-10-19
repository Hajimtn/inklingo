// Room controller: lobby (online) + gameplay screen + turn results + final leaderboard.
// Works with both session adapters (online server / same-device local room).

import { h, $, clear, toast, confirmDialog, fmtTime, speak, autoSpeak } from '../ui/dom.js';
import { icon, avatar } from '../ui/icons.js';
import { DrawingEngine } from '../drawing/engine.js';
import { Toolbar } from '../drawing/toolbar.js';
import { Assistant } from './assistant.js';
import { LIMITS, ASSIST_NAMES } from '../shared/game-core.js';
import { word as vocabWord, photoFigure, isEasy } from '../vocab/data.js';
import * as progress from '../vocab/progress.js';
import { saveDrawing } from '../store/drawings.js';

import { tr, tServer } from '../i18n.js';
const REASONS = {
  time: tr('Hết giờ!'),
  'all-guessed': tr('Tất cả đã đoán đúng!'),
  skipped: tr('Người vẽ đã bỏ qua lượt'),
  'drawer-left': tr('Người vẽ đã rời phòng'),
};

export class RoomView {
  /**
   * @param {HTMLElement} root
   * @param {object} session  onlineSession() or localSession()
   * @param {object} opts { onExit, seatProfiles: {seatId: profileId} (local) }
   */
  constructor(root, session, opts = {}) {
    this.root = root;
    this.s = session;
    this.opts = opts;
    this.local = session.mode === 'local';
    this.room = null;
    this.players = [];
    this.turn = null;
    this.secret = null;
    this.choices = null; // the drawer's word cards for this turn
    this.guessedWord = null; // the word, once *I* guessed it (online)
    this.localPhase = null; // local: handoff | draw | handoff-guess | guess
    this.guesserSeat = null;
    this.view = null; // 'lobby' | 'game'
    this.reveal = null;
    this.finalBox = null;
    this.savedTurns = new Set();
    this.off = session.on((m) => this.onMsg(m));
    this.tick = setInterval(() => this.updateTimer(), 250);
    this.renderLoading();
    window.__swRoom = this; // inspection hook for automated browser tests
    if (this.local) {
      // The local room already exists: build the initial state directly.
      this.room = session.room.publicRoom();
      this.players = this.room.players;
    }
  }

  destroy() {
    clearInterval(this.tick);
    this.off?.();
    this.toolbar?.destroy();
    this.reveal?.remove();
    this.finalBox?.remove();
    document.querySelectorAll('.dialog-layer.room-dialog').forEach((d) => d.remove());
  }

  me() {
    if (!this.local || !this.turn) return this.s.me();
    return this.localPhase === 'guess' ? this.guesserSeat : this.turn.drawerId;
  }

  amDrawer() {
    const t = this.turn;
    if (!t || t.phase === 'reveal') return false;
    if (this.local) return this.localPhase === 'draw';
    return t.drawerId === this.s.me();
  }

  name(id) {
    return this.players.find((p) => p.id === id)?.name || '?';
  }

  // ------------------------------------------------------------------ messages

  onMsg(m) {
    switch (m.type) {
      case '_status':
        this.netStatus(m.status);
        break;
      case 'hello':
        if (!m.room && this.room && !this.local) {
          // The server no longer knows this seat (e.g. it restarted): go back to the menu.
          toast(tr('Phòng không còn tồn tại.'), 'bad');
          this.exit();
        }
        break;
      case 'welcome':
        if (!this.local && m.room?.code && location.hash !== '#/room/' + m.room.code) history.replaceState(null, '', '#/room/' + m.room.code);
        this.room = m.room;
        this.players = m.room.players;
        this.turn = m.turn;
        this.ensureView();
        if (this.view === 'game') {
          this.engine.loadEvents(m.events || []);
          this.applyTurn(true);
        }
        if (m.room.state === 'ended' && m.ranking && !this.finalBox) this.showFinal(m.ranking);
        break;
      case 'room':
        this.room = m.room;
        this.players = m.room.players;
        if (m.room.state === 'lobby') {
          this.finalBox?.remove();
          this.finalBox = null;
          this.turn = null;
        }
        this.ensureView();
        if (this.view === 'lobby') this.renderLobby();
        break;
      case 'players':
        this.players = m.players;
        if (this.room) {
          this.room.hostId = m.hostId;
          this.room.players = m.players;
        }
        if (this.view === 'lobby') this.renderLobby();
        else this.renderPlayers();
        break;
      case 'turn': {
        const isNew = !this.turn || this.turn.index !== m.turn.index;
        this.turn = m.turn;
        if (this.room) this.room.state = 'playing';
        this.ensureView();
        if (isNew) this.newTurn();
        this.applyTurn(isNew);
        break;
      }
      case 'secret':
        this.secret = m;
        if (this.view === 'game') this.applyTurn(false);
        break;
      case 'choices':
        this.choices = m;
        if (this.view === 'game') this.applyTurn(false);
        break;
      case 'draw':
        this.engine?.applyRemote(m.ev);
        break;
      case 'chat':
        this.chat(h('div.msg' + (this.turn && m.from === this.turn.drawerId ? '.drawer' : ''), h('b', m.name + ': '), m.text));
        break;
      case 'guessed':
        this.chat(h('div.msg.good', icon('check', { size: 14 }), ' ' + tr('{name} đã đoán đúng! +{n}', { name: m.name, n: m.points }) + (m.bonus ? ` (combo x${m.combo} +${m.bonus})` : '')));
        break;
      case 'you-guessed':
        if (!this.local) this.guessedWord = m.word;
        this.applyTurn(false);
        break;
      case 'notice':
        this.chat(h('div.msg.notice', tServer(m.text)));
        break;
      case 'system':
        this.chat(h('div.msg.system', tServer(m.text)));
        break;
      case 'assist':
        this.assistant?.confirm(m.level);
        break;
      case 'assist-public':
        if (this.assistBadge) {
          this.assistBadge.hidden = !m.level;
          this.assistBadge.textContent = tr('Người vẽ dùng trợ lý: {lv}', { lv: tr(ASSIST_NAMES[m.level]) });
        }
        break;
      case 'turn-end':
        this.turn = m.turn;
        this.players = m.players;
        this.applyTurn(false);
        this.showReveal();
        break;
      case 'ready':
        if (this.readyLabel) this.readyLabel.textContent = tr('{c}/{n} người sẵn sàng', { c: m.count, n: m.total });
        break;
      case 'game-end':
        this.room = m.room;
        this.turn = null;
        this.reveal?.remove();
        this.reveal = null;
        this.showFinal(m.ranking, m.note);
        break;
      case 'error':
        toast(tServer(m.text), 'bad');
        if (!this.room && !this.local) this.exit();
        break;
      case 'left':
        break;
    }
  }

  netStatus(st) {
    if (!this.netBadge) return;
    this.netBadge.hidden = st === 'open';
    this.netBadge.textContent = st === 'connecting' ? tr('Đang kết nối lại…') : tr('Mất kết nối – đang thử lại…');
  }

  ensureView() {
    const want = this.room && this.room.state === 'lobby' && !this.local ? 'lobby' : 'game';
    if (want === this.view) return;
    this.view = want;
    if (want === 'lobby') this.renderLobby();
    else this.buildGame();
  }

  exit() {
    this.destroy();
    this.opts.onExit?.();
  }

  async leave() {
    const playing = this.room && this.room.state === 'playing';
    if (playing && !(await confirmDialog(tr('Rời phòng?'), tr('Trận đấu đang diễn ra. Điểm của bạn trong trận sẽ không được giữ.'), tr('Rời phòng'), true))) return;
    this.s.leave();
    this.exit();
  }

  renderLoading() {
    clear(this.root).append(h('div.card', { style: { maxWidth: '420px', margin: '40px auto', textAlign: 'center' } }, h('h2', tr('Đang vào phòng…'))));
  }

  // ------------------------------------------------------------------ lobby

  renderLobby() {
    const r = this.room;
    if (!r) return;
    const isHost = r.hostId === this.s.me();
    const link = `${location.origin}${location.pathname}#/join/${r.code}`;
    const settingRow = (label, key, values, fmt) => h('div.row', h('span', { style: { width: '120px', fontWeight: 800 } }, label),
      h('div.seg', values.map((v) => h('button', {
        type: 'button', class: r.settings[key] === v ? 'on' : '', disabled: !isHost,
        onclick: () => this.s.send({ type: 'settings', settings: { [key]: v } }),
      }, fmt ? fmt(v) : String(v)))));
    const connected = r.players.filter((p) => p.connected);
    clear(this.root).append(
      h('a.back-link', { href: '#/', onclick: (e) => { e.preventDefault(); this.leave(); } }, icon('back', { size: 16 }), tr('Rời phòng')),
      h('div.lobby',
        h('section.card.stack',
          h('div.row.between', h('h2', r.isPublic ? tr('Phòng công khai') : r.groupCode ? tr('Phòng của nhóm') : tr('Phòng riêng')), h('span.tag.blue', tr('{c}/{n} người', { c: connected.length, n: r.settings.maxPlayers }))),
          h('div.lobby-players', r.players.map((p) => h('div.lobby-player' + (p.connected ? '' : '.off'),
            p.host ? h('span.crown', { title: tr('Chủ phòng') }, icon('crown', { size: 16, label: tr('Chủ phòng') })) : null,
            avatar(p.name, p.avatar, 48), h('div.nm', p.name), p.id === this.s.me() ? h('div.small.muted', tr('(bạn)')) : null))),
          isHost
            ? h('button.btn.green.big', { disabled: connected.length < 2, onclick: () => this.s.send({ type: 'start' }) }, connected.length < 2 ? tr('Cần ít nhất 2 người…') : [icon('play', { size: 20 }), tr('Bắt đầu trận')])
            : h('div.notice', icon('clock', { size: 18 }), h('span', tr('Chờ chủ phòng bắt đầu…')))),
        h('aside.card.stack',
          h('h3', tr('Mời bạn bè')),
          h('div.room-code', { 'aria-label': tr('Mã phòng') }, r.code),
          h('div.row',
            h('button.btn.small', { onclick: () => copy(r.code, tr('Đã chép mã phòng')) }, icon('copy', { size: 16 }), tr('Chép mã')),
            h('button.btn.small', { onclick: () => copy(link, tr('Đã chép link mời')) }, icon('link', { size: 16 }), tr('Chép link'))),
          h('h3', tr('Cài đặt')),
          settingRow(tr('Số vòng'), 'rounds', [1, 2, 3, 4, 5]),
          settingRow(tr('Thời gian vẽ'), 'drawTime', [60, 80, 100, 120], (v) => v + 's'),
          settingRow(tr('Tối đa'), 'maxPlayers', [4, 6, 8, 12]))));
  }

  // ------------------------------------------------------------------ game layout

  buildGame() {
    const R = this.root;
    clear(R);
    this.netBadge = h('span.chip.dark', { hidden: true });
    this.roundEl = h('div.round-info');
    this.wordEl = h('div.word-display');
    this.timerFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.timerNum = h('b', '--');
    this.timerBox = h('div.timer', { html: '<svg viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="24"/></svg>' });
    this.timerFg.setAttribute('class', 'fg');
    for (const [k, v] of Object.entries({ cx: 28, cy: 28, r: 24 })) this.timerFg.setAttribute(k, v);
    this.timerFg.style.strokeDasharray = String(2 * Math.PI * 24);
    this.timerBox.firstChild.append(this.timerFg);
    this.timerBox.append(this.timerNum);

    this.playerList = h('ol.player-list');
    this.assistRoot = h('div.assist');
    const board = h('canvas.board', { 'aria-label': tr('Bảng vẽ') });
    this.ghostCanvas = h('canvas.ghost', { hidden: true, 'aria-hidden': 'true' });
    const cursor = h('div.brush-cursor', { hidden: true });
    this.stageMsg = h('div.stage-msg', { hidden: true });
    this.assistBadge = h('span.tag.yellow.assist-badge', { hidden: true });
    this.wrap = h('div.canvas-wrap', board, this.ghostCanvas, cursor, this.assistBadge, this.stageMsg);
    const tbRoot = h('div.toolbar');
    this.actions = h('div.stage-actions');
    this.chatLog = h('div.chat-log', { 'aria-live': 'polite' });
    this.guessInput = h('input', { type: 'text', placeholder: tr('Nhập đáp án tiếng Anh…'), maxLength: 80, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': tr('Đáp án') });
    this.guessForm = h('form.guess-form', { onsubmit: (e) => { e.preventDefault(); this.submitGuess(); } }, this.guessInput, h('button.btn.primary', { type: 'submit' }, tr('Gửi')));
    this.localGuessers = h('div.local-guesser', { hidden: !this.local });

    R.append(
      h('div.game-top',
        h('div', this.roundEl),
        this.wordEl,
        h('div.timer-box', this.netBadge, this.timerBox)),
      h('div.game-grid',
        h('aside.card.side-panel.players-panel', h('h3.with-ic', icon('users', { size: 16 }), tr('Người chơi')), this.playerList, this.assistRoot),
        h('section.stage', this.wrap, tbRoot, this.actions),
        h('aside.card.chat-panel', h('h3.with-ic', icon('chat', { size: 16 }), tr('Đoán từ')), this.chatLog, this.localGuessers, this.guessForm)));

    this.engine = new DrawingEngine({ canvas: board, wrap: this.wrap, cursor });
    this.toolbar = new Toolbar(tbRoot, this.engine, { statusHost: this.wrap });
    this.engine.on('event', (ev) => {
      if (this.amDrawer() && this.turn.phase === 'draw' && !this.local) this.s.send({ type: 'draw', ev });
    });
    this.assistant = new Assistant(this.assistRoot, {
      ghostCanvas: this.ghostCanvas,
      onLevel: (level) => this.s.send({ type: 'assist', level }, this.turn?.drawerId),
    });
    this.renderPlayers();
    this.applyTurn(true);
  }

  newTurn() {
    if (!this.engine) return;
    this.engine.reset();
    this.secret = this.secret && this.secret.turnIndex === this.turn.index ? this.secret : null;
    this.choices = this.choices && this.choices.turnIndex === this.turn.index ? this.choices : null;
    this.guessedWord = null;
    this.reveal?.remove();
    this.reveal = null;
    if (this.assistBadge) this.assistBadge.hidden = true;
    this.localPhase = this.local ? 'handoff' : null;
    this.guesserSeat = null;
    this.chat(h('div.msg.system', tr('Lượt {i} · {name}', { i: this.turn.index, name: this.name(this.turn.drawerId) })));
  }

  renderPlayers() {
    if (!this.playerList) return;
    const sorted = [...this.players].sort((a, b) => b.score - a.score);
    const rank = new Map();
    sorted.forEach((p, i) => rank.set(p.id, i > 0 && p.score === sorted[i - 1].score ? rank.get(sorted[i - 1].id) : i + 1));
    clear(this.playerList).append(...sorted.map((p) => h('li.pl' + (p.drawing ? '.drawing' : '') + (p.guessed ? '.guessed' : '') + (p.connected ? '' : '.off') + (!this.local && p.id === this.s.me() ? '.me' : ''),
      h('span.rank', '#' + rank.get(p.id)), avatar(p.name, p.avatar, 34),
      h('div', { style: { minWidth: 0 } }, h('div.nm', p.name), h('div.pts', tr('{n} điểm', { n: p.score }) + (p.streak > 1 ? ` · combo ${p.streak}` : ''))),
      h('span.badge', { title: p.drawing ? tr('Đang vẽ') : p.guessed ? tr('Đã đoán đúng') : p.connected ? '' : tr('Mất kết nối') }, p.drawing ? icon('pencil', { size: 18 }) : p.guessed ? icon('checkCircle', { size: 18 }) : p.connected ? null : icon('offline', { size: 18 })))));
    if (this.local) this.renderLocalGuessers();
  }

  renderLocalGuessers() {
    const t = this.turn;
    const seats = this.players.filter((p) => !t || p.id !== t.drawerId);
    if (!this.guesserSeat || !seats.some((p) => p.id === this.guesserSeat)) this.guesserSeat = seats.find((p) => !p.guessed)?.id || seats[0]?.id;
    clear(this.localGuessers).append(h('span.small.muted', tr('Ai đoán?')), ...seats.map((p) => h('button', {
      type: 'button', class: p.id === this.guesserSeat ? 'on' : '', disabled: p.guessed,
      onclick: () => { this.guesserSeat = p.id; this.renderLocalGuessers(); this.guessInput.focus(); },
    }, avatar(p.name, p.avatar, 20), p.name, p.guessed ? icon('check', { size: 14 }) : null)));
  }

  // ------------------------------------------------------------------ turn state -> UI

  applyTurn() {
    if (this.view !== 'game' || !this.roundEl) return;
    this.renderPlayers();
    const t = this.turn;
    const drawerView = this.amDrawer();
    const w = this.secret && t && this.secret.turnIndex === t.index ? vocabWord(this.secret.wordId) : null;
    const choosing = t?.phase === 'choose';

    // top bar
    clear(this.roundEl).append(t ? h('div', tr('Vòng {i}/{n}', { i: t.round, n: t.rounds })) : h('div', tr('Chuẩn bị')), h('div.small.with-ic', t ? [icon('pencil', { size: 14 }), tr('{name} đang vẽ', { name: this.name(t.drawerId) })] : ''));
    clear(this.wordEl);
    if (t) {
      if (choosing) {
        this.wordEl.append(h('div.label', tr('Đoán từ')), h('div.word', '…'), h('div.len', tr('{name} đang chọn từ', { name: this.name(t.drawerId) })));
      } else if (drawerView && this.secret) {
        this.wordEl.append(h('div.label', tr('Từ bạn cần vẽ')), h('div.word.secret', this.secret.word.toUpperCase()), w ? h('div.len', w.vi) : null);
      } else if (this.guessedWord && t.phase !== 'reveal') {
        this.wordEl.append(h('div.label', tr('Bạn đã đoán đúng')), h('div.word.secret', this.guessedWord.toUpperCase()));
      } else if (t.phase === 'reveal' && t.word) {
        this.wordEl.append(h('div.label', tr('Đáp án')), h('div.word.secret', t.word.toUpperCase()));
      } else {
        const groups = t.mask.split(/[\s-]+/).map((g) => g.length);
        this.wordEl.append(h('div.label', tr('Đoán từ')), h('div.word', t.mask.split('').map((c) => (c === ' ' ? ' ' : c)).join(' ')), h('div.len', tr('{n} chữ cái', { n: groups.join(' + ') })));
      }
    }

    // canvas + tools
    const canDraw = drawerView && t && t.phase === 'draw';
    this.engine.setEnabled(canDraw);
    this.toolbar.setEnabled(canDraw);
    // Easy everyday words have no photo or drawing guide: the assistant stays closed for them.
    this.syncAssistant(w && !w.easy ? w : null, !drawerView);

    // guess input
    const canGuess = t && t.phase === 'draw' && !drawerView && !this.guessedWord && (!this.local || this.localPhase === 'guess');
    const chatOnly = !t || t.phase !== 'draw' || drawerView;
    this.guessInput.disabled = this.local ? !canGuess : !!this.guessedWord && t?.phase === 'draw';
    this.guessInput.placeholder = canGuess ? tr('Nhập đáp án tiếng Anh…') : chatOnly && !this.local ? tr('Trò chuyện…') : this.guessedWord ? tr('Bạn đã đoán đúng!') : tr('Chờ lượt đoán…');
    this.localGuessers.hidden = !this.local || this.localPhase !== 'guess';

    

    this.renderStageMsg();
    this.renderActions();
  }

  syncAssistant(w, locked) {
    const cur = this.assistant.word;
    if ((cur && cur.id) !== (w && w.id)) this.assistant.setWord(w);
    this.assistant.setLocked(locked || !w);
    if (w && this.turn) this.assistant.confirm(this.turn.assist || 0);
  }

  renderStageMsg() {
    const t = this.turn;
    const m = this.stageMsg;
    clear(m);
    m.hidden = true;
    if (!t) return;
    const show = (...kids) => { m.hidden = false; m.append(h('div.inner', ...kids)); };
    if (this.local && t.phase !== 'reveal') {
      const drawer = this.players.find((p) => p.id === t.drawerId);
      if (this.localPhase === 'handoff') {
        if ((t.phase === 'pre' || t.phase === 'choose') && !this.peek) {
          return show(h('div.big', avatar(drawer?.name, drawer?.avatar, 72)), h('h2', tr('Lượt của {name}', { name: drawer?.name })), h('p.muted', tr('Người khác đừng nhìn màn hình')),
            h('button.btn.primary.big', { onclick: () => { this.peek = true; this.renderStageMsg(); } }, tr('Tôi là {name} – xem từ', { name: drawer?.name })));
        }
        if (t.phase === 'choose' && this.peek && this.choices) return show(this.cardPicker());
        if (t.phase === 'pre' && this.peek && this.secret) {
          const w = vocabWord(this.secret.wordId);
          return show(h('div.label.small.muted', tr('TỪ BÍ MẬT')), h('h2', { style: { fontSize: '40px' } }, this.secret.word.toUpperCase()), h('p', w ? `${w.ipa} · ${w.vi}` : ''),
            h('button.btn.green.big', { onclick: () => { this.peek = false; this.localPhase = 'draw'; this.s.send({ type: 'begin' }, t.drawerId); this.applyTurn(); } }, icon('pencil', { size: 20 }), tr('Bắt đầu vẽ')));
        }
      }
      if (this.localPhase === 'handoff' && t.phase === 'draw') {
        return show(h('div.big', avatar(drawer?.name, drawer?.avatar, 72)), h('h2', tr('Trả máy cho {name}', { name: drawer?.name })),
          h('button.btn.primary.big', { onclick: () => { this.localPhase = 'draw'; this.applyTurn(); } }, tr('Tôi là {name} – vẽ tiếp', { name: drawer?.name })));
      }
      if (this.localPhase === 'handoff-guess') {
        return show(h('div.big', icon('eyeOff', { size: 56 })), h('h2', tr('Đến lượt đoán!')),
          h('button.btn.primary.big', { onclick: () => { this.localPhase = 'guess'; this.applyTurn(); this.guessInput.focus(); } }, tr('Sẵn sàng đoán')));
      }
      return;
    }
    if (t.phase === 'choose') {
      if (this.amDrawer() && this.choices) show(this.cardPicker());
      else show(h('div.big', icon('cards', { size: 56 })), h('h2', tr('{name} đang chọn từ…', { name: this.name(t.drawerId) })));
      return;
    }
    if (t.phase === 'pre') {
      if (this.amDrawer() && this.secret) {
        const w = vocabWord(this.secret.wordId);
        show(h('div.small.muted', tr('BẠN SẼ VẼ')), h('h2', { style: { fontSize: '40px' } }, this.secret.word.toUpperCase()), h('p', w ? `${w.ipa} · ${w.vi}` : ''));
      } else {
        show(h('div.big', icon('pencil', { size: 56 })), h('h2', tr('{name} chuẩn bị vẽ…', { name: this.name(t.drawerId) })));
      }
    }
  }

  /** The drawer's word cards: two words of the room and one easy everyday word. */
  cardPicker() {
    const t = this.turn;
    const left = h('span.choose-left');
    this.chooseLeft = left;
    return [
      h('div.small.muted', tr('CHỌN TỪ ĐỂ VẼ')),
      h('div.word-cards', this.choices.options.map((o) => {
        const w = vocabWord(o.id);
        return h('button.word-card' + (o.easy ? '.easy' : ''), { type: 'button', onclick: () => this.s.send({ type: 'choose', wordId: o.id }, t.drawerId) },
          h('span.tag' + (o.easy ? '.green' : '.blue'), o.easy ? tr('Từ dễ') : tr('Từ đang học')),
          h('b', { lang: 'en' }, o.en),
          w ? h('small', w.vi) : null);
      })),
      this.local ? null : left,
    ];
  }

  renderActions() {
    const t = this.turn;
    const a = clear(this.actions);
    const drawerActive = t && t.phase !== 'reveal' && this.amDrawer();
    if (this.local && t && t.phase === 'draw' && this.localPhase === 'draw') {
      a.append(h('button.btn.green', { onclick: () => { this.localPhase = 'handoff-guess'; this.applyTurn(); } }, icon('eyeOff', { size: 18 }), tr('Che từ & chuyển cho người đoán')));
    }
    if (this.local && t && t.phase === 'draw' && this.localPhase === 'guess') {
      a.append(h('button.btn', { onclick: () => { this.localPhase = 'handoff'; this.peek = false; this.applyTurn(); } }, icon('handoff', { size: 18 }), tr('Trả máy cho người vẽ')));
    }
    if (drawerActive && t.phase === 'draw') {
      a.append(h('button.btn.danger', { onclick: async () => { if (await confirmDialog(tr('Bỏ qua lượt?'), tr('Bạn sẽ không nhận điểm cho lượt này.'), tr('Bỏ qua'), true)) this.s.send({ type: 'skip' }, t.drawerId); } }, icon('skip', { size: 16 }), tr('Bỏ qua lượt')));
    }
    a.append(h('span', { style: { flex: 1 } }), h('button.btn.ghost.small', { onclick: () => this.leave() }, icon('logout', { size: 16 }), tr('Rời phòng')));
  }


  updateTimer() {
    const t = this.turn;
    if (!this.timerNum || !t) return;
    let left = 0, frac = 0;
    if (t.phase === 'draw') {
      left = (t.endAt - this.s.now()) / 1000;
      frac = left / t.drawTime;
    }
    const chooseLeft = t.phase === 'choose' && t.chooseEndAt ? Math.max(0, Math.ceil((t.chooseEndAt - this.s.now()) / 1000)) : null;
    if (this.chooseLeft) this.chooseLeft.textContent = chooseLeft != null ? tr('Tự chọn thẻ đầu sau {n}s', { n: chooseLeft }) : '';
    this.timerNum.textContent = t.phase === 'draw' ? Math.max(0, Math.ceil(left)) : chooseLeft != null ? chooseLeft : t.phase === 'pre' || t.phase === 'choose' ? '…' : '–';
    const C = 2 * Math.PI * 24;
    this.timerFg.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(1, frac))));
    this.timerBox.classList.toggle('warn', t.phase === 'draw' && left <= 30 && left > 10);
    this.timerBox.classList.toggle('danger', t.phase === 'draw' && left <= 10);
    this.timerBox.title = t.phase === 'draw' ? tr('Còn {time}', { time: fmtTime(left) }) : '';
    if (this.revealCountdown && t.phase === 'reveal' && t.revealUntil) {
      this.revealCountdown.textContent = tr('Tự động tiếp tục sau {n}s', { n: Math.max(0, Math.ceil((t.revealUntil - this.s.now()) / 1000)) });
    }
  }

  chat(el) {
    if (!this.chatLog) return;
    this.chatLog.append(el);
    while (this.chatLog.children.length > 150) this.chatLog.firstChild.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  submitGuess() {
    const text = this.guessInput.value.trim();
    if (!text) return;
    if (this.local) {
      if (this.localPhase !== 'guess' || !this.guesserSeat) return;
      this.s.send({ type: 'guess', text }, this.guesserSeat);
    } else {
      this.s.send({ type: 'guess', text });
    }
    this.guessInput.value = '';
  }

  // ------------------------------------------------------------------ results

  recordLearning(t) {
    const res = t;
    const learn = !isEasy(res.wordId); // easy everyday words are not part of the learning path
    if (this.local) {
      if (!learn) return;
      const map = this.opts.seatProfiles || {};
      for (const [seat, pid] of Object.entries(map)) {
        if (!pid) continue;
        const prof = progress.profile(pid);
        if (!prof) continue;
        if (seat === res.drawerId) progress.recordDrawn(res.wordId, prof);
        else progress.recordRecall(res.wordId, res.guessedIds.includes(seat), 'guess', prof);
      }
    } else {
      const me = this.s.me();
      if (learn && me === res.drawerId) progress.recordDrawn(res.wordId);
      else if (learn) progress.recordRecall(res.wordId, res.guessedIds.includes(me), 'guess');
      // Rooms opened from the group page add to that group's leaderboard.
      if (this.room?.groupCode && progress.active().group?.code === this.room.groupCode) progress.recordMatchPoints(res.deltas?.[me] || 0);
    }
  }

  showReveal() {
    const t = this.turn;
    if (!t || !t.wordId) return;
    this.reveal?.remove();
    const w = vocabWord(t.wordId);
    const blank = this.engine.isBlank();
    const drawingUrl = this.engine.toDataURL('image/jpeg', 0.5, 0.82);
    if (!this.savedTurns.has(t.index)) {
      this.savedTurns.add(t.index);
      this.recordLearning(t);
      if (!blank) saveDrawing({ wordId: t.wordId, dataUrl: drawingUrl, drawer: this.name(t.drawerId), mode: this.s.mode, guessed: t.guessedIds.length });
    }
    if (w) setTimeout(() => autoSpeak(w.en), 250);
    const deltas = Object.entries(t.deltas).sort((a, b) => b[1] - a[1]);
    this.readyLabel = h('span.small.muted');
    this.revealCountdown = h('span.small.muted');
    const cont = h('button.btn.primary.big', { onclick: () => {
      cont.disabled = true;
      cont.textContent = tr('Đang chờ người khác…');
      if (this.local) for (const p of this.players) this.s.send({ type: 'ready' }, p.id);
      else this.s.send({ type: 'ready' });
    } }, tr('Tiếp tục'), icon('next', { size: 20 }));
    const box = h('div.dialog.wide', { role: 'dialog', 'aria-label': tr('Kết quả lượt') },
      h('div.reveal-head', h('div.reason', REASONS[t.reason] || ''), h('h2', { style: { fontSize: '40px', margin: '4px 0' } }, w ? w.en : t.word),
        w ? h('div.row', { style: { justifyContent: 'center' } }, h('span.ipa', w.ipa), h('button.btn.small', { onclick: () => speak(w.en), 'aria-label': tr('Nghe phát âm') }, icon('volume', { size: 16 }), 'Nghe'), h('span.meaning', { style: { margin: 0 } }, w.vi)) : null),
      h('div.reveal',
        h('div', w?.images?.length ? photoFigure(w) : null, w?.ex ? h('div.example', h('div', w.ex[0]), h('div.vi', w.ex[1])) : null,
          w?.easy ? h('div.notice', icon('star', { size: 18 }), h('span', tr('Từ thông dụng – không tính vào tiến độ học'))) : null),
        h('div',
          h('h3', tr('Bức tranh vừa vẽ')),
          h('div.drawing-frame', blank ? h('div.muted', { style: { padding: '30px', textAlign: 'center' } }, tr('(Bảng vẽ trống)')) : h('img', { src: drawingUrl, alt: tr('Tranh của ') + this.name(t.drawerId) })),
          h('div.small.muted.with-ic', { style: { marginTop: '4px' } }, blank ? '' : [icon('check', { size: 14 }), tr('Đã lưu')]),
          h('h3', { style: { marginTop: '12px' } }, tr('Điểm lượt này')),
          h('ul.deltas', deltas.map(([id, pts]) => h('li', h('span.with-ic', avatar(this.name(id), this.players.find((p) => p.id === id)?.avatar, 22), this.name(id) + (id === t.drawerId ? ' ' + tr('(vẽ)') : '')), h('span.plus', pts > 0 ? `+${pts}` : '0')))),
          t.assist ? h('div.small.muted', tr('Trợ lý cấp {lv} · tối đa {p}%', { lv: t.assist, p: Math.round(t.assistMult * 100) })) : null)),
      h('div.dialog-actions', { style: { alignItems: 'center' } }, this.readyLabel, this.revealCountdown, cont));
    this.reveal = h('div.dialog-layer.room-dialog', box);
    document.body.append(this.reveal);
  }

  showFinal(ranking, note) {
    this.finalBox?.remove();
    const top = ranking.slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean);
    const isHost = this.local || (this.room && this.room.hostId === this.s.me());
    const box = h('div.dialog.wide', { role: 'dialog', 'aria-label': tr('Bảng xếp hạng') },
      h('div.final-head', icon('trophy', { size: 44 }), h('h2', tr('Kết thúc trận!'))),
      note ? h('p.muted', { style: { textAlign: 'center' } }, note) : null,
      h('div.podium', order.map((p) => h('div.p.r' + p.rank, avatar(p.name, p.avatar, 52), h('div', p.name), h('div.block', '#' + p.rank), h('div.small', p.score + tr(' điểm'))))),
      h('ol.ranking', ranking.map((p) => h('li', h('span', '#' + p.rank), h('span.with-ic', avatar(p.name, p.avatar, 24), p.name), h('span', p.score + tr(' điểm'))))),
      h('div.dialog-actions',
        h('a.btn', { href: '#/review' , onclick: () => { this.s.leave(); this.destroy(); } }, icon('repeat', { size: 18 }), tr('Ôn tập')),
        h('button.btn', { onclick: () => { this.s.leave(); this.exit(); } }, icon('home', { size: 18 }), tr('Về trang chủ')),
        isHost && !this.local ? h('button.btn.primary', { onclick: () => this.s.send({ type: 'restart' }) }, icon('repeat', { size: 18 }), tr('Chơi lại')) : null,
        this.local ? h('button.btn.primary', { onclick: () => { this.s.leave(); this.destroy(); this.opts.onReplay?.(); } }, icon('repeat', { size: 18 }), tr('Chơi lại')) : null));
    this.finalBox = h('div.dialog-layer.room-dialog', box);
    document.body.append(this.finalBox);
  }
}

function copy(text, msg) {
  (navigator.clipboard?.writeText(text) || Promise.reject())
    .then(() => toast(msg, 'good'))
    .catch(() => toast(text));
}

export { LIMITS };
