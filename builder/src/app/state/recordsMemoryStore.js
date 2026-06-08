/**
 * Memory-based store for records data (per form) — mirrors recordsCache.js API.
 *
 * - Stores everything in an in-process Map<formId, FormStore>
 * - Same exported function signatures as recordsCache.js so dataStore.js can swap imports
 * - Pure transformation / merge logic still lives in recordMerge.js
 *
 * Trade-offs:
 * - Tab close / reload empties the store. Reload triggers a GAS re-fetch (existing flow).
 * - No transactions; mutations are synchronous but async-wrapped to keep the IDB-shaped contract.
 */

import {
  withNormalizedModifiedAt,
  normalizeRecordForCache,
  buildEntryIndexMap,
  mergeRecordsByModifiedAt,
  getMaxRecordNoFromEntries,
} from "./recordMerge.js";

// Re-export pure functions so existing consumers don't break
export { normalizeRecordForCache, mergeRecordsByModifiedAt, getMaxRecordNoFromEntries } from "./recordMerge.js";

// Module-level state (singleton).
const stores = new Map();

const newFormStore = (formId) => ({
  formId,
  // Map<entryId, RecordWithMeta>. RecordWithMeta = normalizedRecord + lastSyncedAt + rowIndex
  records: new Map(),
  meta: null,
});

const ensureFormStore = (formId) => {
  let store = stores.get(formId);
  if (!store) {
    store = newFormStore(formId);
    stores.set(formId, store);
  }
  return store;
};

const stripMetadata = (record) => {
  if (!record) return null;
  const { lastSyncedAt, rowIndex: _rowIndex, ...rest } = record;
  return normalizeRecordForCache(rest, { formId: rest.formId });
};

const buildRecordWithMeta = (formId, record, lastSyncedAt, rowIndex) => {
  const normalizedRecord = withNormalizedModifiedAt(normalizeRecordForCache(record, { formId }));
  return {
    ...normalizedRecord,
    formId,
    lastSyncedAt,
    rowIndex,
  };
};

// レコード同期用のメタ（formId / lastSyncedAt / lastSpreadsheetReadAt …）。
// フォーム一覧キャッシュの formsCache.js のメタ（failures / propertyStoreMode / folders）とは
// 別ドメインなので共通化しない。共有するのは lastSyncedAt の語彙のみ。
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

const sortedEntriesById = (recordsMap) => {
  const arr = [];
  for (const record of recordsMap.values()) {
    arr.push(stripMetadata(record));
  }
  arr.sort((a, b) => {
    if (a?.id < b?.id) return -1;
    if (a?.id > b?.id) return 1;
    return 0;
  });
  return arr;
};

/**
 * Save all records for a form to memory (replaces existing entries for the form)
 */
