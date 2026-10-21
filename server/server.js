// Inklingo on plain Node: static files + the hub (rooms over WebSocket at /ws, the JSON API).
// Used for local development and by the tests; the live site runs the same hub on Cloudflare
// (worker/index.js).
//
//   node server/server.js            -> http://localhost:8787

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { upgrade } from './ws.js';
import { createHub } from './hub.js';
import { fileStore } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// Saved data (groups.json, fast-board.json, avatars/) lives next to GROUPS_FILE.
const GROUPS_FILE = process.env.GROUPS_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data', 'groups.json');
const DATA_DIR = path.dirname(GROUPS_FILE);
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
};

/** A file of the website as a Response (the hub reads quiz photos this way). */
async function readAsset(rel) {
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return new Response(null, { status: 403 });
  try {
    const buf = await fs.promises.readFile(file);
    return new Response(buf, { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

const hub = createHub({
  vocab: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'vocab.json'), 'utf8')),
  store: fileStore(DATA_DIR),
  readAsset,
  devDates: process.env.SW_DEV === '1',
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { hub.flush(); process.exit(0); });

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

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request('http://localhost' + req.url, {
      method: req.method, headers: req.headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: 'half',
    });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    const r = await hub.api(request, ip);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
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
  const peer = hub.connect(conn);
  conn.on('message', (m) => peer.message(m));
  conn.on('close', () => peer.close());
});

// Heartbeat: drop sockets that stopped answering pings.
setInterval(() => {
  for (const conn of hub.sockets()) {
    if (!conn.alive) { conn.terminate(); continue; }
    conn.alive = false;
    conn.ping();
  }
}, 20_000);

server.listen(PORT, () => console.log(`Inklingo running at http://localhost:${PORT}`));
