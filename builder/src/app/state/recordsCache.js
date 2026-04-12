/**
 * IndexedDB-based cache for records data (per form)
 * - Uses indexes for quick lookup by formId and entryId
 * - Stores header metadata per form
 * - Pure transformation / merge logic lives in recordMerge.js
 */

import { withTransaction, waitForRequest, STORE_NAMES } from "./dbHelpers.js";
import {
  withNormalizedModifiedAt,
  normalizeRecordForCache,
  buildEntryIndexMap,
  mergeRecordsByModifiedAt,
  getMaxRecordNoFromEntries,
} from "./recordMerge.js";

// Re-export pure functions so existing consumers don't break
export { normalizeRecordForCache, mergeRecordsByModifiedAt, planRecordMerge, getMaxRecordNoFromEntries } from "./recordMerge.js";

const buildCompoundId = (formId, entryId) => `${formId}::${entryId}`;

const stripMetadata = (record) => {
  if (!record) return null;
  const { compoundId, lastSyncedAt, entryId, ...rest } = record;
  return normalizeRecordForCache({ ...rest, id: entryId }, { formId: rest.formId });
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

const buildCacheRecord = (formId, record, lastSyncedAt, rowIndex) => {
  const normalizedRecord = withNormalizedModifiedAt(normalizeRecordForCache(record, { formId }));
  return {
    ...normalizedRecord,
    compoundId: buildCompoundId(formId, normalizedRecord.id),
    formId,
    entryId: normalizedRecord.id,
    lastSyncedAt,
    rowIndex,
  };
};

/**
 * Build metadata object with defaults from existing metadata
 */
const buildMetadata = (formId, existingMeta, updates = {}) => {
  const now = Date.now();
  return {
    formId,
    lastSyncedAt: updates.lastSyncedAt ?? existingMeta?.lastSyncedAt ?? now,
    lastSpreadsheetReadAt: updates.lastSpreadsheetReadAt ?? existingMeta?.lastSpreadsheetReadAt ?? updates.lastSyncedAt ?? existingMeta?.lastSyncedAt ?? now,
    serverCommitToken: updates.serverCommitToken ?? existingMeta?.serverCommitToken ?? 0,
    serverModifiedAt: updates.serverModifiedAt ?? existingMeta?.serverModifiedAt ?? 0,
    lastServerReadAt: updates.lastServerReadAt ?? existingMeta?.lastServerReadAt ?? 0,
    lastFrontendMutationAt: updates.lastFrontendMutationAt ?? existingMeta?.lastFrontendMutationAt ?? 0,
    headerMatrix: updates.headerMatrix ?? existingMeta?.headerMatrix ?? [],
    schemaHash: updates.schemaHash ?? existingMeta?.schemaHash ?? null,
    entryIndexMap: updates.entryIndexMap ?? existingMeta?.entryIndexMap ?? {},
    childEntriesData: updates.childEntriesData !== undefined ? updates.childEntriesData : (existingMeta?.childEntriesData ?? null),
  };
};

/**
 * Save all records for a form to IndexedDB (replaces existing cache)
 * @param {string} formId
 * @param {Array} records
 * @param {Array} headerMatrix
 * @returns {Promise<void>}
 */
export async function saveRecordsToCache(formId, records, headerMatrix = [], { schemaHash = null, sheetLastUpdatedAt = 0, serverCommitToken = 0, serverModifiedAt = 0, lastServerReadAt = 0 } = {}) {
  if (!formId) return;
  await withTransaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite', async ([store, metaStore]) => {
    const lastSyncedAt = Date.now();
    const safeRecords = Array.isArray(records) ? records : [];
    const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
    const entryIndexMap = buildEntryIndexMap(safeRecords);

    await deleteEntriesForForm(store, formId);

    for (let idx = 0; idx < safeRecords.length; idx++) {
      const record = safeRecords[idx];
      await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, idx)));
    }

    await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
      lastSyncedAt,
      lastSpreadsheetReadAt: sheetLastUpdatedAt || existingMeta?.lastSpreadsheetReadAt || lastSyncedAt,
      headerMatrix,
      schemaHash,
      entryIndexMap,
      serverCommitToken,
      serverModifiedAt,
      lastServerReadAt,
    })));
  });
}

