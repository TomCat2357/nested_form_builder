/**
 * IndexedDB-based cache for records data (per form)
 * - Uses indexes for quick lookup by formId and entryId
 * - Stores header metadata per form
 */

import { openDB, waitForRequest, waitForTransaction, STORE_NAMES } from "./dbHelpers.js";
import { resolveUnixMs, toUnixMs, normalizeNumericToUnixMs } from "../../utils/dateTime.js";

const buildCompoundId = (formId, entryId) => `${formId}::${entryId}`;

const normalizeComparableModifiedAtUnixMs = (record) => {
  if (!record) return 0;
  const explicitUnixMs = Number(record.modifiedAtUnixMs);
  const normalizedExplicit = (normalizeNumericToUnixMs(explicitUnixMs) ?? 0);
  if (normalizedExplicit > 0) return normalizedExplicit;

  const rawModifiedAt = record.modifiedAt;
  if (rawModifiedAt instanceof Date) {
    const dateUnixMs = rawModifiedAt.getTime();
    return Number.isFinite(dateUnixMs) && dateUnixMs > 0 ? dateUnixMs : 0;
  }

  const numericModifiedAt = Number(rawModifiedAt);
  const normalizedNumeric = (normalizeNumericToUnixMs(numericModifiedAt) ?? 0);
  if (normalizedNumeric > 0) return normalizedNumeric;

  if (typeof rawModifiedAt === 'string' && rawModifiedAt.trim()) {
    const parsedUnixMs = toUnixMs(rawModifiedAt);
    if (Number.isFinite(parsedUnixMs) && parsedUnixMs > 0) return parsedUnixMs;
  }

  return 0;
};

const withNormalizedModifiedAt = (record) => {
  if (!record) return record;
  const normalizedModifiedAtUnixMs = normalizeComparableModifiedAtUnixMs(record);
  if (record.modifiedAtUnixMs === normalizedModifiedAtUnixMs) return record;
  return { ...record, modifiedAtUnixMs: normalizedModifiedAtUnixMs };
};

const normalizeObjectRecord = (value) => (
  value && typeof value === "object" && !Array.isArray(value) ? value : {}
);

export const normalizeRecordForCache = (record, { formId } = {}) => {
  const baseRecord = record && typeof record === "object" ? record : {};
  const createdAtUnixMs = resolveUnixMs(baseRecord.createdAtUnixMs, baseRecord.createdAt);
  const modifiedAtUnixMs = resolveUnixMs(baseRecord.modifiedAtUnixMs, baseRecord.modifiedAt);
  const deletedAtUnixMs = resolveUnixMs(baseRecord.deletedAtUnixMs, baseRecord.deletedAt);
  const normalizedData = normalizeObjectRecord(baseRecord.data);
  const normalizedDataUnixMs = normalizeObjectRecord(baseRecord.dataUnixMs);
  const normalizedOrder = Array.isArray(baseRecord.order) && baseRecord.order.length > 0
    ? [...baseRecord.order]
    : Object.keys(normalizedData);
  const rawDeletedAt = baseRecord.deletedAt;

  return {
    ...baseRecord,
    id: baseRecord.id ?? baseRecord.entryId ?? "",
    "No.": baseRecord["No."] ?? "",
    formId: formId ?? baseRecord.formId ?? "",
    driveFolderUrl: baseRecord.driveFolderUrl ?? "",
    createdAt: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : (baseRecord.createdAt ?? ""),
    createdAtUnixMs: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : null,
    modifiedAt: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : (baseRecord.modifiedAt ?? ""),
    modifiedAtUnixMs: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : null,
    deletedAt: Number.isFinite(deletedAtUnixMs)
      ? deletedAtUnixMs
      : (rawDeletedAt === "" || rawDeletedAt === undefined ? null : (rawDeletedAt ?? null)),
    deletedAtUnixMs: Number.isFinite(deletedAtUnixMs) ? deletedAtUnixMs : null,
    createdBy: baseRecord.createdBy ?? "",
    modifiedBy: baseRecord.modifiedBy ?? "",
    deletedBy: baseRecord.deletedBy ?? "",
    data: normalizedData,
    dataUnixMs: normalizedDataUnixMs,
    order: normalizedOrder,
  };
};

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

const buildEntryIndexMap = (records) => {
  const map = {};
  records.forEach((record, idx) => {
    if (record?.id) map[record.id] = idx;
  });
  return map;
};

const buildLatestRecordMap = (records, pickEntryId) => {
  const latestByEntryId = {};
  for (const record of records) {
    const entryId = pickEntryId(record);
    if (!entryId) continue;
    const current = latestByEntryId[entryId];
    if (!current || normalizeComparableModifiedAtUnixMs(record) > normalizeComparableModifiedAtUnixMs(current)) {
      latestByEntryId[entryId] = record;
    }
  }
  return latestByEntryId;
};

