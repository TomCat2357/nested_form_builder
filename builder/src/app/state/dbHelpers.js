/**
 * Shared IndexedDB helpers for formsCache and recordsCache
 */

import { DB_NAME, DB_VERSION, STORE_NAMES } from "../../core/constants.js";
export { STORE_NAMES };

/**
 * Open IndexedDB connection with all required stores
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create formsCache store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAMES.forms)) {
        const store = db.createObjectStore(STORE_NAMES.forms, { keyPath: 'id' });
        // Index for quick access by archived status
        store.createIndex('archived', 'archived', { unique: false });
      }

      // Create/refresh recordsCache store with indexes for per-form lookups
      if (db.objectStoreNames.contains(STORE_NAMES.records)) {
        db.deleteObjectStore(STORE_NAMES.records);
      }
      const recordsStore = db.createObjectStore(STORE_NAMES.records, { keyPath: 'compoundId' });
      recordsStore.createIndex('formId', 'formId', { unique: false });
      recordsStore.createIndex('entryId', 'entryId', { unique: false });

      // Metadata store for recordsCache (per form)
      if (db.objectStoreNames.contains(STORE_NAMES.recordsMeta)) {
        db.deleteObjectStore(STORE_NAMES.recordsMeta);
      }
      db.createObjectStore(STORE_NAMES.recordsMeta, { keyPath: 'formId' });

      // Settings store
      if (!db.objectStoreNames.contains(STORE_NAMES.settings)) {
        db.createObjectStore(STORE_NAMES.settings, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Promisify IDBRequest so we can await operations
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
export const waitForRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Wait for a transaction to complete
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export const waitForTransaction = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/**
 * DBトランザクションのボイラープレートを隠蔽するラッパー
 */
export async function withTransaction(storeNames, mode, callback) {
  const db = await openDB();
  const tx = db.transaction(storeNames, mode);
  try {
    const stores = Array.isArray(storeNames)
      ? storeNames.map(name => tx.objectStore(name))
      : tx.objectStore(storeNames);
    const result = await callback(stores, tx);
    await waitForTransaction(tx);
    return result;
  } finally {
    db.close();
  }
}
