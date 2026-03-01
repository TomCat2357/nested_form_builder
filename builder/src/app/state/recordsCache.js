/**
 * IndexedDB-based cache for records data (per form)
 * - Uses indexes for quick lookup by formId and entryId
 * - Stores header metadata per form
 */

import { openDB, waitForRequest, waitForTransaction, STORE_NAMES } from './dbHelpers.js';
import { MS_PER_DAY, SERIAL_EPOCH_UTC_MS, JST_OFFSET_MS } from "../../core/constants.js";
import { toUnixMs } from "../../utils/dateTime.js";

const buildCompoundId = (formId, entryId) => `${formId}::${entryId}`;
const SERIAL_EPOCH_JST_MS = SERIAL_EPOCH_UTC_MS - JST_OFFSET_MS;
const isProbablyUnixMs = (value) => Math.abs(value) >= 100000000000;

const normalizeNumericModifiedAtToUnixMs = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (isProbablyUnixMs(value)) return value;
  if (Math.abs(value) >= 1000000000) return value * 1000;
  return SERIAL_EPOCH_JST_MS + value * MS_PER_DAY;
};

const normalizeModifiedAtUnixMs = (record) => {
  if (!record) return 0;
  const explicitUnixMs = normalizeNumericModifiedAtToUnixMs(Number(record.modifiedAtUnixMs));
  if (explicitUnixMs > 0) return explicitUnixMs;

  const rawModifiedAt = record.modifiedAt;
  if (rawModifiedAt instanceof Date) {
    const dateUnixMs = rawModifiedAt.getTime();
    return Number.isFinite(dateUnixMs) && dateUnixMs > 0 ? dateUnixMs : 0;
  }

  const numericModifiedAt = normalizeNumericModifiedAtToUnixMs(Number(rawModifiedAt));
  if (numericModifiedAt > 0) return numericModifiedAt;

  if (typeof rawModifiedAt === 'string' && rawModifiedAt.trim()) {
    const parsedUnixMs = toUnixMs(rawModifiedAt);
    if (Number.isFinite(parsedUnixMs) && parsedUnixMs > 0) return parsedUnixMs;
  }

  return 0;
};

const normalizeComparableModifiedAtUnixMs = (record) => {
  if (!record) return 0;
  const explicitUnixMs = Number(record.modifiedAtUnixMs);
  const normalizedExplicit = normalizeNumericModifiedAtToUnixMs(explicitUnixMs);
  if (normalizedExplicit > 0) return normalizedExplicit;

  const rawModifiedAt = record.modifiedAt;
  if (rawModifiedAt instanceof Date) {
    const dateUnixMs = rawModifiedAt.getTime();
    return Number.isFinite(dateUnixMs) && dateUnixMs > 0 ? dateUnixMs : 0;
  }

  const numericModifiedAt = Number(rawModifiedAt);
  const normalizedNumeric = normalizeNumericModifiedAtToUnixMs(numericModifiedAt);
  if (normalizedNumeric > 0) return normalizedNumeric;

  if (typeof rawModifiedAt === 'string' && rawModifiedAt.trim()) {
    const parsedUnixMs = toUnixMs(rawModifiedAt);
    if (Number.isFinite(parsedUnixMs) && parsedUnixMs > 0) return parsedUnixMs;
  }

  return 0;
};

const withNormalizedModifiedAt = (record) => {
  if (!record) return record;
  const normalizedModifiedAtUnixMs = normalizeModifiedAtUnixMs(record);
  if (record.modifiedAtUnixMs === normalizedModifiedAtUnixMs) return record;
  return { ...record, modifiedAtUnixMs: normalizedModifiedAtUnixMs };
};

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