/**
 * Update metadata only (entry index map / timestamp / schemaHash)
 */
export async function updateRecordsMeta(formId, {
  entryIndexMap,
  lastReloadedAt,
  schemaHash,
  headerMatrix,
  lastSpreadsheetReadAt,
  lastServerReadAt,
  serverCommitToken,
  serverModifiedAt,
} = {}) {
  if (!formId) return;
  await withTransaction(STORE_NAMES.recordsMeta, 'readwrite', async (metaStore) => {
    const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

    const updates = {
      headerMatrix,
      schemaHash,
      entryIndexMap,
      lastServerReadAt,
      serverCommitToken,
      serverModifiedAt,
    };
    if (lastReloadedAt !== undefined) {
      updates.lastSyncedAt = lastReloadedAt;
      updates.lastSpreadsheetReadAt = lastSpreadsheetReadAt ?? lastReloadedAt;
    } else if (lastSpreadsheetReadAt !== undefined) {
      updates.lastSpreadsheetReadAt = lastSpreadsheetReadAt;
    }

    await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
      ...updates,
    })));
  });
}

/**
 * Save index map for a single entry id
 */
export async function updateEntryIndex(formId, entryId, rowIndex) {
  if (!formId || !entryId || rowIndex === undefined || rowIndex === null) return;
  await withTransaction(STORE_NAMES.recordsMeta, 'readwrite', async (metaStore) => {
    const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

    const existingMap = existingMeta?.entryIndexMap || {};
    existingMap[entryId] = rowIndex;

    await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
      entryIndexMap: existingMap,
    })));
  });
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
  const { entries, cacheTimestamp, headerMatrix, schemaHash, lastSyncedAt, lastSpreadsheetReadAt, entryIndexMap } = await getRecordsFromCache(formId);
  let rowIndex = entryIndexMap?.[entryId];
  let entry = null;

  if (Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < entries.length) {
    entry = entries[rowIndex];
    if (entry?.id !== entryId) {
      entry = null;
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

  return { entry, rowIndex, cacheTimestamp, headerMatrix, schemaHash, lastSyncedAt, lastSpreadsheetReadAt, entryIndexMap };
}

/**
 * Upsert a single record into cache (keeps existing headerMatrix/index map/schemaHash)
 */
export async function upsertRecordInCache(formId, record, { headerMatrix, rowIndex, schemaHash, syncStartedAt = null } = {}) {
  if (!formId || !record?.id) return;
  await withTransaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite', async ([store, metaStore]) => {
    // syncStartedAt保護: 同期開始後にローカル変更されたレコードは上書きしない
    if (syncStartedAt) {
      const compoundId = buildCompoundId(formId, record.id);
      const existing = await waitForRequest(store.get(compoundId)).catch(() => null);
      if (existing && existing.lastSyncedAt > syncStartedAt) {
        return;
      }
    }

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
      lastFrontendMutationAt: lastSyncedAt,
      headerMatrix,
      schemaHash,
      entryIndexMap: updatedIndexMap,
    })));
  });
}

/**
 * Get all records for a form from IndexedDB
 * @param {string} formId
 * @returns {Promise<{entries: Array, headerMatrix: Array, cacheTimestamp: number|null, lastSyncedAt: number|null}>}
 */
