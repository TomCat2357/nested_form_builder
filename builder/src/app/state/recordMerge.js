/**
 * Pure record transformation and merge logic
 * - No IndexedDB dependency — all functions are side-effect free
 * - Used by recordsCache.js for cache operations and by tests directly
 */

import { ensureArray } from "../../utils/arrays.js";
import { resolveStrictUnixMs, formatJstString } from "../../utils/dateTime.js";
import { asPlainObject } from "../../utils/objectShape.js";

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * レコードの modifiedAt を比較可能な数値 (unix ms) に正規化する。
 * serial date / unix ms / 文字列 いずれでも受け付ける。
 */
export const getComparableModifiedAt = (record) => {
  if (!record) return 0;
  // 固定メタ列は Unix ms 厳密解釈：手動編集で削れた値が遠未来扱いになって
  // マージで常に勝ってしまうのを防ぐ
  return resolveStrictUnixMs(record.modifiedAtUnixMs, record.modifiedAt) ?? 0;
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

const normalizeObjectRecord = (value) => asPlainObject(value);

export const normalizeRecordForCache = (record, { formId } = {}) => {
  const baseRecord = record && typeof record === "object" ? record : {};
  // Plan P4 γ: createdAt / modifiedAt / deletedAt は JST 文字列を canonical 表現とする。
  // 旧データ救済: Unix ms / Date オブジェクトが来ても formatJstString で正規化。
  // *UnixMs 系は過渡期シム（Plan P5 で廃止予定）。
  const createdAtUnixMs = resolveStrictUnixMs(baseRecord.createdAtUnixMs, baseRecord.createdAt);
  const modifiedAtUnixMs = resolveStrictUnixMs(baseRecord.modifiedAtUnixMs, baseRecord.modifiedAt);
  const deletedAtUnixMs = resolveStrictUnixMs(baseRecord.deletedAtUnixMs, baseRecord.deletedAt);

  // canonical な JST 文字列を導出。優先順: 既存 JST 文字列 → Unix ms シム経由
  const canonicalDt = (jstCandidate, unixMsCandidate) => {
    const fromString = formatJstString(jstCandidate);
    if (fromString) return fromString;
    if (Number.isFinite(unixMsCandidate)) return formatJstString(unixMsCandidate);
    return "";
  };
  const createdAtJst = canonicalDt(baseRecord.createdAt, createdAtUnixMs);
  const modifiedAtJst = canonicalDt(baseRecord.modifiedAt, modifiedAtUnixMs);
  const deletedAtJst = canonicalDt(baseRecord.deletedAt, deletedAtUnixMs);

  const normalizedData = normalizeObjectRecord(baseRecord.data);
  const normalizedDataUnixMs = normalizeObjectRecord(baseRecord.dataUnixMs);
  const normalizedOrder = Array.isArray(baseRecord.order) && baseRecord.order.length > 0
    ? [...baseRecord.order]
    : Object.keys(normalizedData);

  return {
    ...baseRecord,
    id: baseRecord.id ?? baseRecord.entryId ?? "",
    "No.": baseRecord["No."] ?? "",
    formId: formId ?? baseRecord.formId ?? "",
    createdAt: createdAtJst,
    createdAtUnixMs: Number.isFinite(createdAtUnixMs) ? createdAtUnixMs : null,
    modifiedAt: modifiedAtJst,
    modifiedAtUnixMs: Number.isFinite(modifiedAtUnixMs) ? modifiedAtUnixMs : null,
    deletedAt: deletedAtJst || null,
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

export const mergeRecordsByModifiedAt = (existingMap, newRecords, { syncStartedAt = 0 } = {}) => {
  const merged = { ...(existingMap || {}) };
  const safeNewRecords = ensureArray(newRecords);

  for (const record of safeNewRecords) {
    const entryId = record?.id ?? record?.entryId;
    if (!entryId) continue;
    const existing = merged[entryId];
    // syncStartedAt ガード: 同期開始後にローカル変更されたレコード（lastSyncedAt > syncStartedAt）は
    // サーバー版で丸ごと上書きしない。楽観的に付けた値（例: 特勤フラグ）が、その値をまだ含まない
    // 古いサーバー応答で消えるのを防ぐ。upsertRecordInCache（recordsMemoryStore.js）の保護と同じ規則。
    if (existing && syncStartedAt && existing.lastSyncedAt > syncStartedAt) {
      continue;
    }
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
