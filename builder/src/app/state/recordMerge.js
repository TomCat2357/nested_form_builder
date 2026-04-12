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
