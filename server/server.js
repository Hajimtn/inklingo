// Inklingo server: static files + realtime rooms over WebSocket (/ws).
// The server is authoritative for turns, timer, answer checking and scoring (see game-core.js).
//
//   node server/server.js            -> http://localhost:8787

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { upgrade } from './ws.js';
import { GameRoom } from '../public/js/shared/game-core.js';
import { GroupStore, GroupError } from './groups.js';
import { AvatarStore, AVATAR_KEY_RE } from './avatars.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const GROUPS_FILE = process.env.GROUPS_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data', 'groups.json');
const AVATAR_DIR = process.env.AVATAR_DIR || path.join(path.dirname(GROUPS_FILE), 'avatars');
const PORT = Number(process.env.PORT) || 8787;
const RECONNECT_GRACE_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 120_000;

// ---------------------------------------------------------------- dictionary

const vocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'vocab.json'), 'utf8'));
function loadDictionary() {
  const dict = new Map();
  for (const topic of vocab.topics) {
    for (const w of topic.words) dict.set(w.id, { id: w.id, en: w.en, answers: [w.en, ...(w.alt || [])], topic: topic.id });
  }
  return dict;
}
let dictionary = loadDictionary();
console.log(`[vocab] ${dictionary.size} words loaded`);

const avatars = new AvatarStore(AVATAR_DIR);

// ---------------------------------------------------------------- study groups

const memberPid = new Map(); // "GROUP:memberId" -> pid of the socket that last spoke for that member
const groups = new GroupStore({
  file: GROUPS_FILE,
  topics: vocab.topics,
  devDates: process.env.SW_DEV === '1',
  send: (key, msg) => sendTo(memberPid.get(key), msg),
});
console.log(`[groups] ${groups.groups.size} groups loaded${groups.devDates ? ' (dev dates on)' : ''}`);
setInterval(() => groups.tick(), 30_000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { groups.flush(); process.exit(0); });

function groupRooms(code) {
  return [...rooms.values()].filter((r) => r.groupCode === code && r.state !== 'ended' && r.connected().length)
    .map((r) => ({ code: r.code, state: r.state, players: r.connected().length }));
}

function groupView(g, memberId, date) {
  return { ...groups.view(g, memberId, groups.today(g, date)), rooms: groupRooms(g.code) };
}

/** POST /api/group/<action> – JSON in, JSON out. */
function groupApi(action, body) {
  const { code, memberId, secret, date } = body;
  if (action === 'create') {
    const cred = groups.create({ name: body.name, member: body.member, tz: body.tz });
    const g = groups.get(cred.code);
    return { ...cred, state: groupView(g, cred.id, date) };
  }
  if (action === 'join') {
    const cred = groups.join(code, { member: body.member });
    return { ...cred, state: groupView(groups.get(cred.code), cred.id, date) };
  }
  const { g, m } = groups.auth(code, memberId, secret);
  const day = groups.today(g, date);
  switch (action) {
    case 'state':
      break;
    case 'report':
      groups.ensureToday(g, day);
      for (const r of (Array.isArray(body.reports) ? body.reports : [body]).slice(0, 50)) groups.report(g, m, r, day);
      break;
    case 'open-quiz':
      groups.ensureToday(g, day);
      groups.openQuiz(g);
      break;
    case 'profile':
      groups.updateMember(m, body.member);
      break;
    case 'kick':
      groups.kick(g, m.id, String(body.target || ''));
      break;
    case 'leave':
      groups.leave(g, m.id);
      return { ok: true };
    default:
      throw new GroupError('Không hỗ trợ', 404);
  }
  return { state: groupView(g, m.id, date) };
}

function readJson(req, limit = 16_384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new GroupError('Dữ liệu quá lớn', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new GroupError('JSON không hợp lệ'));
      }
    });
  });
}

const json = (res, status, obj) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));

/** Quiz photos are served by question number so the file name (= the answer) stays hidden. */
function serveQuizImage(res, [code, quizId, k]) {
  const g = groups.groups.get(code);
  const q = g?.quiz?.id === quizId ? g.quiz.questions[+k] : null;
  if (!q || !q.img) return json(res, 404, { error: 'not found' });
  const file = path.normalize(path.join(ROOT, q.img));
  if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'image/jpeg', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).on('error', () => res.end()).pipe(res);
}

