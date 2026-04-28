import { stripSchemaIDs, deepClone } from "../../core/schema.js";
import { normalizeFormRecord } from "../../utils/formNormalize.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import {
  getCachedEntryWithIndex,
  saveRecordsToCache,
  upsertRecordInCache,
  updateRecordsMeta,
  deleteRecordFromCache,
  getMaxRecordNo,
  getRecordsFromCache,
  applySyncResultToCache,
} from "./recordsCache.js";
import { mergeRecordsByModifiedAt } from "./recordMerge.js";
import { buildUploadRecordsForSync } from "./syncUploadPlan.js";
import { getFormsFromCache } from "./formsCache.js";
import { evaluateCacheForRecords } from "./cachePolicy.js";
import {
  getEntry as getEntryFromGas,
  listForms as listFormsFromGas,
  getForm as getFormFromGas,
  saveForm as saveFormToGas,
  deleteFormFromDrive as deleteFormFromGas,
  deleteFormsFromDrive as deleteFormsFromGas,
  archiveForm as archiveFormInGas,
  unarchiveForm as unarchiveFormInGas,
  archiveForms as archiveFormsInGas,
  unarchiveForms as unarchiveFormsInGas,
  setFormReadOnly as setFormReadOnlyInGas,
  clearFormReadOnly as clearFormReadOnlyInGas,
  setFormsReadOnly as setFormsReadOnlyInGas,
  clearFormsReadOnly as clearFormsReadOnlyInGas,
  registerImportedForm as registerImportedFormInGas,
  copyForm as copyFormFromGas,
  syncRecordsProxy,
} from "../../services/gasClient.js";
import { perfLogger } from "../../utils/perfLogger.js";
import {
  getSheetConfig,
  getDeletedRetentionDays,
  isDeletedEntryExpired,
  pruneExpiredDeletedEntries,
  mapSheetRecordToEntry,
  normalizeListEntriesOptions,
  buildGetEntryFallbackListEntriesOptions,
  buildListEntriesResult,
  buildUpsertEntryRecord,
} from "./dataStoreHelpers.js";

// ---------------------------------------------------------------------------
// dataStore-local helpers (moved from dataStoreHelpers.js)
// ---------------------------------------------------------------------------

const pendingOperations = new Set();

const displayInfoCache = new Map();

const resolveSchemaVersionKey = (form) => {
  if (!form || !form.id) return "";
  if (form.schemaHash) return `hash:${form.schemaHash}`;
  return `fallback:${form.updatedAtUnixMs || form.modifiedAtUnixMs || form.updatedAt || form.modifiedAt || "none"}`;
};

const ensureDisplayInfo = (form) => {
  const schema = Array.isArray(form?.schema) ? form.schema : [];
  const cacheKey = resolveSchemaVersionKey(form);
  const cached = displayInfoCache.get(form?.id);
  const displayInfo = cached?.versionKey === cacheKey
    ? cached
    : (() => {
      const displayFieldSettings = collectDisplayFieldSettings(schema);
      const importantFields = displayFieldSettings.map((item) => item.path);
      const next = { versionKey: cacheKey, displayFieldSettings, importantFields };
      if (form?.id) displayInfoCache.set(form.id, next);
      return next;
    })();

  return {
    ...form,
    displayFieldSettings: displayInfo.displayFieldSettings,
    importantFields: displayInfo.importantFields,
  };
};