const buildCacheRecord = (formId, record, lastSyncedAt, rowIndex) => {
  const normalizedRecord = withNormalizedModifiedAt(record);
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

export const planRecordMerge = ({ existingRecords = [], incomingRecords = [], allIds = [], sheetLastUpdatedAt = 0, lastFrontendMutationAt = 0 } = {}) => {
  const safeExistingRecords = Array.isArray(existingRecords) ? existingRecords : [];
  const safeIncomingRecords = Array.isArray(incomingRecords) ? incomingRecords : [];
  const allIdsSet = new Set(Array.isArray(allIds) ? allIds : []);
  const hasAllIds = allIdsSet.size > 0;

  const existingByEntryId = buildLatestRecordMap(safeExistingRecords, (record) => record?.entryId ?? record?.id);
  const incomingByEntryId = buildLatestRecordMap(safeIncomingRecords, (record) => record?.id ?? record?.entryId);

  const maxIncomingModifiedAt = getMaxModifiedAt(Object.values(incomingByEntryId));
  const maxExistingModifiedAt = getMaxModifiedAt(Object.values(existingByEntryId));

  const commonUpdateIds = [];
  const cacheOnlyDeleteIds = [];
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

  for (const [entryId, existingRecord] of Object.entries(existingByEntryId)) {
    if (incomingByEntryId[entryId]) continue;

    // allIds が無い差分は「更新があったレコードだけ」を意味するため、
    // 不在を根拠にキャッシュ削除してはいけない。
    if (!hasAllIds || allIdsSet.has(entryId)) continue;

    const cacheMutationUnixMs = normalizeNumericModifiedAtToUnixMs(Number(lastFrontendMutationAt));
    const sheetUpdatedUnixMs = normalizeNumericModifiedAtToUnixMs(Number(sheetLastUpdatedAt));
    const cacheIsNewerThanSheet = cacheMutationUnixMs > 0 && sheetUpdatedUnixMs > 0 && cacheMutationUnixMs > sheetUpdatedUnixMs;
    if (!cacheIsNewerThanSheet) cacheOnlyDeleteIds.push(entryId);
  }

  for (const [entryId, incomingRecord] of Object.entries(incomingByEntryId)) {
    if (existingByEntryId[entryId]) continue;

    const cacheMutationUnixMs = normalizeNumericModifiedAtToUnixMs(Number(lastFrontendMutationAt));
    const sheetUpdatedUnixMs = normalizeNumericModifiedAtToUnixMs(Number(sheetLastUpdatedAt));
    const sheetIsNewerThanCache = sheetUpdatedUnixMs > 0 ? sheetUpdatedUnixMs >= cacheMutationUnixMs : true;
    const incomingModifiedAt = normalizeComparableModifiedAtUnixMs(incomingRecord);
    if (sheetIsNewerThanCache && incomingModifiedAt > 0) incomingOnlyAddIds.push(entryId);
  }

  return {
    existingByEntryId,
    incomingByEntryId,
    commonUpdateIds,
    cacheOnlyDeleteIds,
    incomingOnlyAddIds,
    maxIncomingModifiedAt,
    maxExistingModifiedAt,
    hasAllIds,
    allIdsSet,
    sheetLastUpdatedAt,
    lastFrontendMutationAt,
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
    lastServerReadAt: updates.lastServerReadAt ?? existingMeta?.lastServerReadAt ?? 0,
    lastFrontendMutationAt: updates.lastFrontendMutationAt ?? existingMeta?.lastFrontendMutationAt ?? 0,
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
export async function saveRecordsToCache(formId, records, headerMatrix = [], { schemaHash = null, syncStartedAt = null, sheetLastUpdatedAt = 0 } = {}) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const lastSyncedAt = Date.now();
  const safeRecords = Array.isArray(records) ? records : [];
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const entryIndexMap = syncStartedAt
    ? { ...(existingMeta?.entryIndexMap || {}) }
    : buildEntryIndexMap(safeRecords);

  if (syncStartedAt) {
    const existingRecords = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId))) || [];
    const incomingRowIndexMap = buildEntryIndexMap(safeRecords);
    const mergePlan = planRecordMerge({
      existingRecords,
      incomingRecords: safeRecords,
      allIds: safeRecords.map((record) => record?.id).filter(Boolean),
      sheetLastUpdatedAt,
      lastFrontendMutationAt: existingMeta?.lastFrontendMutationAt || 0,
    });
    console.debug(
      `[saveRecordsToCache] formId=${formId}, cacheCount=${existingRecords.length}, fullCount=${safeRecords.length}, maxFullModifiedAt=${mergePlan.maxIncomingModifiedAt}, maxCacheModifiedAt=${mergePlan.maxExistingModifiedAt}, updates=${mergePlan.commonUpdateIds.length}, deletes=${mergePlan.cacheOnlyDeleteIds.length}, adds=${mergePlan.incomingOnlyAddIds.length}`,
    );

    for (const entryId of mergePlan.cacheOnlyDeleteIds) {
      const cacheRecord = mergePlan.existingByEntryId[entryId];
      if (!cacheRecord?.compoundId) continue;
      await waitForRequest(store.delete(cacheRecord.compoundId));
      delete entryIndexMap[entryId];
      console.debug(`[saveRecordsToCache] DELETE entryId=${entryId}`);
    }

    const upsertIncomingIds = [...mergePlan.commonUpdateIds, ...mergePlan.incomingOnlyAddIds];
    for (const entryId of upsertIncomingIds) {
      const incomingRecord = mergePlan.incomingByEntryId[entryId];
      if (!incomingRecord) continue;

      const existingRecord = mergePlan.existingByEntryId[entryId];
      const nextRowIndex = Number.isInteger(incomingRowIndexMap[entryId])
        ? incomingRowIndexMap[entryId]
        : (Number.isInteger(existingRecord?.rowIndex) ? existingRecord.rowIndex : entryIndexMap[entryId]);

      await waitForRequest(store.put(buildCacheRecord(formId, incomingRecord, lastSyncedAt, nextRowIndex)));
      if (Number.isInteger(nextRowIndex)) {
        entryIndexMap[entryId] = nextRowIndex;
      }
      console.debug(`[saveRecordsToCache] UPSERT entryId=${entryId}, rowIndex=${nextRowIndex}`);
    }
  } else {
    // 従来動作: 全削除→全挿入
    await deleteEntriesForForm(store, formId);

    for (let idx = 0; idx < safeRecords.length; idx++) {
      const record = safeRecords[idx];
      await waitForRequest(store.put(buildCacheRecord(formId, record, lastSyncedAt, idx)));
    }
  }

  await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt,
    lastSpreadsheetReadAt: sheetLastUpdatedAt || existingMeta?.lastSpreadsheetReadAt || lastSyncedAt,
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
    lastSpreadsheetReadAt: lastReloadedAt,
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
    lastServerReadAt: meta?.lastServerReadAt || 0,
    lastFrontendMutationAt: meta?.lastFrontendMutationAt || 0,
    entryIndexMap: meta?.entryIndexMap || {},
  };
}

