// The Inklingo server logic, independent of where it runs: realtime rooms over WebSocket, study
// groups, the Quick Learn board, drawn avatars and the small JSON API. The server is
// authoritative for turns, timer, answer checking and scoring (see game-core.js).
//
// Two hosts use it:
//   server/server.js  – plain Node (local development and the tests): files on disk, own WebSocket
//   worker/index.js   – Cloudflare Workers: one Durable Object holds the hub, its storage the data
//
// createHub() takes the vocabulary, a key-value store (store.js) and a function that reads a file
// of the website (for the quiz photos). It returns
//   api(request, ip)  -> Promise<Response | null>   (null: not an /api/ path)
//   connect(conn)     -> { message(text), close() }  for each WebSocket; conn = { send(text), close() }
//   flush()           – write pending data now

import crypto from 'node:crypto';
import { GameRoom } from '../public/js/shared/game-core.js';
import { GroupStore, GroupError } from './groups.js';
import { AvatarStore, AVATAR_KEY_RE } from './avatars.js';
import { FastBoard, BoardError } from './fast-board.js';

const RECONNECT_GRACE_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 120_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function readJson(request, limit = 16_384) {
  const text = await request.text();
  if (text.length > limit) throw new HttpError('Dữ liệu quá lớn', 413);
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError('JSON không hợp lệ');
  }
}

/**
 * @param {object} o
 *  vocab      – parsed public/data/vocab.json
 *  store      – key-value store for groups, the Quick Learn board and avatars
 *  readAsset  – (path like "img/x.webp") -> Promise<Response> (a file of the website)
 *  devDates   – let clients pick the group date (tests of the weekly schedule)
 *  version, log
 */
export function createHub({ vocab, store, readAsset, devDates = false, version = 'dev', log = console.log }) {
  const startedAt = new Date().toISOString();

  // ------------------------------------------------------------ dictionary

  const dictionary = new Map();
  for (const topic of vocab.topics) {
    for (const w of topic.words) dictionary.set(w.id, { id: w.id, en: w.en, answers: [w.en, ...(w.alt || [])], topic: topic.id });
  }
  for (const w of vocab.easy?.words || []) dictionary.set(w.id, { id: w.id, en: w.en, answers: [w.en, ...(w.alt || [])], topic: 'easy' });
  // Easy everyday words: one of the three word cards in every room, or the whole pool of an easy room.
  const easyIds = (vocab.easy?.words || []).map((w) => w.id);
  log(`[vocab] ${dictionary.size} words loaded (${easyIds.length} easy)`);

  const avatars = new AvatarStore(store);
  // Public Quick Learn leaderboard (fast mode, one board per topic).
  const fastBoard = new FastBoard({ store, topics: vocab.topics.map((t) => t.id) });

  // ------------------------------------------------------------ rooms (state)

  const rooms = new Map(); // code -> GameRoom
  const sockets = new Map(); // pid -> conn
  const tokens = new Map(); // pid -> secret token (prevents impersonating a reconnecting player)
  const membership = new Map(); // pid -> room code
  const graceTimers = new Map();

  function sendTo(pid, msg) {
    const conn = sockets.get(pid);
    if (conn && conn.open) conn.send(JSON.stringify(msg));
  }

  // ------------------------------------------------------------ study groups

  const memberPid = new Map(); // "GROUP:memberId" -> pid of the socket that last spoke for that member
  const groups = new GroupStore({
    store,
    topics: vocab.topics,
    devDates,
    send: (key, msg) => sendTo(memberPid.get(key), msg),
  });
  log(`[groups] ${groups.groups.size} groups loaded${groups.devDates ? ' (dev dates on)' : ''}`);
  setInterval(() => groups.tick(), 30_000);

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
      case 'rename':
        groups.rename(g, m.id, body.name);
        break;
      case 'leave':
        groups.leave(g, m.id);
        return { ok: true };
      default:
        throw new GroupError('Không hỗ trợ', 404);
    }
    return { state: groupView(g, m.id, date) };
  }

  /** Quiz photos are served by question number so the file name (= the answer) stays hidden. */
  async function quizImage([code, quizId, k]) {
    const g = groups.groups.get(code);
    const q = g?.quiz?.id === quizId ? g.quiz.questions[+k] : null;
    if (!q || !q.img || q.img.includes('..')) return json(404, { error: 'not found' });
    const file = await readAsset(q.img.replace(/^\/+/, ''));
    if (!file.ok) return json(404, { error: 'not found' });
    return new Response(file.body, { headers: { 'Content-Type': file.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'no-store' } });
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

  // ------------------------------------------------------------ rooms

  function newCode() {
    let c;
    do c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    while (rooms.has(c));
    return c;
  }

  function createRoom({ settings, wordIds, isPublic }) {
    const code = newCode();
    const room = new GameRoom({ code, dictionary, wordIds, easyIds, settings, isPublic, send: sendTo });
    rooms.set(code, room);
    log(`[room] ${code} created (${isPublic ? 'public' : 'private'}, ${room.pool.length} words)`);
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
        log(`[room] ${code} closed`);
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
        const room = createRoom({ settings: msg.settings, wordIds: msg.easy ? easyIds : validWordIds(msg.wordIds), isPublic: false });
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
    conn.open = false;
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

  // ------------------------------------------------------------ http api

  async function api(request, ip = '') {
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return null;
    try {
      if (p.startsWith('/api/group/') && request.method === 'POST') {
        const out = groupApi(p.slice('/api/group/'.length), await readJson(request));
        // Saved before answering: on Cloudflare the object may be unloaded soon after a request.
        groups.flush();
        return json(200, out);
      }
      if (p === '/api/avatar' && request.method === 'POST') {
        const body = await readJson(request, 40_000);
        return json(200, { key: avatars.save(body.pic, ip) });
      }
      if (p.startsWith('/api/fast/')) {
        const action = p.slice('/api/fast/'.length);
        if (action === 'top' && request.method === 'GET') return json(200, { top: fastBoard.top(url.searchParams.get('topic') || '') });
        if (request.method !== 'POST') throw new BoardError('Không hỗ trợ', 405);
        const body = await readJson(request);
        if (action === 'start') return json(200, fastBoard.start(String(body.topic || '')));
        if (action === 'score') return json(200, fastBoard.submit(body, ip));
        throw new BoardError('Không hỗ trợ', 404);
      }
      if (p.startsWith('/api/avatar/')) return avatars.serve(p.slice('/api/avatar/'.length));
      if (p.startsWith('/api/qimg/')) return await quizImage(p.slice('/api/qimg/'.length).split('/'));
      if (p.startsWith('/api/room/')) {
        const code = p.split('/').pop().toUpperCase();
        const room = rooms.get(code);
        return json(room ? 200 : 404, room ? { code, state: room.state, players: room.players.size, max: room.settings.maxPlayers } : { error: 'not found' });
      }
      if (p === '/api/health') return json(200, { ok: true, rooms: rooms.size, words: dictionary.size, version, startedAt });
      return json(404, { error: 'not found' });
    } catch (e) {
      const known = e instanceof GroupError || e instanceof BoardError || e instanceof HttpError || e.status;
      if (!known) console.error(e);
      return json(e.status || 500, { error: known ? e.message : 'Lỗi máy chủ' });
    }
  }

  return {
    api,
    connect(conn) {
      conn.open = true;
      return { message: (text) => onMessage(conn, text), close: () => onClose(conn) };
    },
    /** Live sockets (the Node host pings them). */
    sockets: () => new Set(sockets.values()),
    flush: () => groups.flush(),
  };
}
