// Локальное хранилище (IndexedDB) — основной источник данных для интерфейса при отсутствии связи.
// Чувствительные записи (решения, очередь синхронизации) шифруются AES-GCM 256 неизвлекаемым ключом устройства.
// Промышленная версия: Room + SQLCipher / Android Keystore (см. docs/architecture.md).

const DB_NAME = 'toro-assistant';
const DB_VERSION = 1;
const STORES = {
  machines: 'id', history: 'id', defects: 'id', analyses: 'id',
  decisions: 'id', outbox: 'id', journal: 'seq', meta: 'key',
};

let dbPromise;
export function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, name === 'journal' ? { keyPath, autoIncrement: true } : { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  }));
}

export const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value));
export const putMany = (store, values) => tx(store, 'readwrite', (s) => values.forEach((v) => s.put(v)));
export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ---------- Шифрование ----------
let keyPromise;
async function deviceKey() {
  if (!globalThis.crypto?.subtle) return null; // небезопасный контекст (не https/localhost)
  keyPromise ??= (async () => {
    const saved = await get('meta', 'deviceKey');
    if (saved?.value) return saved.value;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await put('meta', { key: 'deviceKey', value: key });
    return key;
  })();
  return keyPromise;
}

export async function seal(obj) {
  const key = await deviceKey();
  const data = new TextEncoder().encode(JSON.stringify(obj));
  if (!key) return { enc: false, data: JSON.stringify(obj) };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { enc: true, iv: Array.from(iv), ct: new Uint8Array(ct) };
}

export async function unseal(box) {
  if (!box.enc) return JSON.parse(box.data);
  const key = await deviceKey();
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(box.iv) }, key, box.ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function sha256Hex(str) {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Журнал событий ----------
export async function log(event, details = {}) {
  const user = (await get('meta', 'user'))?.value ?? 'unknown';
  await put('journal', { ts: new Date().toISOString(), event, user, details });
}

export async function journalTail(n = 15) {
  const items = await all('journal');
  return items.slice(-n).reverse();
}

// ---------- Метаданные ----------
export const getMeta = async (key, fallback = null) => (await get('meta', key))?.value ?? fallback;
export const setMeta = (key, value) => put('meta', { key, value });

// ---------- Очередь синхронизации ----------
export async function enqueue(type, payload) {
  const id = uuid();
  const hash = await sha256Hex(JSON.stringify(payload));
  await put('outbox', { id, type, createdAt: new Date().toISOString(), hash, sealed: await seal(payload), attempts: 0 });
  await log('OUTBOX_ENQUEUED', { id, type });
  return id;
}
