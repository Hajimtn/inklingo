// Integration test: real server process + real WebSocket clients (run: npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/vocab.json'), 'utf8'));
const words = vocab.topics.flatMap((t) => t.words);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The WebSocket clients below use the global WebSocket of Node 22+. On older Node versions those
// tests are skipped (the server itself does not need it), so a build never fails for that reason.
const WS = typeof WebSocket === 'function' ? {} : { skip: 'no global WebSocket in this Node version (needs Node 22+)' };

let server;
test.before(async () => {
  // Dev dates let the test walk through a topic's weekly schedule; groups go to a temp file.
  const GROUPS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sw-srv-')), 'groups.json');
  server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SW_DEV: '1', GROUPS_FILE }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('running')) resolve(); });
    server.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
test.after(() => server?.kill());

class Client {
  constructor(name) {
    this.name = name;
    this.pid = 'test' + Math.random().toString(36).slice(2, 12);
    this.token = 'tok'.repeat(8) + Math.random();
    this.msgs = [];
    this.raw = [];
  }
  open() {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'hello', pid: this.pid, token: this.token }));
      this.ws.onmessage = (e) => {
        this.raw.push(e.data);
        const m = JSON.parse(e.data);
        this.msgs.push(m);
        if (m.type === 'hello') resolve(this);
      };
    });
  }
  send(m) { this.ws.send(JSON.stringify({ name: this.name, ...m })); }
  last(type) { return this.msgs.filter((m) => m.type === type).at(-1); }
  async wait(pred, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = this.msgs.find(pred);
      if (hit) return hit;
      await sleep(25);
    }
    throw new Error(`${this.name}: timeout waiting`);
  }
  close() { this.ws.close(); }
}

test('full online turn over WebSocket: secrecy, realtime drawing, scoring', WS, async () => {
  const [a, b, c] = await Promise.all([new Client('Alice').open(), new Client('Bob').open(), new Client('Cara').open()]);
  a.send({ type: 'create', wordIds: words.slice(0, 3).map((w) => w.id), settings: { rounds: 1, drawTime: 60 } });
  const welcome = await a.wait((m) => m.type === 'welcome');
  const code = welcome.room.code;
  assert.match(code, /^[A-Z2-9]{5}$/);
  b.send({ type: 'join', code });
  c.send({ type: 'join', code });
  await a.wait((m) => m.type === 'players' && m.players.length === 3);
  a.send({ type: 'start' });
  const turn = (await a.wait((m) => m.type === 'turn')).turn;
  const clients = { [a.pid]: a, [b.pid]: b, [c.pid]: c };
  const drawer = clients[turn.drawerId];
  const guessers = Object.values(clients).filter((x) => x !== drawer);
  const secret = await drawer.wait((m) => m.type === 'secret');
  const word = words.find((w) => w.id === secret.wordId);
  assert.ok(word);
  await drawer.wait((m) => m.type === 'turn' && m.turn.phase === 'draw', 6000);

  // Nothing a guesser received so far contains the secret word or its id.
  for (const g of guessers) {
    const all = g.raw.join('\n').toLowerCase();
    assert.equal(all.includes(`"${word.id}"`), false, 'word id leaked to guesser');
    assert.equal(g.msgs.some((m) => m.type === 'secret'), false);
  }

  // Realtime drawing relay
  const op = { t: 'stroke', tool: 'brush', color: '#123456', size: 9, alpha: 1, pts: [10, 10, 200, 200] };
  drawer.send({ type: 'draw', ev: { k: 'op', op } });
  const relayed = await guessers[0].wait((m) => m.type === 'draw');
  assert.deepEqual(relayed.ev.op, op);

  // A guesser trying to draw is ignored
  guessers[0].send({ type: 'draw', ev: { k: 'op', op: { t: 'clear' } } });
  await sleep(150);
  assert.equal(guessers[1].msgs.filter((m) => m.type === 'draw').length, 1);

  // Wrong guess is visible to everyone; correct guess is not echoed as chat
  guessers[0].send({ type: 'guess', text: 'definitely-wrong' });
  await guessers[1].wait((m) => m.type === 'chat' && m.text === 'definitely-wrong');
  guessers[0].send({ type: 'guess', text: word.en.toUpperCase() });
  const yg = await guessers[0].wait((m) => m.type === 'you-guessed');
  assert.ok(yg.points >= 40);
  const g1 = await guessers[1].wait((m) => m.type === 'guessed');
  assert.equal(JSON.stringify(g1).toLowerCase().includes(word.en.toLowerCase()), false, 'correct answer not broadcast');
  assert.equal(guessers[1].raw.join('\n').toLowerCase().includes(`"${word.id}"`), false);

  // Late joiner mid-turn receives the drawing log but not the word
  const d = await new Client('Dan').open();
  d.send({ type: 'join', code });
  const dw = await d.wait((m) => m.type === 'welcome');
  assert.equal(dw.events.length, 1);
  assert.equal(JSON.stringify(dw).includes(`"${word.id}"`), false);

  // Remaining guessers finish -> turn-end reveals the word to all
  guessers[1].send({ type: 'guess', text: word.en });
  d.send({ type: 'guess', text: word.en });
  const end = await a.wait((m) => m.type === 'turn-end');
  assert.equal(end.turn.wordId, word.id);
  assert.ok(end.turn.deltas[drawer.pid] > 0);
  for (const x of [a, b, c, d]) x.close();
});

