// Minimal dependency-free WebSocket server (RFC 6455): text frames, ping/pong, close,
// fragmentation and 16/64-bit payload lengths. Enough for JSON game messages.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 4 * 1024 * 1024;

export class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.open = true;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.terminate();
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD || !masked) return this.terminate(); // clients must mask
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._frame(fin, opcode, payload);
    }
  }

  _frame(fin, opcode, payload) {
    switch (opcode) {
      case 0x0: // continuation
      case 0x1: // text
      case 0x2: // binary
        this.fragments.push(payload);
        if (fin) {
          const data = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          this.emit('message', data);
        }
        break;
      case 0x8:
        this._send(0x8, payload.subarray(0, 2));
        this.socket.end();
        this._closed();
        break;
      case 0x9:
        this._send(0xa, payload);
        break;
      case 0xa:
        this.alive = true;
        break;
      default:
        this.terminate();
    }
  }

  _send(opcode, data) {
    if (!this.open || this.socket.destroyed) return;
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, data]));
  }

  send(text) {
    this._send(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this._send(0x9, Buffer.alloc(0));
  }

  close() {
    this._send(0x8, Buffer.from([0x03, 0xe8]));
    this.socket.end();
    this._closed();
  }

  terminate() {
    this.socket.destroy();
    this._closed();
  }
}

/** Handles an HTTP upgrade request; returns a WSConnection or null. */
export function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WSConnection(socket);
}
