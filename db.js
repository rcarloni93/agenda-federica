/* ============================================================
   db.js — Firestore-backed persistence (per signed-in Google
   account), replacing the previous device-only IndexedDB store.
   Same external API as before (DB.getAll/get/put/remove), so
   app.js and geo.js need no changes to how they read or write
   data — only where that data physically lives has changed.
   ------------------------------------------------------------
   Offline persistence is handled by Firestore itself (enabled in
   auth.js): the app keeps working without a connection and syncs
   automatically once back online, on every device signed in with
   the same account. Real-time updates from other devices are
   handled separately in sync.js.
   ============================================================ */

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function userCollection(storeName){
  if (!window.CURRENT_UID) throw new Error('Nessun utente autenticato.');
  return firebase.firestore().collection('users').doc(window.CURRENT_UID).collection(storeName);
}

const DB = {
  async getAll(storeName){
    const snap = await userCollection(storeName).get();
    return snap.docs.map(d => d.data());
  },
  async get(storeName, id){
    const doc = await userCollection(storeName).doc(id).get();
    return doc.exists ? doc.data() : null;
  },
  async put(storeName, value){
    await userCollection(storeName).doc(value.id).set(value);
    return value;
  },
  async remove(storeName, id){
    await userCollection(storeName).doc(id).delete();
    return true;
  },
};

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
  viewDays: 7, // 5 = lun-ven, 7 = lun-dom (solo visualizzazione)
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

/* ============================================================
   One-time migration from the old per-device store
   ------------------------------------------------------------
   Before sync existed, data lived only in this browser's
   IndexedDB. The first time a device signs in, if the signed-in
   account is still empty AND this browser happens to have old
   local data, offer to bring it into the account instead of
   silently leaving it stranded.
   ============================================================ */
const OLD_DB_NAME = 'federica-agenda-db';

function openOldIndexedDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OLD_DB_NAME);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      // No old database existed on this device — opening it would have
      // just created an empty one, so back out and treat as "nothing here".
      e.target.transaction.abort();
      reject(new Error('no-old-db'));
    };
  });
}

function readOldStore(db, storeName){
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)){ resolve([]); return; }
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function migrateOldLocalDataIfAny(){
  let oldDb;
  try { oldDb = await openOldIndexedDB(); }
  catch (e) { return; } // nothing on this device — nothing to do

  try {
    const [oldEvents, oldCategories, oldLocations, oldSettings] = await Promise.all([
      readOldStore(oldDb, 'events'),
      readOldStore(oldDb, 'categories'),
      readOldStore(oldDb, 'locations'),
      readOldStore(oldDb, 'settings'),
    ]);
    if (!oldEvents.length && !oldCategories.length && !oldLocations.length) return;

    const currentEvents = await DB.getAll('events');
    if (currentEvents.length){
      // The account already has synced data (from another device, or from
      // an earlier migration on this same device) — never silently merge
      // or duplicate; only offer this import when the account is genuinely
      // still empty.
      return;
    }

    const bring = confirm(
      `Questo dispositivo ha ${oldEvents.length} impegni salvati da prima ` +
      `della sincronizzazione. Vuoi portarli nel tuo account Google, così ` +
      `restano e si sincronizzano con gli altri dispositivi?`
    );
    if (!bring) return;

    for (const c of oldCategories) await DB.put('categories', c);
    for (const l of oldLocations) await DB.put('locations', l);
    for (const e of oldEvents) await DB.put('events', e);
    if (oldSettings && oldSettings[0]) await DB.put('settings', oldSettings[0]);

    if (typeof toast === 'function') toast(`Importati ${oldEvents.length} impegni dal dispositivo.`);
  } catch (err){
    console.warn('Migrazione dati locali non riuscita:', err);
  }
}
