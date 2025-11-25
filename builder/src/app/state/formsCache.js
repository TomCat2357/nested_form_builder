/**
 * IndexedDB-based cache for forms list
 * Caches all forms to provide instant loading on subsequent visits
 */

const DB_NAME = 'NestedFormBuilder';
const STORE_NAME = 'formsCache';
const DB_VERSION = 2; // Increment version to add new store
const META_KEY = '__metadata__';

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

      // Create formsCache store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        // Index for quick access by archived status
        store.createIndex('archived', 'archived', { unique: false });
      }

      // Create recordsCache store if it doesn't exist (for compatibility)
      if (!db.objectStoreNames.contains('recordsCache')) {
        db.createObjectStore('recordsCache', { keyPath: 'id' });
      }
    };
  });
}

// Promisify IDBRequest so we can await operations
const waitForRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Wait for a transaction to complete
const waitForTransaction = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/**
 * Save all forms to IndexedDB cache
 * @param {Array} forms - Array of form objects
 * @param {Array} loadFailures - Array of load failure objects
 * @returns {Promise<void>}
 */
export async function saveFormsToCache(forms, loadFailures = []) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  // Clear existing data
  await waitForRequest(store.clear());

  // Insert all forms with cache metadata
  const cacheTimestamp = Date.now();
  for (const form of forms) {
    await waitForRequest(store.put({
      ...form,
      _cacheTimestamp: cacheTimestamp,
    }));
  }

  // Store metadata (always) so empty lists still carry timestamp/loadFailures
  await waitForRequest(store.put({
    id: META_KEY,
    _cacheTimestamp: cacheTimestamp,
    failures: loadFailures,
  }));

  await waitForTransaction(tx);
  db.close();
  console.log('[formsCache] Saved', forms.length, 'forms and', loadFailures.length, 'failures to cache');
}

/**
 * Get all forms from IndexedDB cache
 * @returns {Promise<{forms: Array, loadFailures: Array, cacheTimestamp: number|null}>}
 */
export async function getFormsFromCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const allRecords = request.result || [];
      const forms = [];
      let loadFailures = [];
      let cacheTimestamp = null;

      for (const record of allRecords) {
        if (record.id === META_KEY) {
          loadFailures = record.failures || [];
          cacheTimestamp = record._cacheTimestamp || null;
        } else if (record.id !== undefined) {
          // Remove cache metadata before returning
          const { _cacheTimestamp, ...form } = record;
          forms.push(form);
          if (!cacheTimestamp && _cacheTimestamp) {
            cacheTimestamp = _cacheTimestamp;
          }
        }
      }

      db.close();
      console.log('[formsCache] Retrieved', forms.length, 'forms and', loadFailures.length, 'failures from cache');
      resolve({ forms, loadFailures, cacheTimestamp });
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Clear all cached forms
 * @returns {Promise<void>}
 */
export async function clearFormsCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  await waitForRequest(store.clear());
  await waitForTransaction(tx);
  db.close();
  console.log('[formsCache] Cache cleared');
}

/**
 * Check if cache exists and has data
 * @returns {Promise<boolean>}
 */
export async function hasCachedForms() {
  try {
    const { forms, cacheTimestamp, loadFailures } = await getFormsFromCache();
    return forms.length > 0 || loadFailures.length > 0 || !!cacheTimestamp;
  } catch (err) {
    console.error('[formsCache] Error checking cache:', err);
    return false;
  }
}

/**
 * Get cache age in milliseconds
 * @returns {Promise<number|null>} - Age in ms, or null if no cache
 */
export async function getCacheAge() {
  try {
    const { cacheTimestamp } = await getFormsFromCache();
    if (!cacheTimestamp) return null;
    return Date.now() - cacheTimestamp;
  } catch (err) {
    console.error('[formsCache] Error getting cache age:', err);
    return null;
  }
}