/**
 * Remove a single record from cache (removes only the deleted entry from index map)
 */
export async function deleteRecordFromCache(formId, entryId) {
  if (!formId || !entryId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  await waitForRequest(store.delete(buildCompoundId(formId, entryId)));
  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);

  // 削除対象のentryIdのみをindexMapから除去（他のエントリは保持）
  const updatedIndexMap = { ...(existingMeta?.entryIndexMap || {}) };
  delete updatedIndexMap[entryId];

  await waitForRequest(metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt: Date.now(),
    lastFrontendMutationAt: Date.now(),
    entryIndexMap: updatedIndexMap,
  })));

  await waitForTransaction(tx);
  db.close();
}

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
  
  let maxNo = 0;
  for (const entry of rawEntries || []) {
    const no = parseInt(entry['No.'], 10);
    if (!Number.isNaN(no) && no > maxNo) maxNo = no;
  }
  return maxNo;
}

/**
 * 差分データをキャッシュに適用する
 */
export async function applyDeltaToCache(formId, updatedRecords, allIds, headerMatrix = null, schemaHash = null, { syncStartedAt = null, sheetLastUpdatedAt = 0 } = {}) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const lastSyncedAt = Date.now();
  const existingRecords = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId))) || [];
  const safeUpdatedRecords = Array.isArray(updatedRecords) ? updatedRecords : [];
  const entryIndexMap = { ...(existingMeta?.entryIndexMap || {}) };
  const mergePlan = planRecordMerge({
    existingRecords,
    incomingRecords: safeUpdatedRecords,
    allIds,
    sheetLastUpdatedAt,
    lastFrontendMutationAt: existingMeta?.lastFrontendMutationAt || 0,
  });
  console.debug(
    `[applyDeltaToCache] formId=${formId}, cacheCount=${existingRecords.length}, lazyCount=${safeUpdatedRecords.length}, maxLazyModifiedAt=${mergePlan.maxIncomingModifiedAt}, maxCacheModifiedAt=${mergePlan.maxExistingModifiedAt}, allIdsCount=${mergePlan.allIdsSet.size}, hasAllIds=${mergePlan.hasAllIds}, updates=${mergePlan.commonUpdateIds.length}, deletes=${mergePlan.cacheOnlyDeleteIds.length}, adds=${mergePlan.incomingOnlyAddIds.length}`,
  );

  for (const entryId of mergePlan.commonUpdateIds) {
    const lazyRecord = mergePlan.incomingByEntryId[entryId];
    const cacheRecord = mergePlan.existingByEntryId[entryId];
    if (!lazyRecord || !cacheRecord) continue;

    const lazyModifiedAt = normalizeComparableModifiedAtUnixMs(lazyRecord);
    const cacheModifiedAt = normalizeComparableModifiedAtUnixMs(cacheRecord);
    console.debug(`[applyDeltaToCache] sec1: UPDATE FROM LAZY entryId=${entryId}, cacheModifiedAt=${cacheModifiedAt}, lazyModifiedAt=${lazyModifiedAt}`);

    const nextRowIndex = Number.isInteger(cacheRecord.rowIndex)
      ? cacheRecord.rowIndex
      : entryIndexMap[entryId];
    await waitForRequest(store.put(buildCacheRecord(formId, lazyRecord, lastSyncedAt, nextRowIndex)));
    if (Number.isInteger(nextRowIndex)) {
      entryIndexMap[entryId] = nextRowIndex;
    }
  }

  for (const entryId of mergePlan.cacheOnlyDeleteIds) {
    const cacheRecord = mergePlan.existingByEntryId[entryId];
    if (!cacheRecord?.compoundId) continue;

    const cacheModifiedAt = normalizeComparableModifiedAtUnixMs(cacheRecord);
    const reason = mergePlan.hasAllIds
      ? `not_in_allIds_and_older(cacheModifiedAt=${cacheModifiedAt}, maxLazyModifiedAt=${mergePlan.maxIncomingModifiedAt})`
      : `no_allIds_and_older(cacheModifiedAt=${cacheModifiedAt}, maxLazyModifiedAt=${mergePlan.maxIncomingModifiedAt})`;
    console.debug(`[applyDeltaToCache] sec2: DELETE entryId=${entryId}, reason=${reason}`);

    await waitForRequest(store.delete(cacheRecord.compoundId));
    delete entryIndexMap[entryId];
  }

  for (const entryId of mergePlan.incomingOnlyAddIds) {
    const lazyRecord = mergePlan.incomingByEntryId[entryId];
    if (!lazyRecord) continue;

    const lazyModifiedAt = normalizeComparableModifiedAtUnixMs(lazyRecord);
    console.debug(`[applyDeltaToCache] sec3: ADD entryId=${entryId}, lazyModifiedAt=${lazyModifiedAt}, maxCacheModifiedAt=${mergePlan.maxExistingModifiedAt}`);

    const nextRowIndex = entryIndexMap[entryId];
    await waitForRequest(store.put(buildCacheRecord(formId, lazyRecord, lastSyncedAt, nextRowIndex)));
    if (Number.isInteger(nextRowIndex)) {
      entryIndexMap[entryId] = nextRowIndex;
    }
  }

  // メタデータの更新
  metaStore.put(buildMetadata(formId, existingMeta, {
    lastSyncedAt,
    lastSpreadsheetReadAt: sheetLastUpdatedAt || existingMeta?.lastSpreadsheetReadAt || lastSyncedAt,
    headerMatrix: headerMatrix !== null ? headerMatrix : undefined,
    schemaHash: schemaHash !== null ? schemaHash : undefined,
    entryIndexMap
  }));

  await waitForTransaction(tx);
  db.close();
}

