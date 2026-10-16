// WebSocket client with automatic reconnect. The player id/token live in sessionStorage so
// a page reload rejoins the same seat, while two tabs act as two different players.

const listeners = new Set();
let ws = null;
let wantOpen = false;
let backoff = 500;
let reconnectTimer = null;
let status = 'idle'; // idle | connecting | open | closed
let offset = 0; // serverTime - localTime
const queue = [];

function ident() {
  let pid = sessionStorage.getItem('sw:pid');
  let token = sessionStorage.getItem('sw:token');
  if (!pid || !token) {
    const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    pid = 'u' + rnd().slice(0, 15);
    token = rnd() + rnd();
    sessionStorage.setItem('sw:pid', pid);
    sessionStorage.setItem('sw:token', token);
  }
  return { pid, token };
}

export const myId = () => ident().pid;
export const serverNow = () => Date.now() + offset;
export const connectionStatus = () => status;

function emit(msg) {
  for (const fn of listeners) fn(msg);
}

export function onMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(s) {
  status = s;
  emit({ type: '_status', status: s });
}

export function connect() {
  wantOpen = true;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(reconnectTimer);
  setStatus('connecting');
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    backoff = 500;
    const { pid, token } = ident();
    ws.send(JSON.stringify({ type: 'hello', pid, token }));
  };
  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      offset = msg.now - Date.now();
      setStatus('open');
      while (queue.length) ws.send(queue.shift());
    }
    if (msg.turn && msg.turn.now) offset = msg.turn.now - Date.now();
    emit(msg);
  };
  ws.onclose = () => {
    ws = null;
    setStatus('closed');
    if (wantOpen) scheduleReconnect();
  };
  ws.onerror = () => {};
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, backoff);
  backoff = Math.min(8000, backoff * 2);
}

export function send(msg) {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN && status === 'open') ws.send(data);
  else {
    queue.push(data);
    connect();
  }
}

export function disconnect() {
  wantOpen = false;
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
  ws = null;
  setStatus('idle');
}

/** Resolves true if the realtime server answers (used to enable online buttons). */
export async function serverAvailable() {
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}
