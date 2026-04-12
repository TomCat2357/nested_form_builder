/**
 * Pure record transformation and merge logic
 * - No IndexedDB dependency — all functions are side-effect free
 * - Used by recordsCache.js for cache operations and by tests directly
 */

import { resolveUnixMs } from "../../utils/dateTime.js";

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * レコードの modifiedAt を比較可能な数値 (unix ms) に正規化する。
 * serial date / unix ms / 文字列 いずれでも受け付ける。
 */
export const getComparableModifiedAt = (record) => {
  if (!record) return 0;
  return resolveUnixMs(record.modifiedAtUnixMs, record.modifiedAt) ?? 0;
};

export const withNormalizedModifiedAt = (record) => {
  if (!record) return record;
  const normalizedModifiedAtUnixMs = getComparableModifiedAt(record);
  if (record.modifiedAtUnixMs === normalizedModifiedAtUnixMs) return record;
  return { ...record, modifiedAtUnixMs: normalizedModifiedAtUnixMs };
};

// ---------------------------------------------------------------------------
// Record normalization
// ---------------------------------------------------------------------------

export const normalizeObjectRecord = (value) => (
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

// ---------------------------------------------------------------------------
// Index / lookup helpers
// ---------------------------------------------------------------------------

export const buildEntryIndexMap = (records) => {
  const map = {};
  records.forEach((record, idx) => {
    if (record?.id) map[record.id] = idx;
  });
  return map;
};

export const buildLatestRecordMap = (records, pickEntryId) => {
  const latestByEntryId = {};
  for (const record of records) {
    const entryId = pickEntryId(record);
    if (!entryId) continue;
    const current = latestByEntryId[entryId];
    if (!current || getComparableModifiedAt(record) > getComparableModifiedAt(current)) {
      latestByEntryId[entryId] = record;
    }
  }
  return latestByEntryId;
};

export const getMaxModifiedAt = (records) => {
  let maxModifiedAt = 0;
  for (const record of records) {
    const ts = getComparableModifiedAt(record);
    if (ts > maxModifiedAt) maxModifiedAt = ts;
  }
  return maxModifiedAt;
};

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

export const mergeRecordsByModifiedAt = (existingMap, newRecords) => {
  const merged = { ...(existingMap || {}) };
  const safeNewRecords = Array.isArray(newRecords) ? newRecords : [];

  for (const record of safeNewRecords) {
    const entryId = record?.id ?? record?.entryId;
    if (!entryId) continue;
    const existing = merged[entryId];
    if (!existing || getComparableModifiedAt(record) >= getComparableModifiedAt(existing)) {
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

    const incomingModifiedAt = getComparableModifiedAt(incomingRecord);
    const existingModifiedAt = getComparableModifiedAt(existingRecord);
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

// ---------------------------------------------------------------------------
// Record number
// ---------------------------------------------------------------------------

export const getMaxRecordNoFromEntries = (entries) => {
  let maxNo = 0;

  for (const entry of entries || []) {
    const no = parseInt(entry?.["No."], 10);
    if (!Number.isNaN(no) && no > maxNo) maxNo = no;
  }

  return maxNo;
};
