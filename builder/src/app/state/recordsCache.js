/**
 * IndexedDB-based cache for records data (per form)
 * - Uses indexes for quick lookup by formId and entryId
 * - Stores header metadata per form
 */

const DB_NAME = 'NestedFormBuilder';
const STORE_NAME = 'recordsCache';
const META_STORE_NAME = 'recordsCacheMeta';
const SETTINGS_STORE_NAME = 'settingsStore';
const DB_VERSION = 4;

const buildCompoundId = (formId, entryId) => `${formId}::${entryId}`;

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

      // Re-create recordsCache with indexes for fast lookups
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'compoundId' });
      store.createIndex('formId', 'formId', { unique: false });
      store.createIndex('entryId', 'entryId', { unique: false });

      // Ensure formsCache store exists (if this module opens DB first)
      if (!db.objectStoreNames.contains('formsCache')) {
        const formsStore = db.createObjectStore('formsCache', { keyPath: 'id' });
        formsStore.createIndex('archived', 'archived', { unique: false });
      }

      // Metadata per form (timestamp, headerMatrix, schemaHash, entryIndexMap)
      if (db.objectStoreNames.contains(META_STORE_NAME)) {
        db.deleteObjectStore(META_STORE_NAME);
      }
      db.createObjectStore(META_STORE_NAME, { keyPath: 'formId' });

      // Settings store (shared with formsCache)
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
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

const stripMetadata = (record) => {
  if (!record) return null;
  const { compoundId, _cacheTimestamp, entryId, ...rest } = record;
  return { ...rest, id: entryId };
};

const deleteEntriesForForm = (store, formId) =>
  new Promise((resolve, reject) => {
    const index = store.index('formId');
    const request = index.openKeyCursor(IDBKeyRange.only(formId));
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });

const buildCacheRecord = (formId, record, lastSyncedAt, rowIndex) => ({
  ...record,
  compoundId: buildCompoundId(formId, record.id),
  formId,
  entryId: record.id,
  _cacheTimestamp: lastSyncedAt,
  lastSyncedAt,
  rowIndex,
});

const buildEntryIndexMap = (records) => {
  const map = {};
  records.forEach((record, idx) => {
    if (record?.id) map[record.id] = idx;
  });
  return map;
};

/**
 * Save all records for a form to IndexedDB (replaces existing cache)
 * @param {string} formId
 * @param {Array} records
 * @param {Array} headerMatrix
 * @returns {Promise<void>}
 */
export async function saveRecordsToCache(formId, records, headerMatrix = [], { schemaHash = null } = {}) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const metaStore = tx.objectStore(META_STORE_NAME);

  const lastSyncedAt = Date.now();
  const entryIndexMap = buildEntryIndexMap(records || []);
  await deleteEntriesForForm(store, formId);

  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, idx)));
  }

  await waitForRequest(metaStore.put({
    formId,
    _cacheTimestamp: lastSyncedAt,
    lastSyncedAt,
    headerMatrix,
    schemaHash,
    entryIndexMap,
  }));

  await waitForTransaction(tx);
  db.close();
}

/**
 * Update metadata only (entry index map / timestamp / schemaHash)
 */
export async function updateRecordsMeta(formId, { entryIndexMap, lastReloadedAt, schemaHash, headerMatrix } = {}) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  const metaStore = tx.objectStore(META_STORE_NAME);
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

  const lastSyncedAt = lastReloadedAt ?? existingMeta?.lastSyncedAt ?? existingMeta?._cacheTimestamp ?? Date.now();
  const nextMeta = {
    formId,
    _cacheTimestamp: existingMeta?._cacheTimestamp || lastSyncedAt,
    lastSyncedAt,
    headerMatrix: headerMatrix ?? existingMeta?.headerMatrix ?? [],
    schemaHash: schemaHash ?? existingMeta?.schemaHash ?? null,
    entryIndexMap: entryIndexMap ?? existingMeta?.entryIndexMap ?? {},
  };

  await waitForRequest(metaStore.put(nextMeta));
  await waitForTransaction(tx);
  db.close();
}

/**
 * Save index map for a single entry id
 */
export async function updateEntryIndex(formId, entryId, rowIndex) {
  if (!formId || !entryId || rowIndex === undefined || rowIndex === null) return;
  const db = await openDB();
  const tx = db.transaction(META_STORE_NAME, 'readwrite');
  const metaStore = tx.objectStore(META_STORE_NAME);
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const existingMap = existingMeta?.entryIndexMap || {};
  existingMap[entryId] = rowIndex;
  const lastSyncedAt = existingMeta?.lastSyncedAt || existingMeta?._cacheTimestamp || Date.now();
  const nextMeta = {
    formId,
    _cacheTimestamp: existingMeta?._cacheTimestamp || lastSyncedAt,
    lastSyncedAt,
    headerMatrix: existingMeta?.headerMatrix || [],
    schemaHash: existingMeta?.schemaHash || null,
    entryIndexMap: existingMap,
  };
  await waitForRequest(metaStore.put(nextMeta));
  await waitForTransaction(tx);
  db.close();
}

const binarySearchById = (entries, entryId) => {
  // Assumes entries are sorted ascending by id (ensured at fetch time)
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const currentId = entries[mid]?.id;
    if (currentId === entryId) return mid;
    if (currentId < entryId) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
};

/**
 * Get cached entry with row index (fast path using map, fallback to binary search)
 */
