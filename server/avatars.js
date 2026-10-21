// Drawn avatars: small PNGs stored by content hash, so an avatar key ("p" + 16 hex) can travel
// through rooms and study groups like the colour keys ("c0"…"c11") do, and browsers cache the image.
// The PNGs live in the server's key-value store (store.js) as "avatars/<hash>.png".

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const AVATAR_KEY_RE = /^(c\d{1,2}|p[0-9a-f]{16})$/;
export const MAX_AVATAR_BYTES = 24_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const avatarKey = (buf) => 'p' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const storeKey = (key) => `avatars/${key.slice(1)}.png`;
const COUNT_KEY = 'avatars/count.json';

export class AvatarStore {
  constructor(store, { maxFiles = 20_000 } = {}) {
    this.store = store;
    this.maxFiles = maxFiles;
    // The number of PNGs is saved alongside them, so a restart does not have to list them all.
    this.count = Number(store.get(COUNT_KEY)) || store.keys('avatars/').filter((k) => k.endsWith('.png')).length;
    this.recent = new Map(); // ip -> [timestamps] (simple rate limit)
  }

  /** dataUrl "data:image/png;base64,…" -> key. Throws {status, message} on bad input. */
  save(dataUrl, ip = '') {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw Object.assign(new Error('Ảnh không hợp lệ'), { status: 400 });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_AVATAR_BYTES) throw Object.assign(new Error('Ảnh quá lớn'), { status: 413 });
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) throw Object.assign(new Error('Ảnh không hợp lệ'), { status: 400 });
    const now = Date.now();
    const hits = (this.recent.get(ip) || []).filter((t) => now - t < 3_600_000);
    if (hits.length >= 30) throw Object.assign(new Error('Bạn đổi ảnh quá nhiều, thử lại sau'), { status: 429 });
    hits.push(now);
    this.recent.set(ip, hits);
    const key = avatarKey(buf);
    if (!this.store.get(storeKey(key))) {
      if (this.count >= this.maxFiles) throw Object.assign(new Error('Kho ảnh đã đầy'), { status: 507 });
      this.store.put(storeKey(key), new Uint8Array(buf));
      this.count++;
      this.store.put(COUNT_KEY, String(this.count));
    }
    return key;
  }

  /** The PNG for a "p…" key as a Response, or 404. */
  serve(key) {
    const png = /^p[0-9a-f]{16}$/.test(key) ? this.store.get(storeKey(key)) : null;
    if (!png) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }
}
