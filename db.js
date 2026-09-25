/* ============================================================
   db.js — IndexedDB persistence layer
   Chosen over localStorage because iOS Safari restricts
   localStorage in some contexts (e.g. file:// during testing,
   private browsing quotas) and IndexedDB handles larger,
   structured data more reliably across devices.
   ============================================================ */
const DB_NAME = 'federica-agenda-db';
const DB_VERSION = 1;

const STORES = ['categories', 'locations', 'events', 'settings', 'travelCache'];

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const DB = (() => {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('locations')) db.createObjectStore('locations', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('events')) {
          const s = db.createObjectStore('events', { keyPath: 'id' });
          s.createIndex('byDate', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('travelCache')) db.createObjectStore('travelCache', { keyPath: 'id' });
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    const t = db.transaction(storeName, mode);
    return { t, store: t.objectStore(storeName) };
  }

  async function getAll(storeName) {
    const { store } = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, id) {
    const { store } = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, value) {
    const { t, store } = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      store.put(value);
      t.oncomplete = () => resolve(value);
      t.onerror = () => reject(t.error);
    });
  }

  async function remove(storeName, id) {
    const { t, store } = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      store.delete(id);
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  }

  async function clearAll() {
    const db = await open();
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach(s => t.objectStore(s).clear());
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
  }

  return { open, getAll, get, put, remove, clearAll };
})();

const DEFAULT_SETTINGS = {
  id: 'main',
  coefficienteRedditivita: 0.78,   // % di fatturato considerata reddito imponibile (attività professionali/sanitarie)
  aliquotaContributi: 0.2607,      // % di contributi previdenziali sul reddito imponibile
  aliquotaImpostaSostitutiva: 0.05,// 5% primi 5 anni di attività, altrimenti 15%
  homeLocationId: null,
  showHomeTravel: true,
  dayStartHour: 7,
  dayEndHour: 21,
  slotMinutes: 15,
  defaultEventMinutes: 60,
  weekStartsOn: 1, // lunedì
};

const DEFAULT_CATEGORIES = [
  { name: 'Centro clinico', color: '#2F6F6B' },
  { name: 'Studio privato', color: '#B5573F' },
  { name: 'Tutoraggio a domicilio', color: '#C98A3B' },
];

async function ensureSeedData() {
  const settings = await DB.get('settings', 'main');
  if (!settings) {
    await DB.put('settings', { ...DEFAULT_SETTINGS });
  }
  const cats = await DB.getAll('categories');
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await DB.put('categories', {
        id: uid(),
        name: c.name,
        color: c.color,
        defaultRateGross: 30,
        defaultLocationId: null,
        createdAt: Date.now(),
      });
    }
  }
}
