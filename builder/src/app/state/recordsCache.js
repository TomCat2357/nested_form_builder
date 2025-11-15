/**
 * IndexedDB-based cache for records data
 * Caches all records to avoid repeated full scans of the spreadsheet
 */

const DB_NAME = 'NestedFormBuilder';
const STORE_NAME = 'recordsCache';
const DB_VERSION = 1;

/**
 * Open IndexedDB connection
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Save all records to IndexedDB
 * @param {Array} records - Array of record objects
 * @returns {Promise<void>}
 */
export async function saveRecordsToCache(records) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  // Clear existing data
  await store.clear();

  // Insert all records
  for (const record of records) {
    await store.put(record);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Get all records from IndexedDB
 * @returns {Promise<Array>}
 */
export async function getRecordsFromCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Clear all cached records
 * @returns {Promise<void>}
 */
export async function clearRecordsCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Check if cache exists and has data
 * @returns {Promise<boolean>}
 */
export async function hasCachedRecords() {
  try {
    const records = await getRecordsFromCache();
    return records.length > 0;
  } catch (err) {
    console.error('Error checking cache:', err);
    return false;
  }
}
