import { genRecordId } from "../../core/ids.js";
import { resolveStrictUnixMs } from "../../utils/dateTime.js";
import { DEFAULT_DELETED_RETENTION_DAYS, DEFAULT_SHEET_NAME, MS_PER_DAY } from "../../core/constants.js";
import { deleteRecordsFromCache } from "./recordsCache.js";
import { normalizeRecordForCache } from "./recordMerge.js";

export const getSheetConfig = (form) => {
  const spreadsheetId = form?.settings?.spreadsheetId;
  if (!spreadsheetId) return null;

  return {
    spreadsheetId,
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
  const safeEntries = Array.isArray(entries) ? entries : [];
  return safeEntries.filter((entry) => !isDeletedEntryExpired(entry, retentionDays, nowMs));
};

export const pruneExpiredDeletedEntries = async (formId, entries, retentionDays) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
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
  entries: Array.isArray(entries) ? entries : [],
  headerMatrix: Array.isArray(headerMatrix) ? headerMatrix : [],
  lastSyncedAt,
  lastSpreadsheetReadAt,
  hasUnsynced: !!hasUnsynced,
  unsyncedCount: Number.isFinite(Number(unsyncedCount)) ? Number(unsyncedCount) : 0,
  isDelta: isDelta === true,
  unchanged: unchanged === true,
  fetchedCount: Number.isFinite(Number(fetchedCount)) ? Number(fetchedCount) : 0,
  sheetLastUpdatedAt: Number.isFinite(Number(sheetLastUpdatedAt)) ? Number(sheetLastUpdatedAt) : 0,
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
  const fallbackOrder = Object.keys((resolvedData && typeof resolvedData === "object" && !Array.isArray(resolvedData)) ? resolvedData : {});

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
