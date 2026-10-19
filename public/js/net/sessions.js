// Session adapters used by the game screen. Both expose the same shape:
//   mode, on(fn), send(msg, asPid?), me(), now(), leave()
// Online: messages go to the authoritative Node server.
// Local (same device, pass-the-device): the same GameRoom rules run inside the page.

import * as online from './online.js';
import { GameRoom } from '../shared/game-core.js';

export function onlineSession() {
  const fns = new Set();
  const off = online.onMessage((m) => fns.forEach((f) => f(m)));
  online.connect();
  return {
    mode: 'online',
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    send: (msg) => online.send(msg),
    me: () => online.myId(),
    now: () => online.serverNow(),
    leave() { online.send({ type: 'leave' }); off(); fns.clear(); },
    detach() { off(); fns.clear(); },
  };
}

// Personal messages are delivered once to their addressee; broadcasts arrive once per player,
// so for the shared screen we keep only the copy addressed to the first seat.
const PERSONAL = new Set(['secret', 'choices', 'you-guessed', 'notice', 'assist', 'error', 'welcome']);

export function localSession({ dictionary, wordIds, easyIds = [], settings, seats }) {
  const fns = new Set();
  const primary = seats[0].id;
  let room;
  const deliver = (pid, msg) => {
    if (PERSONAL.has(msg.type) || pid === primary) {
      const copy = JSON.parse(JSON.stringify(msg));
      copy._to = pid;
      queueMicrotask(() => fns.forEach((f) => f(copy)));
    }
  };
  room = new GameRoom({ code: 'LOCAL', dictionary, wordIds, easyIds, settings, send: deliver, local: true });
  for (const s of seats) room.join(s.id, { name: s.name, avatar: s.avatar });
  return {
    mode: 'local',
    room,
    seats,
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    send: (msg, asPid) => room.handle(asPid || room.hostId, msg),
    me: () => primary,
    now: () => Date.now(),
    leave() { room.destroy(); fns.clear(); },
    detach() { room.destroy(); fns.clear(); },
  };
}