export const dataStore = {
  async listForms({ includeArchived = false } = {}) {

    const result = await listFormsFromGas({ includeArchived });
    const forms = Array.isArray(result.forms) ? result.forms : [];
    const loadFailures = Array.isArray(result.loadFailures) ? result.loadFailures : [];
    return {
      forms: forms.map((form) => ensureDisplayInfo(form)),
      loadFailures,
      source: "gas",
    };
  },
  async getForm(formId) {
    try {
      const { forms = [] } = await getFormsFromCache();
      const cachedForm = forms.find((form) => form.id === formId);
      if (cachedForm) {
        return ensureDisplayInfo(cachedForm);
      }
    } catch (error) {
      console.warn("[dataStore.getForm] Cache lookup failed, falling back to GAS:", error);
    }
    const form = await getFormFromGas(formId);
    return form ? ensureDisplayInfo(form) : null;
  },
  async createForm(payload, targetUrl = null, saveMode = "auto") {
    // normalizeFormRecordにID生成を委ねる（payloadにidがあればそれを使用、なければ生成）
    const record = normalizeFormRecord(payload);
    const result = await saveFormToGas(record, targetUrl, saveMode);
    const savedForm = result?.form || result;
    const fileUrl = result?.fileUrl;
    const formWithUrl = { ...savedForm, driveFileUrl: fileUrl };
    return formWithUrl ? ensureDisplayInfo(formWithUrl) : record;
  },
  async registerImportedForm(payload) {
    // payload: { form, fileId, fileUrl }
    const result = await registerImportedFormInGas(payload);
    const form = result?.form;
    const fileUrl = result?.fileUrl || payload.fileUrl;
    return form ? ensureDisplayInfo({ ...form, driveFileUrl: fileUrl }) : null;
  },
  async copyForm(formId) {
    const result = await copyFormFromGas(formId);
    const savedForm = result?.form || result;
    const fileUrl = result?.fileUrl;
    const formWithUrl = { ...savedForm, driveFileUrl: fileUrl };
    return formWithUrl ? ensureDisplayInfo(formWithUrl) : null;
  },
  async updateForm(formId, updates, targetUrl = null, saveMode = "auto") {
    // First get the current form. If GAS fetch fails, fallback to provided updates.
    let current = null;
    try {
      current = await this.getForm(formId);
    } catch (error) {
      console.warn("[dataStore.updateForm] Failed to fetch current form, fallback to updates:", error);
    }

    if (!current) {
      if (updates?.id || updates?.schema || updates?.settings) {
        current = {
          id: formId,
          createdAt: updates.createdAt,
          archived: updates.archived,
          schemaVersion: updates.schemaVersion,
          driveFileUrl: updates.driveFileUrl,
          ...updates,
        };
      } else {
        throw new Error("Current form not found");
      }
    }

    const next = normalizeFormRecord({
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      archived: updates.archived ?? current.archived,
      schemaVersion: updates.schemaVersion ?? current.schemaVersion,
      driveFileUrl: current.driveFileUrl, // 既存のURLを保持
    });
    // schema 未更新時は既存 schemaHash を維持。normalizeFormRecord は毎回再計算するが、
    // GAS 側が保存時に Forms_stripSchemaIds_ で field id を落とすため、ロード後の
    // schema から再計算した hash は「初回保存時の hash」と一致せず、テーマ変更だけで
    // /search の records cache が schemaMismatch として消えてしまう。
    if (updates.schema === undefined && current.schemaHash) {
      next.schemaHash = current.schemaHash;
    }
    const result = await saveFormToGas(next, targetUrl, saveMode);
    const savedForm = result?.form || result;
    const fileUrl = result?.fileUrl;

    // fileUrlをフォームに保存（新しいURLが返された場合は更新）
    const formWithUrl = { ...savedForm, driveFileUrl: fileUrl || next.driveFileUrl };
    return formWithUrl ? ensureDisplayInfo(formWithUrl) : next;
  },
  async setFormArchivedState(formId, archived) {
    const savedForm = archived ? await archiveFormInGas(formId) : await unarchiveFormInGas(formId);
    return savedForm ? ensureDisplayInfo(savedForm) : null;
  },
  async archiveForm(formId) {
    return this.setFormArchivedState(formId, true);
  },
  async unarchiveForm(formId) {
    return this.setFormArchivedState(formId, false);
  },
  async _batchArchiveAction(formIds, gasFn) {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return { forms: [], updated: 0 };

    const result = await gasFn(targetIds);
    return {
      forms: (result.forms || []).map((form) => (form ? ensureDisplayInfo(form) : null)).filter(Boolean),
      updated: result.updated || 0,
      errors: result.errors || [],
    };
  },
  async archiveForms(formIds) {
    return this._batchArchiveAction(formIds, archiveFormsInGas);
  },
  async unarchiveForms(formIds) {
    return this._batchArchiveAction(formIds, unarchiveFormsInGas);
  },
  async setFormReadOnlyState(formId, readOnly) {
    const savedForm = readOnly ? await setFormReadOnlyInGas(formId) : await clearFormReadOnlyInGas(formId);
    return savedForm ? ensureDisplayInfo(savedForm) : null;
  },
  async setFormReadOnly(formId) {
    return this.setFormReadOnlyState(formId, true);
  },
  async clearFormReadOnly(formId) {
    return this.setFormReadOnlyState(formId, false);
  },
  async setFormsReadOnly(formIds) {
    return this._batchArchiveAction(formIds, setFormsReadOnlyInGas);
  },
  async clearFormsReadOnly(formIds) {
    return this._batchArchiveAction(formIds, clearFormsReadOnlyInGas);
  },
  async deleteForms(formIds) {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return;

    await deleteFormsFromGas(targetIds);
  },
  async deleteForm(formId) {
    await this.deleteForms([formId]);
  },
  async upsertEntry(formId, payload) {
    const safePayload = payload && typeof payload === "object" ? payload : {};
    const now = Date.now();
    const cached = safePayload.id ? await getCachedEntryWithIndex(formId, safePayload.id) : { entry: null, rowIndex: null };
    const existingEntry = cached.entry;

    let nextRecordNo = null;
    const payloadRecordNo = safePayload["No."];
    const existingRecordNo = existingEntry?.["No."];
    const needsNewRecordNo = (
      payloadRecordNo === undefined
      || payloadRecordNo === null
      || payloadRecordNo === ""
    ) && (
      existingRecordNo === undefined
      || existingRecordNo === null
      || existingRecordNo === ""
    );
    if (needsNewRecordNo) {
      const maxNo = await getMaxRecordNo(formId);
      nextRecordNo = maxNo + 1;
    }

    const record = buildUpsertEntryRecord({
      formId,
      payload: safePayload,
      existingEntry,
      now,
      nextRecordNo,
    });
    await upsertRecordInCache(formId, record, {
      headerMatrix: safePayload.headerMatrix,
      rowIndex: safePayload.rowIndex ?? cached.rowIndex,
    });
    return record;
  },
  /**
   * @param {string} formId
   * @param {ListEntriesOptions} [options]
   */
  async listEntries(formId, options = {}) {
    const { forceFullSync } = normalizeListEntriesOptions(options);
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    const deletedRetentionDays = getDeletedRetentionDays(form);
    if (!sheetConfig) throw new Error("Spreadsheet not configured for this form");

    const cacheMeta = await getRecordsFromCache(formId);
    const prunedCachedEntries = await pruneExpiredDeletedEntries(formId, cacheMeta.entries, deletedRetentionDays);
    const baseServerReadAt = cacheMeta.lastServerReadAt || 0;
    const uploadRecords = buildUploadRecordsForSync({
      entries: prunedCachedEntries,
      baseServerReadAt,
      forceFullSync,
    });

    const payload = {
      ...sheetConfig,
      formId,
      formSchema: form.schema,
      lastServerReadAt: baseServerReadAt,
      uploadRecords,
      forceFullSync,
      deletedRetentionDays
    };

    const gasResult = await syncRecordsProxy(payload);
    const unchanged = gasResult?.unchanged === true;
    const syncedRecords = (gasResult.records || []).map((record) => mapSheetRecordToEntry(record, formId));
    const serverModifiedAt = Number(gasResult.serverModifiedAt ?? gasResult.serverCommitToken);
    const sheetLastUpdatedAt = Number(gasResult.sheetLastUpdatedAt);
    const nextLastServerReadAt = Date.now();
    const postSyncHeaderMatrix = Array.isArray(gasResult.headerMatrix)
      ? gasResult.headerMatrix
      : (cacheMeta.headerMatrix || []);
    const normalizedSheetLastUpdatedAt = Number.isFinite(sheetLastUpdatedAt) && sheetLastUpdatedAt > 0
      ? sheetLastUpdatedAt
      : (cacheMeta.lastSpreadsheetReadAt || 0);

    if (unchanged) {
      await updateRecordsMeta(formId, {
        lastReloadedAt: nextLastServerReadAt,
        lastSpreadsheetReadAt: nextLastServerReadAt,
        lastServerReadAt: nextLastServerReadAt,
        serverCommitToken: gasResult.serverCommitToken,
        serverModifiedAt: serverModifiedAt > 0 ? serverModifiedAt : 0,
        schemaHash: form.schemaHash,
        headerMatrix: postSyncHeaderMatrix,
      });

      return buildListEntriesResult({
        entries: prunedCachedEntries,
        headerMatrix: postSyncHeaderMatrix,
        lastSyncedAt: nextLastServerReadAt,
        lastSpreadsheetReadAt: nextLastServerReadAt,
        hasUnsynced: false,
        unsyncedCount: 0,
        isDelta: true,
        unchanged: true,
        fetchedCount: 0,
        sheetLastUpdatedAt: normalizedSheetLastUpdatedAt,
      });
    }

    if (forceFullSync) {
      await saveRecordsToCache(formId, syncedRecords, postSyncHeaderMatrix, {
        sheetLastUpdatedAt: normalizedSheetLastUpdatedAt,
        serverCommitToken: gasResult.serverCommitToken,
        serverModifiedAt: serverModifiedAt > 0 ? serverModifiedAt : 0,
        lastServerReadAt: nextLastServerReadAt,
        schemaHash: form.schemaHash,
      });
    } else {
      await applySyncResultToCache(formId, syncedRecords, postSyncHeaderMatrix, {
        serverCommitToken: gasResult.serverCommitToken,
        serverModifiedAt: serverModifiedAt > 0 ? serverModifiedAt : 0,
        lastServerReadAt: nextLastServerReadAt,
      });
    }

    // シンク後の状態をメモリ内で計算し、不要な2回目のIDB読み取りを回避する
    let postSyncEntries;
    if (forceFullSync) {
      postSyncEntries = syncedRecords;
    } else {
      const existingById = {};
      prunedCachedEntries.forEach((e) => { existingById[e.id] = e; });
      postSyncEntries = Object.values(mergeRecordsByModifiedAt(existingById, syncedRecords)).sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      );
    }

    // 期限切れ tombstone だけをキャッシュから物理除去し、削除済み表示の制御は UI 側に委ねる
    const prunedEntries = await pruneExpiredDeletedEntries(formId, postSyncEntries, deletedRetentionDays);
    const unsyncedCount = prunedEntries.filter((e) => (e.modifiedAtUnixMs || 0) > nextLastServerReadAt).length;
    const hasUnsynced = unsyncedCount > 0;

    return buildListEntriesResult({
      entries: prunedEntries,
      headerMatrix: postSyncHeaderMatrix,
      lastSyncedAt: Date.now(),
      lastSpreadsheetReadAt: nextLastServerReadAt,
      hasUnsynced,
      unsyncedCount,
      isDelta: gasResult?.isDelta === true,
      unchanged: false,
      fetchedCount: syncedRecords.length,
      sheetLastUpdatedAt: normalizedSheetLastUpdatedAt,
    });
  },
  async getEntry(formId, entryId, { forceSync = false, rowIndexHint = undefined } = {}) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    if (!sheetConfig) {
      throw new Error("Spreadsheet not configured for this form");
    }

    const startedAt = Date.now();
    const tGetCacheStart = performance.now();
    const {
      entry: cachedEntry,
      rowIndex: cachedRowIndex,
      lastSyncedAt,
    } = await getCachedEntryWithIndex(formId, entryId);
    const deletedRetentionDays = getDeletedRetentionDays(form);
    const cacheEntryExpired = isDeletedEntryExpired(cachedEntry, deletedRetentionDays);
    if (cacheEntryExpired && cachedEntry?.id) {
      await deleteRecordFromCache(formId, cachedEntry.id);
    }
    const usableCachedEntry = cacheEntryExpired ? null : cachedEntry;
    const tGetCacheEnd = performance.now();
    perfLogger.logVerbose("records", "getEntry cache lookup", {
      durationMs: Number((tGetCacheEnd - tGetCacheStart).toFixed(2)),
      formId,
      entryId,
    });

    // rowIndexHintが明示的に渡された場合はそれを優先、なければキャッシュから取得したものを使用
    const effectiveRowIndex = rowIndexHint !== undefined ? rowIndexHint : cachedRowIndex;

    const { age: cacheAge, shouldSync, shouldBackground } = evaluateCacheForRecords({
      lastSyncedAt,
      hasData: !!usableCachedEntry,
      forceSync,
    });

    // 1分(60,000ms)以内であれば強制同期(forceSync: true)でもキャッシュを優先して通信を避ける
    const isVeryFresh = cacheAge < 60000;
    
    if (usableCachedEntry && (isVeryFresh || (!shouldSync && !forceSync))) {
      if (shouldBackground) {
        const bgStartedAt = Date.now();
        getEntryFromGas({ ...sheetConfig, entryId, rowIndexHint: effectiveRowIndex })
          .then((result) => {
            const mappedRecord = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
            const mapped = isDeletedEntryExpired(mappedRecord, deletedRetentionDays) ? null : mappedRecord;
            if (mapped) upsertRecordInCache(formId, mapped, { rowIndex: result.rowIndex ?? effectiveRowIndex, syncStartedAt: bgStartedAt });
          }).catch(() => {});
      }
      return usableCachedEntry;
    }

    const tBeforeGas = performance.now();
    const result = await getEntryFromGas({
      ...sheetConfig,
      entryId,
      rowIndexHint: effectiveRowIndex,
    });
    const tAfterGas = performance.now();
    perfLogger.logVerbose("records", "getEntry GAS fetch", {
      durationMs: Number((tAfterGas - tBeforeGas).toFixed(2)),
      formId,
      entryId,
    });

    
    // GAS側で「行がずれている（違うIDが返ってきた）」または「見つからなかった（削除された）」場合、
    // 単一取得を諦めて差分更新リスト取得にフォールバックする
    if (!result.ok || !result.record || result.record.id !== entryId) {
      console.log("[dataStore.getEntry] row mismatch or deleted. falling back to delta listEntries.");
      const listResult = await this.listEntries(formId, buildGetEntryFallbackListEntriesOptions());
      return listResult.entries.find(e => e.id === entryId) || null;
    }

    const tBeforeMap = performance.now();
    const mappedRecord = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
    const mapped = isDeletedEntryExpired(mappedRecord, deletedRetentionDays) ? null : mappedRecord;
    const tAfterMap = performance.now();
    perfLogger.logVerbose("records", "getEntry map record", {
      durationMs: Number((tAfterMap - tBeforeMap).toFixed(2)),
      formId,
      entryId,
    });

    if (mapped) {
      const nextRowIndex = typeof result.rowIndex === "number" ? result.rowIndex : effectiveRowIndex;
      const tBeforeUpsert = performance.now();
      await upsertRecordInCache(formId, mapped, { rowIndex: nextRowIndex });
      const tAfterUpsert = performance.now();
      perfLogger.logVerbose("records", "getEntry cache upsert", {
        durationMs: Number((tAfterUpsert - tBeforeUpsert).toFixed(2)),
        formId,
        entryId,
        rowIndex: nextRowIndex,
      });

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      perfLogger.logVerbose("records", "getEntry done", {
        formId,
        entryId,
        fromCache: false,
        durationMs,
        rowIndex: nextRowIndex,
      });
      perfLogger.logRecordGasRead(tAfterGas - tBeforeGas, entryId, "single-sync");
      perfLogger.logRecordCacheUpdate(tAfterUpsert - tBeforeUpsert, entryId);
      return mapped;
    }

    const finishedAt = Date.now();
    perfLogger.logVerbose("records", "getEntry done", {
      formId,
      entryId,
      fromCache: !!usableCachedEntry,
      durationMs: finishedAt - startedAt,
      fallbackCache: true,
    });
    if (usableCachedEntry) {
      perfLogger.logRecordCacheHit(tGetCacheEnd - tGetCacheStart, entryId);
    }
    return usableCachedEntry;
  },
  async deleteEntry(formId, entryId, { deletedBy = "" } = {}) {
    const { entry, rowIndex } = await getCachedEntryWithIndex(formId, entryId);
    if (!entry) return;
    const now = Date.now();
    const deleted = {
      ...entry,
      deletedAt: now,
      deletedAtUnixMs: now,
      deletedBy: deletedBy || entry.deletedBy || "",
      modifiedAtUnixMs: now,
      modifiedAt: now,
      modifiedBy: deletedBy || entry.modifiedBy || "",
    };
    await upsertRecordInCache(formId, deleted, { rowIndex });
  },
  async undeleteEntry(formId, entryId, { modifiedBy = "" } = {}) {
    const { entry, rowIndex } = await getCachedEntryWithIndex(formId, entryId);
    if (!entry) return;
    const now = Date.now();
    const undeleted = {
      ...entry,
      deletedAt: null,
      deletedAtUnixMs: null,
      deletedBy: "",
      modifiedAt: now,
      modifiedAtUnixMs: now,
      modifiedBy: modifiedBy || entry.modifiedBy || "",
    };
    await upsertRecordInCache(formId, undeleted, { rowIndex });
  },
  async importForms(jsonList) {
    const created = [];
    for (const item of jsonList) {
      if (!item) continue;
      const record = normalizeFormRecord({
        ...item,
        createdAt: item.createdAt,
        schemaVersion: item.schemaVersion,
      });
      const result = await saveFormToGas(record);
      const savedForm = result?.form || result;
      created.push(ensureDisplayInfo(savedForm));
    }
    return created;
  },
  async exportForms(formIds) {
    // Get forms from GAS
    const { forms: allForms } = await this.listForms({ includeArchived: true });
    const selected = allForms.filter((form) => formIds.includes(form.id));

    return selected.map((form) => {
      const {
        id,
        schemaHash,
        importantFields,
        displayFieldSettings,
        createdAt,
        modifiedAt,
        archived,
        schemaVersion,
        ...rest
      } = form;
      // スキーマからもIDを除去
      const cleaned = {
        ...rest,
        schema: stripSchemaIDs(rest.schema || []),
      };
      return deepClone(cleaned);
    });
  },
  async flushPendingOperations() {
    await Promise.allSettled(Array.from(pendingOperations));
  },
};
