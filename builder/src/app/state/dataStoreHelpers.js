import { ensureArray } from "../../utils/arrays.js";
import { genRecordId } from "../../core/ids.js";
import { resolveStrictUnixMs } from "../../utils/dateTime.js";
import { DEFAULT_DELETED_RETENTION_DAYS, DEFAULT_SHEET_NAME, MS_PER_DAY } from "../../core/constants.js";
import { deleteRecordsFromCache } from "./recordsMemoryStore.js";
import { normalizeRecordForCache } from "./recordMerge.js";
import { asPlainObject } from "../../utils/objectShape.js";
import { toFiniteNumberOr } from "../../utils/numbers.js";

// フォームにレコード保存先スプレッドシートが設定済みか。
// 管理者は spreadsheetId 本体を、非管理者は GAS が付与する hasSpreadsheet フラグを持つ。
// （spreadsheetId は機微情報として非管理者クライアントには返さない。GAS が formId から解決する）
export const formHasSpreadsheet = (form) =>
  Boolean(form?.settings?.spreadsheetId || form?.settings?.hasSpreadsheet);

// レコード操作 API へ渡すシート設定。spreadsheetId はクライアントから送らない
// （GAS が formId から解決）。設定済みなら { sheetName }、未設定なら null。
export const getSheetConfig = (form) => {
  if (!formHasSpreadsheet(form)) return null;

  return {
    sheetName: form?.settings?.sheetName || DEFAULT_SHEET_NAME,
  };
};

export const normalizeRetentionDays = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_DELETED_RETENTION_DAYS;
  return Math.floor(numeric);
};

export const getDeletedRetentionDays = (form) => normalizeRetentionDays(form?.settings?.deletedRetentionDays);

export const isDeletedEntryExpired = (entry, retentionDays, nowMs = Date.now()) => {
  // 固定メタ列は Unix ms 厳密解釈（×1000 / Excel シリアル値の再解釈をしない）
  const deletedAtUnixMs = resolveStrictUnixMs(entry?.deletedAtUnixMs, entry?.deletedAt);
  if (!Number.isFinite(deletedAtUnixMs) || deletedAtUnixMs <= 0) return false;
  return deletedAtUnixMs <= nowMs - retentionDays * MS_PER_DAY;
};

export const filterExpiredDeletedEntries = (entries, retentionDays, nowMs = Date.now()) => {
  const safeEntries = ensureArray(entries);
  return safeEntries.filter((entry) => !isDeletedEntryExpired(entry, retentionDays, nowMs));
};