/** Realtime part of the mini-game (live lobby, questions, answers). */
function onGroupQuiz(pid, msg) {
  let ctx;
  try {
    ctx = groups.auth(msg.code, msg.memberId, msg.secret);
  } catch (e) {
    return sendTo(pid, { type: 'gq-error', text: e.message, fatal: true });
  }
  const { g, m } = ctx;
  const key = `${g.code}:${m.id}`;
  memberPid.set(key, pid);
  try {
    switch (msg.action) {
      case 'resume': {
        const run = groups.runOf(g.code, m.id);
        const snap = run?.snapshot(m.id);
        if (snap) return sendTo(pid, snap);
        const lobby = groups.lobbies.get(g.code);
        return sendTo(pid, { type: 'gq-idle', eligible: !!groups.eligible(g, m.id), lobby: lobby ? lobby.members : [], inLobby: !!lobby?.members.includes(m.id) });
      }
      case 'solo':
        return void groups.startSolo(g, m);
      case 'lobby':
        return void groups.joinLobby(g, m);
      case 'unlobby':
        return void groups.leaveLobby(g, m.id);
      case 'live':
        return void groups.startLive(g, m);
      case 'answer': {
        const run = groups.runOf(g.code, m.id);
        if (!run) return sendTo(pid, { type: 'gq-error', text: 'Lượt chơi đã kết thúc' });
        const r = run.answer(m.id, Math.floor(+msg.index), msg.value);
        if (r.error === 'late') sendTo(pid, { type: 'gq-error', text: 'Hết giờ' });
        return;
      }
      case 'skip':
        return void groups.runOf(g.code, m.id)?.skip(m.id);
    }
  } catch (e) {
    sendTo(pid, { type: 'gq-error', text: e instanceof GroupError ? e.message : 'Lỗi máy chủ' });
    if (!(e instanceof GroupError)) console.error(e);
  }
}

// ---------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.startsWith('/room/')) rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size };
    headers['Cache-Control'] = rel.startsWith('/img/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- rooms

const rooms = new Map(); // code -> GameRoom
const sockets = new Map(); // pid -> conn
const tokens = new Map(); // pid -> secret token (prevents impersonating a reconnecting player)
const membership = new Map(); // pid -> room code
const graceTimers = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  while (rooms.has(c));
  return c;
}

function sendTo(pid, msg) {
  const conn = sockets.get(pid);
  if (conn && conn.open) conn.send(JSON.stringify(msg));
}

function createRoom({ settings, wordIds, isPublic }) {
  const code = newCode();
  const room = new GameRoom({ code, dictionary, wordIds, settings, isPublic, send: sendTo });
  rooms.set(code, room);
  console.log(`[room] ${code} created (${isPublic ? 'public' : 'private'}, ${room.pool.length} words)`);
  return room;
}

function leaveCurrent(pid) {
  const code = membership.get(pid);
  if (!code) return;
  membership.delete(pid);
  rooms.get(code)?.remove(pid);
  scheduleCleanup(code);
}

function scheduleCleanup(code) {
  const room = rooms.get(code);
  if (!room || !room.isEmpty()) return;
  setTimeout(() => {
    const r = rooms.get(code);
    if (r && r.isEmpty()) {
      r.destroy();
      rooms.delete(code);
      console.log(`[room] ${code} closed`);
    }
  }, EMPTY_ROOM_TTL_MS);
}

function joinRoom(pid, room, profile) {
  if (membership.get(pid) !== room.code) leaveCurrent(pid);
  const res = room.join(pid, profile);
  if (res.error) {
    sendTo(pid, { type: 'error', text: res.error });
    return false;
  }
  membership.set(pid, room.code);
  return true;
}

function validWordIds(ids) {
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && dictionary.has(id)).slice(0, 300) : [];
}