export async function getCachedEntryWithIndex(formId, entryId) {
  if (!formId || !entryId) return { entry: null, rowIndex: null };
  const { entries, cacheTimestamp, headerMatrix, schemaHash, lastSyncedAt, entryIndexMap } = await getRecordsFromCache(formId);
  let rowIndex = entryIndexMap?.[entryId];
  let entry = null;

  if (Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < entries.length) {
    entry = entries[rowIndex];
    if (entry?.id !== entryId) {
      rowIndex = null;
    }
  }

  if (!entry) {
    const foundIndex = binarySearchById(entries, entryId);
    if (foundIndex !== -1) {
      entry = entries[foundIndex];
      rowIndex = foundIndex;
      await updateEntryIndex(formId, entryId, foundIndex);
    }
  }

  return { entry, rowIndex, cacheTimestamp, headerMatrix, schemaHash, lastSyncedAt, entryIndexMap };
}

/**
 * Upsert a single record into cache (keeps existing headerMatrix/index map/schemaHash)
 */
export async function upsertRecordInCache(formId, record, { headerMatrix, rowIndex, schemaHash } = {}) {
  if (!formId || !record?.id) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const metaStore = tx.objectStore(META_STORE_NAME);

  const lastSyncedAt = Date.now();
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const nextRowIndex = Number.isInteger(rowIndex) ? rowIndex : existingMeta?.entryIndexMap?.[record.id];
  await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, nextRowIndex)));

  await waitForRequest(metaStore.put({
    formId,
    _cacheTimestamp: lastSyncedAt,
    lastSyncedAt,
    headerMatrix: headerMatrix || existingMeta?.headerMatrix || [],
    schemaHash: schemaHash ?? existingMeta?.schemaHash ?? null,
    entryIndexMap: { ...(existingMeta?.entryIndexMap || {}), ...(Number.isInteger(nextRowIndex) ? { [record.id]: nextRowIndex } : {}) },
  }));

  await waitForTransaction(tx);
  db.close();
}

/**
 * Get all records for a form from IndexedDB
 * @param {string} formId
 * @returns {Promise<{entries: Array, headerMatrix: Array, cacheTimestamp: number|null, lastSyncedAt: number|null}>}
 */
export async function getRecordsFromCache(formId) {
  if (!formId) return { entries: [], headerMatrix: [], cacheTimestamp: null, schemaHash: null, lastSyncedAt: null, entryIndexMap: {} };
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const metaStore = tx.objectStore(META_STORE_NAME);

  const entriesRequest = store.index('formId').getAll(IDBKeyRange.only(formId));
  const metaRequest = metaStore.get(formId);

  const [rawEntries, meta] = await Promise.all([
    waitForRequest(entriesRequest),
    waitForRequest(metaRequest).catch(() => null),
  ]);

  await waitForTransaction(tx);
  db.close();

  const entries = (rawEntries || []).map(stripMetadata);
  return {
    entries,
    headerMatrix: meta?.headerMatrix || [],
    cacheTimestamp: meta?._cacheTimestamp || null,
    lastSyncedAt: meta?.lastSyncedAt || meta?._cacheTimestamp || null,
    schemaHash: meta?.schemaHash || null,
    entryIndexMap: meta?.entryIndexMap || {},
  };
}

/**
 * Get a single record from cache
 * @param {string} formId
 * @param {string} entryId
 * @returns {Promise<object|null>}
 */
export async function getRecordFromCache(formId, entryId) {
  if (!formId || !entryId) return null;
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  const result = await waitForRequest(store.get(buildCompoundId(formId, entryId)));
  await waitForTransaction(tx);
  db.close();
  return stripMetadata(result);
}

/**
 * Clear cached records (all forms or a specific form)
 * @param {string} [formId]
 * @returns {Promise<void>}
 */
export async function clearRecordsCache(formId) {
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const metaStore = tx.objectStore(META_STORE_NAME);

  if (formId) {
    await deleteEntriesForForm(store, formId);
    await waitForRequest(metaStore.delete(formId));
  } else {
    await waitForRequest(store.clear());
    await waitForRequest(metaStore.clear());
  }

  await waitForTransaction(tx);
  db.close();
}

/**
 * Check if cache exists for a form
 * @param {string} formId
 * @returns {Promise<boolean>}
 */
export async function hasCachedRecords(formId) {
  if (!formId) return false;
  try {
    const { entries, cacheTimestamp, lastSyncedAt } = await getRecordsFromCache(formId);
    return entries.length > 0 || !!cacheTimestamp || !!lastSyncedAt;
  } catch (err) {
    console.error('Error checking cache:', err);
    return false;
  }
}

/**
 * Remove a single record from cache (keeps meta but clears index map to force refresh)
 */
export async function deleteRecordFromCache(formId, entryId) {
  if (!formId || !entryId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const metaStore = tx.objectStore(META_STORE_NAME);

  await waitForRequest(store.delete(buildCompoundId(formId, entryId)));
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const lastSyncedAt = Date.now();
  const nextMeta = {
    formId,
    _cacheTimestamp: existingMeta?._cacheTimestamp || lastSyncedAt,
    lastSyncedAt,
    headerMatrix: existingMeta?.headerMatrix || [],
    schemaHash: existingMeta?.schemaHash || null,
    entryIndexMap: {}, // invalidate map to avoid stale indices
  };
  await waitForRequest(metaStore.put(nextMeta));
  await waitForTransaction(tx);
  db.close();
}