export async function saveRecordsToCache(formId, records, headerMatrix = [], { schemaHash = null, sheetLastUpdatedAt = 0, serverCommitToken = 0, serverModifiedAt = 0, lastServerReadAt = 0 } = {}) {
  if (!formId) return;
  const store = ensureFormStore(formId);
  const lastSyncedAt = Date.now();
  const safeRecords = Array.isArray(records) ? records : [];
  const entryIndexMap = buildEntryIndexMap(safeRecords);

  store.records.clear();
  for (let idx = 0; idx < safeRecords.length; idx++) {
    const record = safeRecords[idx];
    const built = buildRecordWithMeta(formId, record, lastSyncedAt, idx);
    if (built.id) store.records.set(built.id, built);
  }

  store.meta = buildMetadata(formId, store.meta, {
    lastSyncedAt,
    lastSpreadsheetReadAt: sheetLastUpdatedAt || store.meta?.lastSpreadsheetReadAt || lastSyncedAt,
    headerMatrix,
    schemaHash,
    entryIndexMap,
    serverCommitToken,
    serverModifiedAt,
    lastServerReadAt,
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
  const store = ensureFormStore(formId);

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

  store.meta = buildMetadata(formId, store.meta, { ...updates });
}

/**
 * Save index map for a single entry id
 */
export async function updateEntryIndex(formId, entryId, rowIndex) {
  if (!formId || !entryId || rowIndex === undefined || rowIndex === null) return;
  const store = ensureFormStore(formId);
  const existingMap = store.meta?.entryIndexMap || {};
  existingMap[entryId] = rowIndex;
  store.meta = buildMetadata(formId, store.meta, {
    entryIndexMap: existingMap,
  });
  // Also keep the in-record rowIndex consistent if we have the record.
  const rec = store.records.get(entryId);
  if (rec) {
    rec.rowIndex = rowIndex;
  }
}

/**
 * Get cached entry with row index (fast path using map lookup)
 */
export async function getCachedEntryWithIndex(formId, entryId) {
  if (!formId || !entryId) return { entry: null, rowIndex: null };
  const store = stores.get(formId);
  if (!store) {
    return { entry: null, rowIndex: null, cacheTimestamp: null, headerMatrix: [], schemaHash: null, lastSyncedAt: null, lastSpreadsheetReadAt: null, entryIndexMap: {} };
  }

  const rec = store.records.get(entryId);
  let entry = null;
  let rowIndex = null;
  if (rec) {
    entry = stripMetadata(rec);
    rowIndex = Number.isInteger(rec.rowIndex) ? rec.rowIndex : (store.meta?.entryIndexMap?.[entryId] ?? null);
  } else {
    rowIndex = store.meta?.entryIndexMap?.[entryId] ?? null;
  }

  return {
    entry,
    rowIndex,
    cacheTimestamp: store.meta?.lastSyncedAt || null,
    headerMatrix: store.meta?.headerMatrix || [],
    schemaHash: store.meta?.schemaHash || null,
    lastSyncedAt: store.meta?.lastSyncedAt || null,
    lastSpreadsheetReadAt: store.meta?.lastSpreadsheetReadAt || store.meta?.lastSyncedAt || null,
    entryIndexMap: store.meta?.entryIndexMap || {},
  };
}

/**
 * Upsert a single record into memory store (keeps existing headerMatrix/index map/schemaHash)
 */
export async function upsertRecordInCache(formId, record, { headerMatrix, rowIndex, schemaHash, syncStartedAt = null } = {}) {
  if (!formId || !record?.id) return;
  const store = ensureFormStore(formId);

  // syncStartedAt保護: 同期開始後にローカル変更されたレコードは上書きしない
  if (syncStartedAt) {
    const existing = store.records.get(record.id);
    if (existing && existing.lastSyncedAt > syncStartedAt) {
      return;
    }
  }

  const lastSyncedAt = Date.now();
  const nextRowIndex = Number.isInteger(rowIndex) ? rowIndex : store.meta?.entryIndexMap?.[record.id];
  const built = buildRecordWithMeta(formId, record, lastSyncedAt, nextRowIndex);
  store.records.set(built.id, built);

  const updatedIndexMap = { ...(store.meta?.entryIndexMap || {}) };
  if (Number.isInteger(nextRowIndex)) {
    updatedIndexMap[record.id] = nextRowIndex;
  }

  store.meta = buildMetadata(formId, store.meta, {
    lastSyncedAt,
    lastFrontendMutationAt: lastSyncedAt,
    headerMatrix,
    schemaHash,
    entryIndexMap: updatedIndexMap,
  });
}

/**
 * Get all records for a form from memory
 */
export async function getRecordsFromCache(formId) {
  if (!formId) return { entries: [], headerMatrix: [], cacheTimestamp: null, schemaHash: null, lastSyncedAt: null, lastSpreadsheetReadAt: null, lastFrontendMutationAt: 0, entryIndexMap: {} };
  const store = stores.get(formId);
  if (!store) {
    return { entries: [], headerMatrix: [], cacheTimestamp: null, schemaHash: null, lastSyncedAt: null, lastSpreadsheetReadAt: null, serverCommitToken: 0, serverModifiedAt: 0, lastServerReadAt: 0, lastFrontendMutationAt: 0, entryIndexMap: {} };
  }

  const entries = sortedEntriesById(store.records);
  const meta = store.meta;
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
 * Remove a single record from memory store
 */
export async function deleteRecordFromCache(formId, entryId) {
  return deleteRecordsFromCache(formId, [entryId]);
}

export async function deleteRecordsFromCache(formId, entryIds) {
  if (!formId) return;
  const targetIds = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
  if (targetIds.length === 0) return;

  const store = ensureFormStore(formId);
  for (const entryId of targetIds) {
    store.records.delete(entryId);
  }

  const updatedIndexMap = { ...(store.meta?.entryIndexMap || {}) };
  targetIds.forEach((entryId) => {
    delete updatedIndexMap[entryId];
  });
  const now = Date.now();
  store.meta = buildMetadata(formId, store.meta, {
    lastSyncedAt: now,
    lastFrontendMutationAt: now,
    entryIndexMap: updatedIndexMap,
  });
}

/**
 * メモリ内の最大 No. を取得（仮No採番用）
 */
export async function getMaxRecordNo(formId) {
  if (!formId) return 0;
  const store = stores.get(formId);
  if (!store) return 0;
  return getMaxRecordNoFromEntries(Array.from(store.records.values()));
}

/**
 * 差分データをキャッシュに適用する
 */
export async function applySyncResultToCache(formId, syncedRecords, headerMatrix, metaUpdates = {}) {
  if (!formId) return;
  const store = ensureFormStore(formId);
  const lastSyncedAt = Date.now();

  const existingMap = {};
  for (const record of store.records.values()) {
    const entryId = record?.id;
    if (entryId) existingMap[entryId] = record;
  }

  // syncStartedAt 以降にローカル編集されたレコードはサーバー版で上書きしない（未確定編集の保護）。
  const mergedMap = mergeRecordsByModifiedAt(existingMap, syncedRecords, {
    syncStartedAt: metaUpdates.syncStartedAt || 0,
  });
  for (const [entryId, record] of Object.entries(mergedMap)) {
    if (existingMap[entryId] === record) continue;
    const built = buildRecordWithMeta(formId, record, lastSyncedAt, record?.rowIndex);
    store.records.set(entryId, built);
  }

  store.meta = buildMetadata(formId, store.meta, {
    lastSyncedAt,
    headerMatrix: headerMatrix ?? store.meta?.headerMatrix ?? [],
    lastServerReadAt: metaUpdates.lastServerReadAt ?? store.meta?.lastServerReadAt ?? 0,
    serverCommitToken: metaUpdates.serverCommitToken ?? store.meta?.serverCommitToken ?? 0,
    serverModifiedAt: metaUpdates.serverModifiedAt ?? store.meta?.serverModifiedAt ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Test-only utility (not part of the public API mirrored from recordsCache.js)
// ---------------------------------------------------------------------------

export function __resetMemoryStoreForTests() {
  stores.clear();
}
