// Минимальная обёртка над IndexedDB. Картинки храним как Blob — localStorage не подходит.
const DB_NAME = 'yourcloset';
const DB_VER = 1;
export const STORES = ['items', 'outfits', 'collections', 'cats', 'calendar', 'trips', 'meta'];

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode) {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function wrap(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}

export const dbAll = s => tx(s, 'readonly').then(o => wrap(o.getAll()));
export const dbGet = (s, id) => tx(s, 'readonly').then(o => wrap(o.get(id)));
export const dbPut = (s, v) => tx(s, 'readwrite').then(o => wrap(o.put(v))).then(() => v);
export const dbDel = (s, id) => tx(s, 'readwrite').then(o => wrap(o.delete(id)));
export const dbClear = s => tx(s, 'readwrite').then(o => wrap(o.clear()));

export function uid(prefix = 'i') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
