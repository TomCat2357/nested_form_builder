import { stripSchemaIDs, deepClone } from "../../core/schema.js";
import { genRecordId } from "../../core/ids.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import { normalizeFormRecord } from "../../utils/formNormalize.js";
import {
  getCachedEntryWithIndex,
  saveRecordsToCache,
  upsertRecordInCache,
  updateRecordsMeta,
  deleteRecordFromCache,
  getMaxRecordNo,
  applyDeltaToCache,
  getRecordsFromCache,
  applySyncResultToCache,
} from "./recordsCache.js";
import { getFormsFromCache } from "./formsCache.js";
import {
  evaluateCache,
  RECORD_CACHE_MAX_AGE_MS,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
} from "./cachePolicy.js";
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
  debugGetMapping,
  registerImportedForm as registerImportedFormInGas,
  syncRecordsProxy,
} from "../../services/gasClient.js";
import { perfLogger } from "../../utils/perfLogger.js";
import { toUnixMs, formatUnixMsDateTimeMs } from "../../utils/dateTime.js";
import { DEFAULT_SHEET_NAME } from "../../core/constants.js";

const nowUnixMs = () => Date.now();

const pendingOperations = new Set();
const trackPendingOperation = (promise) => {
  pendingOperations.add(promise);
  promise.finally(() => pendingOperations.delete(promise));
};

const ensureDisplayInfo = (form) => {
  const schema = Array.isArray(form?.schema) ? form.schema : [];
  const displayFieldSettings = collectDisplayFieldSettings(schema);
  return {
    ...form,
    displayFieldSettings,
    importantFields: displayFieldSettings.map((item) => item.path),
  };
};

const getSheetConfig = (form) => {
  const spreadsheetId = form?.settings?.spreadsheetId;
  if (!spreadsheetId) return null;

  return {
    spreadsheetId,
    sheetName: form?.settings?.sheetName || DEFAULT_SHEET_NAME,
  };
};

const resolveUnixMs = (...candidates) => {
  for (const candidate of candidates) {
    const unixMs = toUnixMs(candidate);
    if (Number.isFinite(unixMs)) return unixMs;
  }
  return null;
};

const mapSheetRecordToEntry = (record, formId) => {
  const createdAtUnixMs = resolveUnixMs(record?.createdAtUnixMs, record?.createdAt);
  const modifiedAtUnixMs = resolveUnixMs(record?.modifiedAtUnixMs, record?.modifiedAt);
  const deletedAtUnixMs = resolveUnixMs(record?.deletedAtUnixMs, record?.deletedAt);
  const serverUploadedAtUnixMs = resolveUnixMs(record?.serverUploadedAtUnixMs, record?.serverUploadedAt);

  return {
    id: record.id,
    "No.": record["No."],
    modifiedBy: record.modifiedBy || "",
    createdBy: record.createdBy || "",
    formId,
    createdAt: Number.isFinite(createdAtUnixMs) ? formatUnixMsDateTimeMs(createdAtUnixMs) : (record.createdAt || ""),
    modifiedAt: Number.isFinite(modifiedAtUnixMs) ? formatUnixMsDateTimeMs(modifiedAtUnixMs) : (record.modifiedAt || ""),
    deletedAt: Number.isFinite(deletedAtUnixMs) ? formatUnixMsDateTimeMs(deletedAtUnixMs) : null,
    serverUploadedAt: Number.isFinite(serverUploadedAtUnixMs) ? formatUnixMsDateTimeMs(serverUploadedAtUnixMs) : null,
    createdAtUnixMs,
    modifiedAtUnixMs,
    deletedAtUnixMs,
    serverUploadedAtUnixMs,
    data: record.data || {},
    dataUnixMs: record.dataUnixMs || {},
    order: Object.keys(record.data || {}),
  };
};