const getMaxModifiedAt = (records) => {
  let maxModifiedAt = 0;
  for (const record of records) {
    const ts = normalizeComparableModifiedAtUnixMs(record);
    if (ts > maxModifiedAt) maxModifiedAt = ts;
  }
  return maxModifiedAt;
};

export const mergeRecordsByModifiedAt = (existingMap, newRecords) => {
  const merged = { ...(existingMap || {}) };
  const safeNewRecords = Array.isArray(newRecords) ? newRecords : [];

  for (const record of safeNewRecords) {
    const entryId = record?.id ?? record?.entryId;
    if (!entryId) continue;
    const existing = merged[entryId];
    if (!existing || normalizeComparableModifiedAtUnixMs(record) >= normalizeComparableModifiedAtUnixMs(existing)) {
      merged[entryId] = existing?.rowIndex !== undefined && record?.rowIndex === undefined
        ? { ...record, rowIndex: existing.rowIndex }
        : record;
    }
  }

  return merged;
};

export const planRecordMerge = ({ existingRecords = [], incomingRecords = [] } = {}) => {
  const safeExistingRecords = Array.isArray(existingRecords) ? existingRecords : [];
  const safeIncomingRecords = Array.isArray(incomingRecords) ? incomingRecords : [];

  const existingByEntryId = buildLatestRecordMap(safeExistingRecords, (record) => record?.entryId ?? record?.id);
  const incomingByEntryId = buildLatestRecordMap(safeIncomingRecords, (record) => record?.id ?? record?.entryId);

  const maxIncomingModifiedAt = getMaxModifiedAt(Object.values(incomingByEntryId));
  const maxExistingModifiedAt = getMaxModifiedAt(Object.values(existingByEntryId));

  const commonUpdateIds = [];
  const incomingOnlyAddIds = [];

  for (const [entryId, incomingRecord] of Object.entries(incomingByEntryId)) {
    const existingRecord = existingByEntryId[entryId];
    if (!existingRecord) continue;

    const incomingModifiedAt = normalizeComparableModifiedAtUnixMs(incomingRecord);
    const existingModifiedAt = normalizeComparableModifiedAtUnixMs(existingRecord);
    if (incomingModifiedAt >= existingModifiedAt) {
      commonUpdateIds.push(entryId);
    }
  }

  for (const [entryId] of Object.entries(incomingByEntryId)) {
    if (existingByEntryId[entryId]) continue;
    incomingOnlyAddIds.push(entryId);
  }

  return {
    existingByEntryId,
    incomingByEntryId,
    commonUpdateIds,
    incomingOnlyAddIds,
    maxIncomingModifiedAt,
    maxExistingModifiedAt,
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
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

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

  await waitForTransaction(tx);
  db.close();
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
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.recordsMeta, 'readwrite');
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);
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
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  // syncStartedAt保護: 同期開始後にローカル変更されたレコードは上書きしない
  if (syncStartedAt) {
    const compoundId = buildCompoundId(formId, record.id);
    const existing = await waitForRequest(store.get(compoundId)).catch(() => null);
    if (existing && existing.lastSyncedAt > syncStartedAt) {
      await waitForTransaction(tx);
      db.close();
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

  await waitForTransaction(tx);
  db.close();
}

/**
 * Get all records for a form from IndexedDB
 * @param {string} formId
 * @returns {Promise<{entries: Array, headerMatrix: Array, cacheTimestamp: number|null, lastSyncedAt: number|null}>}
 */
export async function getRecordsFromCache(formId) {
  if (!formId) return { entries: [], headerMatrix: [], cacheTimestamp: null, schemaHash: null, lastSyncedAt: null, lastSpreadsheetReadAt: null, lastFrontendMutationAt: 0, entryIndexMap: {} };
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
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const targetIds = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
  if (targetIds.length === 0) {
    await waitForTransaction(tx);
    db.close();
    return;
  }

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

  await waitForTransaction(tx);
  db.close();
}

export const getMaxRecordNoFromEntries = (entries) => {
  let maxNo = 0;

  for (const entry of entries || []) {
    const no = parseInt(entry?.["No."], 10);
    if (!Number.isNaN(no) && no > maxNo) maxNo = no;
  }

  return maxNo;
};

/**
 * キャッシュ内の最大 No. を取得（仮No採番用）
 */
export async function getMaxRecordNo(formId) {
  if (!formId) return 0;
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.records, 'readonly');
  const store = tx.objectStore(STORE_NAMES.records);
  const rawEntries = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId)));
  db.close();

  return getMaxRecordNoFromEntries(rawEntries);
}

/**
 * 差分データをキャッシュに適用する
 */

export async function applySyncResultToCache(formId, syncedRecords, headerMatrix, metaUpdates = {}) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const lastSyncedAt = Date.now();
  const existingRecords = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId))) ||[];

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

  await waitForTransaction(tx);
  db.close();
}