function onMessage(conn, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'hello') {
    const pid = String(msg.pid || '').slice(0, 40);
    const token = String(msg.token || '').slice(0, 80);
    if (!/^[a-z0-9_-]{8,40}$/i.test(pid) || token.length < 16) return conn.close();
    if (tokens.has(pid) && tokens.get(pid) !== token) {
      conn.send(JSON.stringify({ type: 'error', text: 'Phiên không hợp lệ.', fatal: true }));
      return conn.close();
    }
    tokens.set(pid, token);
    const old = sockets.get(pid);
    if (old && old !== conn) old.close();
    sockets.set(pid, conn);
    conn.pid = pid;
    clearTimeout(graceTimers.get(pid));
    graceTimers.delete(pid);
    conn.send(JSON.stringify({ type: 'hello', now: Date.now(), room: membership.get(pid) || null }));
    // Automatic rejoin after a dropped connection.
    const code = membership.get(pid);
    if (code && rooms.has(code)) rooms.get(code).join(pid, {});
    return;
  }

  const pid = conn.pid;
  if (!pid) return;
  if (msg.type === 'gq') return onGroupQuiz(pid, msg);
  const profile = { name: String(msg.name || '').trim().slice(0, 18) || 'Player', avatar: AVATAR_KEY_RE.test(msg.avatar) ? msg.avatar : 'c7' };

  switch (msg.type) {
    case 'create': {
      // A room started from the group page counts towards that group's leaderboard.
      let groupCode = null;
      if (msg.group) {
        try {
          groupCode = groups.auth(msg.group.code, msg.group.memberId, msg.group.secret).g.code;
        } catch { /* not a member: plain private room */ }
      }
      const room = createRoom({ settings: msg.settings, wordIds: validWordIds(msg.wordIds), isPublic: false });
      room.groupCode = groupCode;
      joinRoom(pid, room, profile);
      return;
    }
    case 'quick': {
      let room = [...rooms.values()].find((r) => r.isPublic && r.state !== 'ended' && r.players.size < r.settings.maxPlayers && r.connected().length > 0);
      if (!room) room = createRoom({ settings: msg.settings, wordIds: validWordIds(msg.wordIds), isPublic: true });
      joinRoom(pid, room, profile);
      return;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room) return sendTo(pid, { type: 'error', text: `Không tìm thấy phòng ${code || ''}.`.trim() });
      joinRoom(pid, room, profile);
      return;
    }
    case 'leave':
      leaveCurrent(pid);
      sendTo(pid, { type: 'left' });
      return;
    case 'settings':
      if (msg.wordIds) msg.wordIds = validWordIds(msg.wordIds);
      break;
  }
  const code = membership.get(pid);
  const room = code && rooms.get(code);
  if (room) room.handle(pid, msg);
}

function onClose(conn) {
  const pid = conn.pid;
  if (!pid || sockets.get(pid) !== conn) return;
  sockets.delete(pid);
  const code = membership.get(pid);
  const room = code && rooms.get(code);
  if (!room) return;
  room.disconnect(pid);
  graceTimers.set(pid, setTimeout(() => {
    graceTimers.delete(pid);
    if (sockets.has(pid)) return;
    if (membership.get(pid) === code) {
      membership.delete(pid);
      room.remove(pid);
    }
    scheduleCleanup(code);
  }, RECONNECT_GRACE_MS));
  scheduleCleanup(code);
}

// ---------------------------------------------------------------- http

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/group/') && req.method === 'POST') {
    try {
      json(res, 200, groupApi(url.pathname.slice('/api/group/'.length), await readJson(req)));
    } catch (e) {
      if (!(e instanceof GroupError)) console.error(e);
      json(res, e.status || 500, { error: e instanceof GroupError ? e.message : 'Lỗi máy chủ' });
    }
    return;
  }
  if (url.pathname === '/api/avatar' && req.method === 'POST') {
    try {
      const body = await readJson(req, 40_000);
      json(res, 200, { key: avatars.save(body.pic, req.socket.remoteAddress) });
    } catch (e) {
      json(res, e.status || 400, { error: e.message || 'Ảnh không hợp lệ' });
    }
    return;
  }
  if (url.pathname.startsWith('/api/avatar/')) return avatars.serve(res, url.pathname.slice('/api/avatar/'.length));
  if (url.pathname.startsWith('/api/qimg/')) return serveQuizImage(res, url.pathname.slice('/api/qimg/'.length).split('/'));
  if (url.pathname.startsWith('/api/room/')) {
    const code = url.pathname.split('/').pop().toUpperCase();
    const room = rooms.get(code);
    res.writeHead(room ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room ? { code, state: room.state, players: room.players.size, max: room.settings.maxPlayers } : { error: 'not found' }));
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size, words: dictionary.size }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
  const conn = upgrade(req, socket);
  if (!conn) return;
  conn.on('message', (m) => onMessage(conn, m));
  conn.on('close', () => onClose(conn));
});

// Heartbeat: drop sockets that stopped answering pings.
setInterval(() => {
  for (const conn of new Set(sockets.values())) {
    if (!conn.alive) { conn.terminate(); continue; }
    conn.alive = false;
    conn.ping();
  }
}, 20_000);

server.listen(PORT, () => console.log(`Inklingo running at http://localhost:${PORT}`));