export const dataStore = {
  async listForms({ includeArchived = false } = {}) {

    const result = await listFormsFromGas({ includeArchived });
    const forms = Array.isArray(result.forms) ? result.forms : [];
    const loadFailures = Array.isArray(result.loadFailures) ? result.loadFailures : [];
    console.log("[dataStore.listForms] Fetched from GAS:", {
      count: forms.length,
      formIds: forms.map((f) => f.id),
      loadFailures: loadFailures.length,
    });
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
    console.log("[dataStore.createForm] Creating form:", { id: record.id, hasPayloadId: !!payload.id, targetUrl });

    // Try to save to Google Drive via GAS

    // Debug: 保存前のマッピングを取得
    let beforeMapping = null;
    try {
      beforeMapping = await debugGetMapping();
      console.log("[DEBUG] BEFORE createForm - Mapping:", beforeMapping);
      console.log("[DEBUG] BEFORE createForm - Legacy info:", JSON.stringify(beforeMapping?.legacyInfo, null, 2));
    } catch (debugErr) {
      console.warn("[DEBUG] Failed to get before-mapping:", debugErr);
    }

    const result = await saveFormToGas(record, targetUrl, saveMode);
    console.log("[dataStore.createForm] GAS result:", { formId: result?.form?.id, fileUrl: result?.fileUrl });
    console.log("[dataStore.createForm] GAS debugRawJsonBefore:", result?.debugRawJsonBefore);
    console.log("[dataStore.createForm] GAS debugRawJsonAfter:", result?.debugRawJsonAfter);
    console.log("[dataStore.createForm] GAS debugMappingStr:", result?.debugMappingStr);

    // Debug: 保存後のマッピングを取得
    try {
      const afterMapping = await debugGetMapping();
      console.log("[DEBUG] AFTER createForm - Mapping:", afterMapping);
      console.log("[DEBUG] Mapping changed from", beforeMapping?.totalForms, "to", afterMapping?.totalForms, "forms");
    } catch (debugErr) {
      console.warn("[DEBUG] Failed to get after-mapping:", debugErr);
    }

    const savedForm = result?.form || result;
    const fileUrl = result?.fileUrl;

    // fileUrlをフォームに保存
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
  async deleteForms(formIds) {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return;

    await deleteFormsFromGas(targetIds);
  },
  async deleteForm(formId) {
    await this.deleteForms([formId]);
  },
  async upsertEntry(formId, payload) {
    const now = Date.now();
    let createdAtUnix = toUnixMs(payload.createdAtUnixMs);
    if (!Number.isFinite(createdAtUnix)) createdAtUnix = toUnixMs(payload.createdAt);
    const resolvedCreatedAt = Number.isFinite(createdAtUnix) ? createdAtUnix : now;

    let no = payload['No.'];
    if (no === undefined || no === null || no === "") {
      const maxNo = await getMaxRecordNo(formId);
      no = maxNo + 1;
    }

    const record = {
      'No.': no,
      id: payload.id || genRecordId(),
      formId,
      createdBy: payload.createdBy || "",
      modifiedBy: payload.modifiedBy || "",
      createdAt: formatUnixMsDateTimeMs(resolvedCreatedAt),
      createdAtUnixMs: resolvedCreatedAt,
      modifiedAt: formatUnixMsDateTimeMs(now),
      modifiedAtUnixMs: now,
      data: payload.data || {},
      dataUnixMs: payload.dataUnixMs || {},
      order: payload.order || Object.keys(payload.data || {}),
    };
    await upsertRecordInCache(formId, record, { headerMatrix: payload.headerMatrix, rowIndex: payload.rowIndex });
    return record;
  },
  async listEntries(formId, { forceFullSync = false } = {}) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    if (!sheetConfig) throw new Error("Spreadsheet not configured for this form");

    const cacheMeta = await getRecordsFromCache(formId);
    const lastServerReadAt = forceFullSync ? 0 : (cacheMeta.lastServerReadAt || 0);
    const unsynced = forceFullSync
      ? []
      : cacheMeta.entries
        .filter((entry) => (entry.modifiedAtUnixMs || 0) > lastServerReadAt)
        .map((entry) => {
          const createdAtUnixMs = resolveUnixMs(entry?.createdAtUnixMs, entry?.createdAt);
          const modifiedAtUnixMs = resolveUnixMs(entry?.modifiedAtUnixMs, entry?.modifiedAt);
          const deletedAtUnixMs = resolveUnixMs(entry?.deletedAtUnixMs, entry?.deletedAt);
          const serverUploadedAtUnixMs = resolveUnixMs(entry?.serverUploadedAtUnixMs, entry?.serverUploadedAt);
          return {
            ...entry,
            createdAt: Number.isFinite(createdAtUnixMs) ? formatUnixMsDateTimeMs(createdAtUnixMs) : (entry.createdAt || ""),
            modifiedAt: Number.isFinite(modifiedAtUnixMs) ? formatUnixMsDateTimeMs(modifiedAtUnixMs) : (entry.modifiedAt || ""),
            deletedAt: Number.isFinite(deletedAtUnixMs) ? formatUnixMsDateTimeMs(deletedAtUnixMs) : null,
            serverUploadedAt: Number.isFinite(serverUploadedAtUnixMs) ? formatUnixMsDateTimeMs(serverUploadedAtUnixMs) : null,
          };
        });

    const payload = {
      ...sheetConfig,
      formId,
      formSchema: form.schema,
      lastServerReadAt,
      uploadRecords: unsynced,
      forceNumbering: forceFullSync
    };

    const gasResult = await syncRecordsProxy(payload);
    const syncedRecords = (gasResult.records || []).map((record) => mapSheetRecordToEntry(record, formId));
    const nextLastServerReadAt = resolveUnixMs(gasResult.serverUploadedAt, gasResult.serverCommitToken, Date.now()) || Date.now();

    await applySyncResultToCache(formId, syncedRecords, gasResult.headerMatrix || [], {
      serverCommitToken: gasResult.serverCommitToken,
      lastServerReadAt: nextLastServerReadAt,
    });

    const fullCache = await getRecordsFromCache(formId);
    const hasUnsynced = fullCache.entries.some(e => (e.modifiedAtUnixMs || 0) > (fullCache.lastServerReadAt || 0));

    return {
      entries: fullCache.entries,
      headerMatrix: fullCache.headerMatrix,
      lastSyncedAt: Date.now(),
      lastSpreadsheetReadAt: fullCache.lastServerReadAt || null,
      hasUnsynced,
      isDelta: false,
    };
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
      lastSpreadsheetReadAt,
    } = await getCachedEntryWithIndex(formId, entryId);
    const tGetCacheEnd = performance.now();
    perfLogger.logVerbose("records", "getEntry cache lookup", {
      durationMs: Number((tGetCacheEnd - tGetCacheStart).toFixed(2)),
      formId,
      entryId,
    });

    // rowIndexHintが明示的に渡された場合はそれを優先、なければキャッシュから取得したものを使用
    const effectiveRowIndex = rowIndexHint !== undefined ? rowIndexHint : cachedRowIndex;

    const { age: cacheAge, shouldSync, shouldBackground } = evaluateCache({
      lastSyncedAt,
      hasData: !!cachedEntry,
      forceSync,
      maxAgeMs: RECORD_CACHE_MAX_AGE_MS,
      backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS,
    });

    // 1分(60,000ms)以内であれば強制同期(forceSync: true)でもキャッシュを優先して通信を避ける
    const isVeryFresh = cacheAge < 60000;
    
    if (cachedEntry && (isVeryFresh || (!shouldSync && !forceSync))) {
      if (shouldBackground) {
        const bgStartedAt = Date.now();
        getEntryFromGas({ ...sheetConfig, entryId, rowIndexHint: effectiveRowIndex })
          .then((result) => {
            const mapped = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
            if (mapped) upsertRecordInCache(formId, mapped, { rowIndex: result.rowIndex ?? effectiveRowIndex, syncStartedAt: bgStartedAt });
          }).catch(() => {});
      }
      return cachedEntry;
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
      const listResult = await this.listEntries(formId, {
        lastSyncedAt,
        lastSpreadsheetReadAt,
        forceFullSync: false,
      });
      return listResult.entries.find(e => e.id === entryId) || null;
    }

    const tBeforeMap = performance.now();
    const mapped = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
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
      fromCache: !!cachedEntry,
      durationMs: finishedAt - startedAt,
      fallbackCache: true,
    });
    if (cachedEntry) {
      perfLogger.logRecordCacheHit(tGetCacheEnd - tGetCacheStart, entryId);
    }
    return cachedEntry;
  },
  async deleteEntry(formId, entryId) {
    const entry = await this.getEntry(formId, entryId);
    if (!entry) return;
    const now = Date.now();
    const deletedAt = formatUnixMsDateTimeMs(now);
    const deleted = { ...entry, deletedAt, deletedAtUnixMs: now, modifiedAtUnixMs: now, modifiedAt: deletedAt };
    await upsertRecordInCache(formId, deleted);
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
