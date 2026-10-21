// Inklingo on Cloudflare Workers (free plan).
//
// Static files (public/) are served by Workers Static Assets and never reach this code. Only
// /api/* and /ws come here, and go on to a single Durable Object ("main") that holds the whole hub
// (server/hub.js): rooms, study groups, the Quick Learn board and avatars. One object means every
// player meets in the same place, as with the single Node server before. Its saved data lives in
// the object's own SQLite key-value storage.
//
// Free-plan limits that matter: 100 000 Durable Object requests a day (an incoming WebSocket
// message counts as 1/20 of a request) and 13 000 GB-s of duration a day, which one object that
// stays awake around the clock (24 h × 128 MB ≈ 11 000 GB-s) cannot exceed. Over a limit the
// requests fail until 00:00 UTC; nothing is ever charged.

import { DurableObject } from 'cloudflare:workers';
import { createHub } from '../server/hub.js';

/** The store.js interface on top of the object's synchronous key-value storage. */
function kvStore(kv) {
  return {
    get: (key) => kv.get(key) ?? null,
    put: (key, value) => kv.put(key, value),
    keys: (prefix = '') => [...kv.list({ prefix })].map(([k]) => k),
  };
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const readAsset = (rel) => env.ASSETS.fetch(new URL('/' + rel, 'https://assets.local'));
    ctx.blockConcurrencyWhile(async () => {
      const vocab = await (await readAsset('data/vocab.json')).json();
      this.hub = createHub({ vocab, store: kvStore(ctx.storage.kv), readAsset, version: env.VERSION || 'dev', devDates: env.SW_DEV === '1' });
    });
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const conn = {
        send: (text) => {
          try {
            server.send(text);
          } catch { /* already closed */ }
        },
        close: () => {
          try {
            server.close(1000);
          } catch { /* already closed */ }
        },
      };
      const peer = this.hub.connect(conn);
      server.addEventListener('message', (e) => peer.message(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)));
      server.addEventListener('close', () => peer.close());
      server.addEventListener('error', () => peer.close());
      return new Response(null, { status: 101, webSocket: client });
    }
    return (await this.hub.api(request, request.headers.get('CF-Connecting-IP') || '')) || new Response('Not found', { status: 404 });
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws' || pathname.startsWith('/api/')) return env.HUB.get(env.HUB.idFromName('main')).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
