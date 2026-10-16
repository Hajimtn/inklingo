// Unit tests for the shared game rules (run: npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, normalizeAnswer, maskWord, hintCount, guesserPoints, drawerPoints, comboBonus, PRE_MS, REVEAL_MS, DRAWER_GRACE_MS } from '../public/js/shared/game-core.js';

function fakeClock() {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    timers: {
      set: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
      clear: (id) => timers.delete(id),
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

const dict = new Map([
  ['apple', { id: 'apple', en: 'apple', answers: ['apple'] }],
  ['ice-cream', { id: 'ice-cream', en: 'ice cream', answers: ['ice cream', 'icecream'] }],
  ['bus', { id: 'bus', en: 'bus', answers: ['bus'] }],
]);

function setup(n = 3, extra = {}) {
  const clock = fakeClock();
  const inbox = new Map();
  const room = new GameRoom({ code: 'T', dictionary: dict, wordIds: ['apple', 'ice-cream', 'bus'], settings: { rounds: 1, drawTime: 60 }, send: (pid, m) => { if (!inbox.has(pid)) inbox.set(pid, []); inbox.get(pid).push(m); }, now: clock.now, timers: clock.timers, ...extra });
  for (let i = 1; i <= n; i++) room.join('p' + i, { name: 'P' + i });
  return { room, clock, inbox, msgs: (pid, type) => (inbox.get(pid) || []).filter((m) => !type || m.type === type) };
}

test('normalizeAnswer / maskWord', () => {
  assert.equal(normalizeAnswer('  Ice-Cream '), 'icecream');
  assert.equal(normalizeAnswer('ÁPPLE'), 'apple');
  assert.equal(maskWord('ice cream'), '___ _____');
});

test('scoring helpers', () => {
  assert.equal(guesserPoints(1), 200);
  assert.equal(guesserPoints(0), 40);
  assert.equal(comboBonus(1), 0);
  assert.equal(comboBonus(3), 20);
  assert.equal(drawerPoints([200, 100], 0), 150);
  assert.equal(drawerPoints([200, 100], 4), 105); // 70% cap with step-by-step help
});

test('secret word goes only to the drawer; guessers get a mask', () => {
  const { room, clock, msgs } = setup();
  room.start('p1');
  const drawer = room.turn.drawerId;
  for (const pid of ['p1', 'p2', 'p3']) {
    const leaked = JSON.stringify(msgs(pid).filter((m) => m.type !== 'secret')).includes('"word"');
    assert.equal(leaked, false, 'no word field broadcast before reveal');
    assert.equal(msgs(pid, 'secret').length, pid === drawer ? 1 : 0);
  }
  clock.advance(PRE_MS);
  assert.equal(room.turn.phase, 'draw');
  const turnMsg = msgs('p2', 'turn').at(-1).turn;
  assert.equal(turnMsg.mask, '_____');
  assert.equal('wordId' in turnMsg, false);
});

test('guessing: wrong, duplicate, correct, drawer cannot leak, all guessed ends turn', () => {
  const { room, clock, msgs } = setup();
  room.start('p1');
  clock.advance(PRE_MS);
  const drawer = room.turn.drawerId;
  const [g1, g2] = ['p1', 'p2', 'p3'].filter((p) => p !== drawer);
  room.handle(drawer, { type: 'guess', text: 'it is an apple' });
  assert.match(msgs(drawer, 'notice').at(-1).text, /không được tiết lộ/);
  room.handle(g1, { type: 'guess', text: 'banana' });
  room.handle(g1, { type: 'guess', text: 'BANANA ' });
  assert.match(msgs(g1, 'notice').at(-1).text, /đã gửi/);
  clock.advance(15000);
  room.handle(g1, { type: 'guess', text: 'Apple' });
  const got = msgs(g1, 'you-guessed').at(-1);
  assert.equal(got.word, 'apple');
  assert.equal(got.points, guesserPoints(45 / 60));
  room.handle(g1, { type: 'guess', text: 'apple' });
  assert.match(msgs(g1, 'notice').at(-1).text, /đã đoán đúng/);
  room.handle(g2, { type: 'guess', text: 'apple' });
  assert.equal(room.turn.phase, 'reveal');
  const end = msgs(g2, 'turn-end').at(-1).turn;
  assert.equal(end.reason, 'all-guessed');
  assert.equal(end.word, 'apple');
  assert.ok(end.deltas[drawer] > 0, 'drawer earns points when others guess');
});

test('assist level lowers the drawer cap', () => {
  const { room, clock } = setup(2);
  room.start('p1');
  clock.advance(PRE_MS);
  const drawer = room.turn.drawerId;
  const guesser = drawer === 'p1' ? 'p2' : 'p1';
  room.handle(drawer, { type: 'assist', level: 5 });
  room.handle(guesser, { type: 'assist', level: 1 }); // ignored: not the drawer
  assert.equal(room.turn.assist, 5);
  room.handle(guesser, { type: 'guess', text: 'apple' });
  const base = room.turn.base.get(guesser);
  assert.equal(room.turn.result.deltas[drawer], drawerPoints([base], 5));
});

test('combo bonus for consecutive correct guesses', () => {
  const { room, clock } = setup(2, {});
  room.updateSettings({ rounds: 2 });
  room.start('p1');
  const streaks = [];
  for (let i = 0; i < 4; i++) {
    clock.advance(PRE_MS);
    const d = room.turn.drawerId;
    const g = d === 'p1' ? 'p2' : 'p1';
    room.handle(g, { type: 'guess', text: dict.get(room.turn.wordId).en });
    streaks.push(room.players.get(g).streak);
    room.handle('p1', { type: 'ready' });
    room.handle('p2', { type: 'ready' });
  }
  assert.deepEqual(streaks, [1, 1, 2, 2]);
  assert.equal(room.state, 'ended');
});

test('letter hints: one more letter at 50/70/85% of the time while nobody has guessed', () => {
  assert.equal(maskWord('filing cabinet', [0, 7]), 'f_____ c______');
  assert.equal(hintCount('bus'), 0);
  assert.equal(hintCount('stapler'), 2);
  assert.equal(hintCount('filing cabinet'), 3);
  const clock = fakeClock();
  const inbox = new Map();
  const words = new Map([['stapler', { id: 'stapler', en: 'stapler', answers: ['stapler'] }], ['bus', { id: 'bus', en: 'bus', answers: ['bus'] }]]);
  const room = new GameRoom({ code: 'H', dictionary: words, wordIds: ['stapler'], settings: { rounds: 1, drawTime: 60 }, send: (pid, m) => { if (!inbox.has(pid)) inbox.set(pid, []); inbox.get(pid).push(m); }, now: clock.now, timers: clock.timers });
  for (const id of ['p1', 'p2', 'p3']) room.join(id, { name: id });
  room.start('p1');
  const guesser = ['p1', 'p2', 'p3'].find((id) => id !== room.turn.drawerId);
  const mask = () => inbox.get(guesser).filter((m) => m.type === 'turn').at(-1).turn.mask;
  clock.advance(PRE_MS);
  assert.equal(mask(), '_______');
  clock.advance(29_000);
  assert.equal(mask(), '_______', 'no hint before half time');
  clock.advance(1_000);
  assert.equal(mask().replace(/_/g, '').length, 1);
  assert.ok([...mask()].every((c, i) => c === '_' || c === 'stapler'[i]), 'the hint is a real letter in its place');
  clock.advance(12_000);
  assert.equal(mask().replace(/_/g, '').length, 2);
  room.handle(guesser, { type: 'guess', text: 'stapler' });
  const before = inbox.get(guesser).length;
  clock.advance(9_000); // 85%: someone has guessed, and the word only allows 2 hints anyway
  assert.equal(inbox.get(guesser).filter((m, i) => i >= before && m.type === 'turn').length, 0);
});

test('timer ends the turn and reveal auto-advances', () => {
  const { room, clock } = setup(2);
  room.start('p1');
  clock.advance(PRE_MS + 60000);
  assert.equal(room.turn.phase, 'reveal');
  assert.equal(room.turn.result.reason, 'time');
  clock.advance(REVEAL_MS);
  assert.equal(room.turn.index, 2);
});

test('drawer reconnecting within grace keeps the turn; staying away ends it', () => {
  const { room, clock, msgs } = setup(3);
  room.start('p1');
  clock.advance(PRE_MS);
  const drawer = room.turn.drawerId;
  room.handle(drawer, { type: 'draw', ev: { k: 'op', op: { t: 'stroke', tool: 'brush', color: '#000', size: 5, alpha: 1, pts: [1, 1, 5, 5] } } });
  room.disconnect(drawer);
  clock.advance(DRAWER_GRACE_MS - 1000);
  assert.equal(room.turn.phase, 'draw');
  room.join(drawer, {});
  const w = msgs(drawer, 'welcome').at(-1);
  assert.equal(w.events.length, 1, 'drawer gets the drawing back');
  assert.equal(msgs(drawer, 'secret').length, 2, 'secret re-sent to returning drawer');
  clock.advance(5000);
  assert.equal(room.turn.phase, 'draw');
  room.disconnect(drawer);
  clock.advance(DRAWER_GRACE_MS + 10);
  assert.equal(room.turn.phase, 'reveal');
  assert.equal(room.turn.result.reason, 'drawer-left');
});

test('late joiner receives the drawing log and is added to the turn order', () => {
  const { room, clock, msgs } = setup(2);
  room.start('p1');
  clock.advance(PRE_MS);
  const drawer = room.turn.drawerId;
  room.handle(drawer, { type: 'draw', ev: { k: 'op', op: { t: 'fill', x: 3, y: 3, color: '#f00', alpha: 1 } } });
  room.handle(drawer, { type: 'draw', ev: { k: 'undo' } });
  room.handle(drawer, { type: 'draw', ev: { k: 'lv', id: 1, i: 0, p: [1, 2] } }); // live: relayed, not stored
  room.join('p9', { name: 'Late' });
  const w = msgs('p9', 'welcome').at(-1);
  assert.deepEqual(w.events.map((e) => e.k), ['op', 'undo']);
  assert.ok(room.order.includes('p9'));
  assert.equal(JSON.stringify(w).includes('"word"'), false);
});

test('only the drawer may draw; others are ignored', () => {
  const { room, clock, msgs } = setup(2);
  room.start('p1');
  clock.advance(PRE_MS);
  const drawer = room.turn.drawerId;
  const other = drawer === 'p1' ? 'p2' : 'p1';
  room.handle(other, { type: 'draw', ev: { k: 'op', op: { t: 'clear' } } });
  assert.equal(room.turn.events.length, 0);
  assert.equal(msgs(drawer, 'draw').length, 0);
});

test('quorum grace: a guesser reloading does not end the game', () => {
  const { room, clock } = setup(2);
  room.start('p1');
  clock.advance(PRE_MS);
  const drawer = room.turn.drawerId;
  const other = drawer === 'p1' ? 'p2' : 'p1';
  room.disconnect(other);
  clock.advance(3000);
  assert.equal(room.state, 'playing');
  room.join(other, {});
  clock.advance(20000);
  assert.equal(room.state, 'playing');
  room.disconnect(other);
  clock.advance(16000);
  assert.equal(room.state, 'ended');
});

test('same-device mode waits for the drawer to start the clock', () => {
  const { room, clock } = setup(2, { local: true });
  room.start('p1');
  clock.advance(PRE_MS * 3);
  assert.equal(room.turn.phase, 'pre');
  room.handle(room.turn.drawerId, { type: 'begin' });
  assert.equal(room.turn.phase, 'draw');
});