export async function getRecordsFromCache(formId) {
  if (!formId) return { entries: [], headerMatrix: [], cacheTimestamp: null, schemaHash: null, lastSyncedAt: null, lastSpreadsheetReadAt: null, lastFrontendMutationAt: 0, entryIndexMap: {} };
  const { rawEntries, meta } = await withTransaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readonly', async ([store, metaStore]) => {
    const entriesRequest = store.index('formId').getAll(IDBKeyRange.only(formId));
    const metaRequest = metaStore.get(formId);

    const [rawEntries, meta] = await Promise.all([
      waitForRequest(entriesRequest),
      waitForRequest(metaRequest).catch(() => null),
    ]);

    return { rawEntries, meta };
  });

  const entries = (rawEntries || []).map(stripMetadata);
  entries.sort((a, b) => {
    if (a?.id < b?.id) return -1;
    if (a?.id > b?.id) return 1;
    return 0;
  });
  return {
    entries,
    headerMatrix: meta?.headerMatrix || [],
    cacheTimestamp: meta?.lastSyncedAt || null,
    lastSyncedAt: meta?.lastSyncedAt || null,
    schemaHash: meta?.schemaHash || null,
    lastSpreadsheetReadAt: meta?.lastSpreadsheetReadAt || meta?.lastSyncedAt || null,
    serverCommitToken: meta?.serverCommitToken || 0,
    serverModifiedAt: meta?.serverModifiedAt || 0,
    lastServerReadAt: meta?.lastServerReadAt || 0,
    lastFrontendMutationAt: meta?.lastFrontendMutationAt || 0,
    entryIndexMap: meta?.entryIndexMap || {},
  };
}

/**
 * Remove a single record from cache (removes only the deleted entry from index map)
 */
export async function deleteRecordFromCache(formId, entryId) {
  return deleteRecordsFromCache(formId, [entryId]);
}

export async function deleteRecordsFromCache(formId, entryIds) {
  if (!formId) return;
  const targetIds = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
  if (targetIds.length === 0) return;

  await withTransaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite', async ([store, metaStore]) => {
    for (const entryId of targetIds) {
      await waitForRequest(store.delete(buildCompoundId(formId, entryId)));
    }
    const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

    // 削除対象のentryIdのみをindexMapから除去（他のエントリは保持）
    const updatedIndexMap = { ...(existingMeta?.entryIndexMap || {}) };
    targetIds.forEach((entryId) => {
      delete updatedIndexMap[entryId];
    });
    const now = Date.now();

    await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
      lastSyncedAt: now,
      lastFrontendMutationAt: now,
      entryIndexMap: updatedIndexMap,
    })));
  });
}

/**
 * キャッシュ内の最大 No. を取得（仮No採番用）
 */
export async function getMaxRecordNo(formId) {
  if (!formId) return 0;
  return await withTransaction(STORE_NAMES.records, 'readonly', async (store) => {
    const rawEntries = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId)));
    return getMaxRecordNoFromEntries(rawEntries);
  });
}

/**
 * 差分データをキャッシュに適用する
 */
export async function applySyncResultToCache(formId, syncedRecords, headerMatrix, metaUpdates = {}) {
  if (!formId) return;
  await withTransaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite', async ([store, metaStore]) => {
    const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
    const lastSyncedAt = Date.now();
    const existingRecords = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId))) || [];

    const existingMap = {};
    existingRecords.forEach((record) => {
      const entryId = record?.entryId ?? record?.id;
      if (entryId) existingMap[entryId] = record;
    });

    const mergedMap = mergeRecordsByModifiedAt(existingMap, syncedRecords);
    for (const [entryId, record] of Object.entries(mergedMap)) {
      if (existingMap[entryId] === record) continue;
      await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, record?.rowIndex)));
    }

    await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
      lastSyncedAt,
      headerMatrix: headerMatrix ?? existingMeta?.headerMatrix ?? [],
      lastServerReadAt: metaUpdates.lastServerReadAt ?? existingMeta?.lastServerReadAt ?? 0,
      serverCommitToken: metaUpdates.serverCommitToken ?? existingMeta?.serverCommitToken ?? 0,
      serverModifiedAt: metaUpdates.serverModifiedAt ?? existingMeta?.serverModifiedAt ?? 0,
    })));
  });
}