export const pruneExpiredDeletedEntries = async (formId, entries, retentionDays) => {
  const safeEntries = ensureArray(entries);
  const nowMs = Date.now();
  const remainingEntries = filterExpiredDeletedEntries(safeEntries, retentionDays, nowMs);
  const remainingIdSet = new Set(remainingEntries.map((entry) => entry?.id).filter(Boolean));
  const expiredIds = safeEntries
    .filter((entry) => entry?.id && !remainingIdSet.has(entry.id))
    .map((entry) => entry?.id)
    .filter(Boolean);

  if (expiredIds.length) {
    await deleteRecordsFromCache(formId, expiredIds);
  }

  return remainingEntries;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export const mapSheetRecordToEntry = (record, formId) => normalizeRecordForCache(record, { formId });

/**
 * @typedef {object} ListEntriesOptions
 * @property {boolean} [forceFullSync=false] 差分同期ではなくフル同期を強制する
 */

/**
 * listEntries が受け付けるオプションだけを正規化する。
 * @param {unknown} options
 * @returns {Required<ListEntriesOptions>}
 */
export const normalizeListEntriesOptions = (options = {}) => {
  const safeOptions = options && typeof options === "object" ? options : {};
  return {
    forceFullSync: safeOptions.forceFullSync === true,
  };
};

export const buildGetEntryFallbackListEntriesOptions = () => normalizeListEntriesOptions({
  forceFullSync: false,
});

export const buildListEntriesResult = ({
  entries = [],
  headerMatrix = [],
  lastSyncedAt = null,
  lastSpreadsheetReadAt = null,
  hasUnsynced = false,
  unsyncedCount = 0,
  isDelta = false,
  unchanged = false,
  fetchedCount = 0,
  sheetLastUpdatedAt = 0,
} = {}) => ({
  entries: ensureArray(entries),
  headerMatrix: ensureArray(headerMatrix),
  lastSyncedAt,
  lastSpreadsheetReadAt,
  hasUnsynced: !!hasUnsynced,
  unsyncedCount: toFiniteNumberOr(unsyncedCount, 0),
  isDelta: isDelta === true,
  unchanged: unchanged === true,
  fetchedCount: toFiniteNumberOr(fetchedCount, 0),
  sheetLastUpdatedAt: toFiniteNumberOr(sheetLastUpdatedAt, 0),
});

export const buildUpsertEntryRecord = ({
  formId,
  payload = {},
  existingEntry = null,
  now = Date.now(),
  nextRecordNo = null,
} = {}) => {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const existingCreatedAtUnixMs = resolveStrictUnixMs(existingEntry?.createdAtUnixMs, existingEntry?.createdAt);
  let createdAtUnixMs = resolveStrictUnixMs(safePayload.createdAtUnixMs, safePayload.createdAt);
  if (!Number.isFinite(createdAtUnixMs)) createdAtUnixMs = existingCreatedAtUnixMs;
  if (!Number.isFinite(createdAtUnixMs)) createdAtUnixMs = now;

  const hasExplicitRecordNo = !(
    safePayload["No."] === undefined
    || safePayload["No."] === null
    || safePayload["No."] === ""
  );
  const resolvedRecordNo = hasExplicitRecordNo
    ? safePayload["No."]
    : (
      existingEntry?.["No."] !== undefined
      && existingEntry?.["No."] !== null
      && existingEntry?.["No."] !== ""
        ? existingEntry["No."]
        : (nextRecordNo ?? "")
    );

  const resolvedData = hasOwn(safePayload, "data") ? safePayload.data : existingEntry?.data;
  const resolvedDataUnixMs = hasOwn(safePayload, "dataUnixMs") ? safePayload.dataUnixMs : existingEntry?.dataUnixMs;
  const resolvedDeletedAt = hasOwn(safePayload, "deletedAt") ? safePayload.deletedAt : existingEntry?.deletedAt;
  const resolvedDeletedAtUnixMs = hasOwn(safePayload, "deletedAtUnixMs") ? safePayload.deletedAtUnixMs : existingEntry?.deletedAtUnixMs;
  const resolvedDeletedBy = hasOwn(safePayload, "deletedBy") ? safePayload.deletedBy : existingEntry?.deletedBy;
  const fallbackOrder = Object.keys(asPlainObject(resolvedData));

  return normalizeRecordForCache({
    ...existingEntry,
    ...safePayload,
    id: safePayload.id || existingEntry?.id || genRecordId(),
    formId,
    "No.": resolvedRecordNo,
    createdAt: createdAtUnixMs,
    createdAtUnixMs,
    createdBy: hasOwn(safePayload, "createdBy") ? safePayload.createdBy : (existingEntry?.createdBy ?? ""),
    modifiedAt: now,
    modifiedAtUnixMs: now,
    modifiedBy: hasOwn(safePayload, "modifiedBy") ? safePayload.modifiedBy : (existingEntry?.modifiedBy ?? ""),
    deletedAt: resolvedDeletedAt,
    deletedAtUnixMs: resolvedDeletedAtUnixMs,
    deletedBy: resolvedDeletedBy ?? "",
    data: resolvedData,
    dataUnixMs: resolvedDataUnixMs,
    order: hasOwn(safePayload, "order") ? safePayload.order : (existingEntry?.order ?? fallbackOrder),
  }, { formId });
};