test('reconnect with the same id keeps the seat; wrong token is rejected', WS, async () => {
  const a = await new Client('Host').open();
  const b = await new Client('Guest').open();
  a.send({ type: 'create', wordIds: [words[0].id] });
  const code = (await a.wait((m) => m.type === 'welcome')).room.code;
  b.send({ type: 'join', code });
  await a.wait((m) => m.type === 'players' && m.players.length === 2);
  b.close();
  await a.wait((m) => m.type === 'players' && m.players.some((p) => !p.connected));
  const b2 = new Client('Guest');
  b2.pid = b.pid;
  b2.token = b.token;
  await b2.open();
  const w = await b2.wait((m) => m.type === 'welcome');
  assert.equal(w.room.code, code);
  assert.equal(w.room.players.length, 2);
  const evil = new Client('Evil');
  evil.pid = b.pid;
  evil.token = 'x'.repeat(30);
  await new Promise((resolve) => {
    evil.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    evil.ws.onopen = () => evil.ws.send(JSON.stringify({ type: 'hello', pid: evil.pid, token: evil.token }));
    evil.ws.onmessage = (e) => { evil.msgs.push(JSON.parse(e.data)); };
    evil.ws.onclose = resolve;
  });
  assert.ok(evil.msgs.some((m) => m.type === 'error' && m.fatal));
  a.close();
  b2.close();
});

test('quick play puts players into the same public room; unknown code errors', WS, async () => {
  const a = await new Client('Q1').open();
  const b = await new Client('Q2').open();
  a.send({ type: 'quick', wordIds: [words[0].id] });
  const wa = await a.wait((m) => m.type === 'welcome');
  b.send({ type: 'quick', wordIds: [words[1].id] });
  const wb = await b.wait((m) => m.type === 'welcome');
  assert.equal(wa.room.code, wb.room.code);
  assert.equal(wb.room.isPublic, true);
  b.send({ type: 'join', code: 'ZZZZZ' });
  const err = await b.wait((m) => m.type === 'error');
  assert.match(err.text, /Không tìm thấy phòng/);
  a.close();
  b.close();
});

test('static files and health endpoint', async () => {
  const r = await fetch(`http://localhost:${PORT}/api/health`);
  assert.equal(r.status, 200);
  const page = await fetch(`http://localhost:${PORT}/`);
  assert.match(await page.text(), /Inklingo/);
  const trav = await fetch(`http://localhost:${PORT}/..%2f..%2fpackage.json`);
  assert.notEqual(trav.status, 200);
});

const api = async (action, body) => {
  const r = await fetch(`http://localhost:${PORT}/api/group/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

test('study group over HTTP + mini-game over WebSocket: shared words, no answer leaks', WS, async () => {
  const a = await api('create', { name: 'Nhóm test', member: { name: 'An', avatar: 'c1' }, tz: 420, date: '2026-10-12' });
  assert.equal(a.status, 200);
  const b = await api('join', { code: a.code, member: { name: 'Bình' }, date: '2026-10-12' });
  assert.deepEqual(b.state.todayBatch, a.state.todayBatch, 'same words for both members');
  assert.equal((await api('state', { code: a.code, memberId: a.id, secret: 'nope' })).status, 403);
  // Learn the whole first topic (weekdays only, 5 words a day).
  let st = a.state;
  for (let d = Date.UTC(2026, 9, 13), n = 0; st.phase !== 'quiz-ready' && n < 30; d += 864e5) {
    if ([0, 6].includes(new Date(d).getUTCDay())) continue;
    const day = new Date(d).toISOString().slice(0, 10);
    st = (await api('report', { code: a.code, memberId: a.id, secret: a.secret, date: day, reports: [{ kind: 'learned' }] })).state;
    n++;
  }
  assert.equal(st.phase, 'quiz-ready');
  assert.ok(st.members.find((m) => m.id === a.id).total > 0);
  st = (await api('open-quiz', { code: a.code, memberId: a.id, secret: a.secret })).state;
  assert.equal(st.phase, 'quiz-open');

  const c = await new Client('An').open();
  const auth = { type: 'gq', code: a.code, memberId: a.id, secret: a.secret };
  c.send({ ...auth, action: 'resume' });
  assert.equal((await c.wait((m) => m.type === 'gq-idle')).eligible, true);
  c.send({ ...auth, action: 'solo' });
  const q = await c.wait((m) => m.type === 'gq-question');
  const raw = c.raw.find((r) => r.includes('"gq-question"'));
  assert.ok(!raw.includes('"en"') && !raw.includes('"wordId"') && !raw.includes('img/w/'), 'question must not reveal the answer');
  const img = await fetch(`http://localhost:${PORT}/${q.q.img}`);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  c.send({ ...auth, action: 'answer', index: 0, value: q.q.options[0] });
  const rev = await c.wait((m) => m.type === 'gq-reveal');
  assert.equal(rev.you.ok, rev.answer.en === q.q.options[0]);
  const bad = await new Client('Mallory').open();
  bad.send({ ...auth, secret: 'wrong', action: 'solo' });
  assert.equal((await bad.wait((m) => m.type === 'gq-error')).fatal, true);
  c.close();
  bad.close();
});
