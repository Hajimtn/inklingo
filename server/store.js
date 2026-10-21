// Small synchronous key-value stores for the server's saved data (study groups, the Quick Learn
// board, drawn avatars). The same stores sit behind the Node server (files on disk) and the
// Cloudflare Durable Object (its built-in SQLite key-value storage), so the game code does not
// care where it runs.
//
//   get(key)        -> string | Uint8Array | null
//   put(key, value)    value: string or Uint8Array
//   keys(prefix)    -> [key]

import fs from 'node:fs';
import path from 'node:path';

/** Files under `dir`; a key may contain one "/" (a sub-folder, e.g. "avatars/<hash>.png"). */
export function fileStore(dir) {
  const file = (key) => {
    const f = path.normalize(path.join(dir, key));
    if (!f.startsWith(path.normalize(dir) + path.sep)) throw new Error('bad key ' + key);
    return f;
  };
  return {
    get(key) {
      try {
        const buf = fs.readFileSync(file(key));
        return key.endsWith('.json') ? buf.toString('utf8') : new Uint8Array(buf);
      } catch {
        return null;
      }
    },
    put(key, value) {
      const f = file(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, value);
      fs.renameSync(tmp, f);
    },
    keys(prefix = '') {
      const sub = path.dirname(prefix + 'x');
      try {
        return fs.readdirSync(path.join(dir, sub)).map((n) => (sub === '.' ? n : `${sub}/${n}`)).filter((k) => k.startsWith(prefix) && !k.endsWith('.tmp'));
      } catch {
        return [];
      }
    },
  };
}

/** In memory only (tests). */
export function memoryStore() {
  const m = new Map();
  return {
    get: (key) => (m.has(key) ? m.get(key) : null),
    put: (key, value) => void m.set(key, value),
    keys: (prefix = '') => [...m.keys()].filter((k) => k.startsWith(prefix)),
  };
}
