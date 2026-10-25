// Tiny IndexedDB wrapper. Everything (plants, care log, photos, settings) lives on the device.
const DB_NAME = 'plant-care';
const STORES = ['plants', 'events', 'photos', 'meta'];
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('plants', { keyPath: 'id' });
      db.createObjectStore('events', { keyPath: 'id' }).createIndex('plantId', 'plantId');
      db.createObjectStore('photos', { keyPath: 'id' }).createIndex('plantId', 'plantId');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const result = await fn(t.objectStore(store));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

export const db = {
  all: store => tx(store, 'readonly', s => wrap(s.getAll())),
  get: (store, key) => tx(store, 'readonly', s => wrap(s.get(key))),
  put: (store, value) => tx(store, 'readwrite', s => wrap(s.put(value))),
  del: (store, key) => tx(store, 'readwrite', s => wrap(s.delete(key))),
  async getMeta(key, fallback) {
    const row = await this.get('meta', key);
    return row ? row.value : fallback;
  },
  setMeta: (key, value) => db.put('meta', { key, value }),
  async replaceAll(data) {
    const d = await open();
    const t = d.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      const s = t.objectStore(name);
      s.clear();
      for (const row of data[name] || []) s.put(row);
    }
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
};
