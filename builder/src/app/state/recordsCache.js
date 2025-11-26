/**
 * IndexedDB-based cache for records data (per form)
 * - Uses indexes for quick lookup by formId and entryId
 * - Stores header metadata per form
 */

import { openDB, waitForRequest, waitForTransaction, STORE_NAMES } from './dbHelpers.js';

const buildCompoundId = (formId, entryId) => `${formId}::${entryId}`;

const stripMetadata = (record) => {
  if (!record) return null;
  const { compoundId, lastSyncedAt, entryId, ...rest } = record;
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
 * Build metadata object with defaults from existing metadata
 */
const buildMetadata = (formId, existingMeta, updates = {}) => {
  const now = Date.now();
  return {
    formId,
    lastSyncedAt: updates.lastSyncedAt ?? existingMeta?.lastSyncedAt ?? now,
    headerMatrix: updates.headerMatrix ?? existingMeta?.headerMatrix ?? [],
    schemaHash: updates.schemaHash ?? existingMeta?.schemaHash ?? null,
    entryIndexMap: updates.entryIndexMap ?? existingMeta?.entryIndexMap ?? {},
  };
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
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const lastSyncedAt = Date.now();
  const entryIndexMap = buildEntryIndexMap(records || []);
  await deleteEntriesForForm(store, formId);

  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, idx)));
  }

  await waitForRequest(metaStore.put(buildMetadata(formId, null, {
    lastSyncedAt,
    headerMatrix,
    schemaHash,
    entryIndexMap,
  })));

  await waitForTransaction(tx);
  db.close();
}

/**
 * Update metadata only (entry index map / timestamp / schemaHash)
 */
export async function updateRecordsMeta(formId, { entryIndexMap, lastReloadedAt, schemaHash, headerMatrix } = {}) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.recordsMeta, 'readwrite');
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

  await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt: lastReloadedAt,
    headerMatrix,
    schemaHash,
    entryIndexMap,
  })));

  await waitForTransaction(tx);
  db.close();
}

/**
 * Save index map for a single entry id
 */
export async function updateEntryIndex(formId, entryId, rowIndex) {
  if (!formId || !entryId || rowIndex === undefined || rowIndex === null) return;
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.recordsMeta, 'readwrite');
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

  const existingMap = existingMeta?.entryIndexMap || {};
  existingMap[entryId] = rowIndex;

  await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
    entryIndexMap: existingMap,
  })));

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
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const lastSyncedAt = Date.now();
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const nextRowIndex = Number.isInteger(rowIndex) ? rowIndex : existingMeta?.entryIndexMap?.[record.id];
  await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, nextRowIndex)));

  const updatedIndexMap = { ...(existingMeta?.entryIndexMap || {}) };
  if (Number.isInteger(nextRowIndex)) {
    updatedIndexMap[record.id] = nextRowIndex;
  }

  await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt,
    headerMatrix,
    schemaHash,
    entryIndexMap: updatedIndexMap,
  })));

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
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readonly');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

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
    cacheTimestamp: meta?.lastSyncedAt || null,
    lastSyncedAt: meta?.lastSyncedAt || null,
    schemaHash: meta?.schemaHash || null,
    entryIndexMap: meta?.entryIndexMap || {},
  };
}

/**
 * Remove a single record from cache (keeps meta but clears index map to force refresh)
 */
export async function deleteRecordFromCache(formId, entryId) {
  if (!formId || !entryId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  await waitForRequest(store.delete(buildCompoundId(formId, entryId)));
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

  await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt: Date.now(),
    entryIndexMap: {}, // invalidate map to avoid stale indices
  })));

  await waitForTransaction(tx);
  db.close();
}
