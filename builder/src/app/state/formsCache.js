/**
 * IndexedDB-based cache for forms list
 * Caches all forms to provide instant loading on subsequent visits
 */

import { openDB, waitForRequest, waitForTransaction, STORE_NAMES } from './dbHelpers.js';

const META_KEY = '__metadata__';

/**
 * Save all forms to IndexedDB cache
 * @param {Array} forms - Array of form objects
 * @param {Array} loadFailures - Array of load failure objects
 * @returns {Promise<void>}
 */
export async function saveFormsToCache(forms, loadFailures = []) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.forms, 'readwrite');
  const store = tx.objectStore(STORE_NAMES.forms);

  // Clear existing data
  await waitForRequest(store.clear());

  // Insert all forms with cache metadata
  const lastSyncedAt = Date.now();
  for (const form of forms) {
    await waitForRequest(store.put({
      ...form,
      lastSyncedAt,
    }));
  }

  // Store metadata (always) so empty lists still carry timestamp/loadFailures
  await waitForRequest(store.put({
    id: META_KEY,
    lastSyncedAt,
    failures: loadFailures,
  }));

  await waitForTransaction(tx);
  db.close();
  console.log('[formsCache] Saved', forms.length, 'forms and', loadFailures.length, 'failures to cache');
}

/**
 * Get all forms from IndexedDB cache
 * @returns {Promise<{forms: Array, loadFailures: Array, lastSyncedAt: number|null}>}
 */
export async function getFormsFromCache() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.forms, 'readonly');
  const store = tx.objectStore(STORE_NAMES.forms);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const allRecords = request.result || [];
      const forms = [];
      let loadFailures = [];
      let lastSyncedAt = null;

      for (const record of allRecords) {
        if (record.id === META_KEY) {
          loadFailures = record.failures || [];
          lastSyncedAt = record.lastSyncedAt || null;
        } else if (record.id !== undefined) {
          // Remove cache metadata before returning
          const { lastSyncedAt: _, ...form } = record;
          forms.push(form);
        }
      }

      db.close();
      console.log('[formsCache] Retrieved', forms.length, 'forms and', loadFailures.length, 'failures from cache');
      resolve({ forms, loadFailures, lastSyncedAt });
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
  const tx = db.transaction(STORE_NAMES.forms, 'readwrite');
  const store = tx.objectStore(STORE_NAMES.forms);

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
    const { forms, lastSyncedAt, loadFailures } = await getFormsFromCache();
    return forms.length > 0 || loadFailures.length > 0 || !!lastSyncedAt;
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
    const { lastSyncedAt } = await getFormsFromCache();
    if (!lastSyncedAt) return null;
    return Date.now() - lastSyncedAt;
  } catch (err) {
    console.error('[formsCache] Error getting cache age:', err);
    return null;
  }
}
