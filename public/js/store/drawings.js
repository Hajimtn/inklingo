// Finished drawings (one per turn) kept in IndexedDB and linked to their word.
// They become the player's own flashcards in Review.

const DB = 'scribble-words';
const STORE = 'drawings';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('wordId', 'wordId');
      s.createIndex('at', 'at');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
  }));
}

/** @param {{wordId:string, dataUrl:string, drawer:string, mode:string, guessed:number}} d */
export async function saveDrawing(d) {
  const rec = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), ...d };
  try {
    await tx('readwrite', (s) => s.put(rec));
    return rec;
  } catch {
    return null;
  }
}

export async function listDrawings() {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function drawingsFor(wordId) {
  try {
    const all = await tx('readonly', (s) => s.index('wordId').getAll(wordId));
    return (all || []).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function deleteDrawing(id) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}