export async function applySyncResultToCache(formId, syncedRecords, headerMatrix, metaUpdates) {
  if (!formId) return;
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.records, STORE_NAMES.recordsMeta], 'readwrite');
  const store = tx.objectStore(STORE_NAMES.records);
  const metaStore = tx.objectStore(STORE_NAMES.recordsMeta);

  const existingMeta = await waitForRequest(metaStore.get(formId)).catch(() => null);
  const lastSyncedAt = Date.now();
  const existingRecords = await waitForRequest(store.index('formId').getAll(IDBKeyRange.only(formId))) ||[];

  const existingMap = {};
  existingRecords.forEach(r => existingMap[r.id] = r);

  for (const rec of syncedRecords) {
    const ex = existingMap[rec.id];
    const exMod = ex ? (Number(ex.modifiedAtUnixMs) || 0) : 0;
    const newMod = Number(rec.modifiedAtUnixMs) || 0;
    if (!ex || newMod >= exMod) {
      const nextRowIndex = ex?.rowIndex;
      const normalizedRecord = { ...rec };
      await waitForRequest(store.put({
        ...normalizedRecord,
        compoundId: `${formId}::${normalizedRecord.id}`,
        formId,
        entryId: normalizedRecord.id,
        lastSyncedAt,
        rowIndex: nextRowIndex,
      }));
    }
  }

  await waitForRequest(metaStore.put({
    ...existingMeta,
    ...metaUpdates,
    formId,
    lastSyncedAt,
    headerMatrix: headerMatrix ?? existingMeta?.headerMatrix ??[],
    lastServerReadAt: metaUpdates.lastServerReadAt ?? existingMeta?.lastServerReadAt ?? 0,
    serverCommitToken: metaUpdates.serverCommitToken ?? existingMeta?.serverCommitToken ?? 0
  }));

  await waitForTransaction(tx);
  db.close();
}
