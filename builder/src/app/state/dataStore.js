import { computeSchemaHash, stripSchemaIDs, deepClone } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import { omitThemeSetting } from "../../utils/settings.js";
import {
  getCachedEntryWithIndex,
  saveRecordsToCache,
  upsertRecordInCache,
  updateRecordsMeta,
  deleteRecordFromCache,
} from "./recordsCache.js";
import {
  evaluateCache,
  RECORD_CACHE_MAX_AGE_MS,
  RECORD_CACHE_BACKGROUND_REFRESH_MS,
} from "./cachePolicy.js";
import {
  deleteEntry as deleteEntryFromGas,
  listEntries as listEntriesFromGas,
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
  hasScriptRun,
  debugGetMapping,
} from "../../services/gasClient.js";
import { perfLogger } from "../../utils/perfLogger.js";
import { toUnixMs } from "../../utils/dateTime.js";

const nowSerial = () => toUnixMs(Date.now());
const DEFAULT_SHEET_NAME = "Data";

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

const mapSheetRecordToEntry = (record, formId) => ({
  id: record.id,
  "No.": record["No."],
  modifiedBy: record.modifiedBy || "",
  formId,
  createdAt: record.createdAt,
  modifiedAt: record.modifiedAt,
  createdAtUnixMs: record.createdAtUnixMs ?? null,
  modifiedAtUnixMs: record.modifiedAtUnixMs ?? null,
  data: record.data || {},
  dataUnixMs: record.dataUnixMs || {},
  order: Object.keys(record.data || {}),
});

const buildFormRecord = (input) => {
  const now = nowSerial();
  const createdAtSerial = Number.isFinite(input.createdAt)
    ? input.createdAt
    : (Number.isFinite(input.createdAtUnixMs) ? input.createdAtUnixMs : toUnixMs(input.createdAt));
  const resolvedCreatedAt = Number.isFinite(createdAtSerial) ? createdAtSerial : now;
  const schema = Array.isArray(input.schema) ? input.schema : [];
  const displayFieldSettings = collectDisplayFieldSettings(schema);
  
  // settings内にformTitleを確保
  const settings = omitThemeSetting(input.settings || {});
  if (!settings.formTitle) {
    settings.formTitle = input.name || "無題のフォーム";
  }
  
  return {
    id: input.id || genId(),
    description: input.description || "",
    schema,
    settings,
    schemaHash: computeSchemaHash(schema),
    importantFields: displayFieldSettings.map((item) => item.path),
    displayFieldSettings,
    createdAt: resolvedCreatedAt,
    modifiedAt: now,
    createdAtUnixMs: resolvedCreatedAt,
    modifiedAtUnixMs: now,
    archived: !!input.archived,
    schemaVersion: Number.isFinite(input.schemaVersion) ? input.schemaVersion : 1,
  };
};

export const dataStore = {
  async listForms({ includeArchived = false } = {}) {
    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }

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
    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }
    const form = await getFormFromGas(formId);
    return form ? ensureDisplayInfo(form) : null;
  },
  async createForm(payload, targetUrl = null) {
    // buildFormRecordにID生成を委ねる（payloadにidがあればそれを使用、なければ生成）
    const record = buildFormRecord(payload);
    console.log("[dataStore.createForm] Creating form:", { id: record.id, hasPayloadId: !!payload.id, targetUrl });

    // Try to save to Google Drive via GAS
    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }

    // Debug: 保存前のマッピングを取得
    let beforeMapping = null;
    try {
      beforeMapping = await debugGetMapping();
      console.log("[DEBUG] BEFORE createForm - Mapping:", beforeMapping);
      console.log("[DEBUG] BEFORE createForm - Legacy info:", JSON.stringify(beforeMapping?.legacyInfo, null, 2));
    } catch (debugErr) {
      console.warn("[DEBUG] Failed to get before-mapping:", debugErr);
    }

    const result = await saveFormToGas(record, targetUrl);
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
  async updateForm(formId, updates, targetUrl = null) {
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

    const next = buildFormRecord({
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      archived: updates.archived ?? current.archived,
      schemaVersion: updates.schemaVersion ?? current.schemaVersion,
      driveFileUrl: current.driveFileUrl, // 既存のURLを保持
    });

    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }
    const result = await saveFormToGas(next, targetUrl);
    const savedForm = result?.form || result;
    const fileUrl = result?.fileUrl;

    // fileUrlをフォームに保存（新しいURLが返された場合は更新）
    const formWithUrl = { ...savedForm, driveFileUrl: fileUrl || next.driveFileUrl };
    return formWithUrl ? ensureDisplayInfo(formWithUrl) : next;
  },
  async setFormArchivedState(formId, archived) {
    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }
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

    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }

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

    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }

    await deleteFormsFromGas(targetIds);
  },
  async deleteForm(formId) {
    await this.deleteForms([formId]);
  },
  async upsertEntry(formId, payload) {
    const now = nowSerial();
    const createdAtSerial = Number.isFinite(payload.createdAt)
      ? payload.createdAt
      : (Number.isFinite(payload.createdAtUnixMs) ? payload.createdAtUnixMs : toUnixMs(payload.createdAt));
    const resolvedCreatedAt = Number.isFinite(createdAtSerial) ? createdAtSerial : now;
    const record = {
      id: payload.id || genId(),
      formId,
      createdAt: resolvedCreatedAt,
      createdAtUnixMs: resolvedCreatedAt,
      modifiedAt: now,
      modifiedAtUnixMs: now,
      data: payload.data || {},
      dataUnixMs: payload.dataUnixMs || {},
      order: payload.order || Object.keys(payload.data || {}),
    };
    await upsertRecordInCache(formId, record, { headerMatrix: payload.headerMatrix, rowIndex: payload.rowIndex });
    return record;
  },
  async listEntries(formId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    if (!sheetConfig) {
      throw new Error("Spreadsheet not configured for this form");
    }
    const startedAt = Date.now();
    console.log("[perf][records] listEntries start", { formId, sheet: sheetConfig.sheetName, startedAt });
    const gasResult = await listEntriesFromGas({ ...sheetConfig, formId });
    const entries = (gasResult.records || []).map((record) => mapSheetRecordToEntry(record, formId));

    // Sort by ID in ascending order when fetching from spreadsheet
    // (binary search in cache assumes ascending order)
    entries.sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    const entryIndexMap = {};
    entries.forEach((item, idx) => {
      entryIndexMap[item.id] = idx;
    });

    const lastSyncedAt = Date.now();
    await saveRecordsToCache(formId, entries, gasResult.headerMatrix || [], { schemaHash: form.schemaHash });
    await updateRecordsMeta(formId, { entryIndexMap, lastReloadedAt: lastSyncedAt });
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    console.log("[perf][records] listEntries done", { formId, count: entries.length, durationMs });
    perfLogger.logRecordGasRead(durationMs, null, "list");
    perfLogger.logRecordList(durationMs, entries.length, false);
    return { entries, headerMatrix: gasResult.headerMatrix || [], entryIndexMap, lastSyncedAt };
  },
  async getEntry(formId, entryId, { forceSync = false, rowIndexHint = undefined } = {}) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    if (!sheetConfig) {
      throw new Error("Spreadsheet not configured for this form");
    }

    const tGetCacheStart = performance.now();
    const { entry: cachedEntry, rowIndex: cachedRowIndex, lastSyncedAt } = await getCachedEntryWithIndex(formId, entryId);
    const tGetCacheEnd = performance.now();
    console.log(`[PERF] dataStore.getEntry getCachedEntryWithIndex - Time: ${(tGetCacheEnd - tGetCacheStart).toFixed(2)}ms`);

    // rowIndexHintが明示的に渡された場合はそれを優先、なければキャッシュから取得したものを使用
    const effectiveRowIndex = rowIndexHint !== undefined ? rowIndexHint : cachedRowIndex;

    const { age: cacheAge, shouldSync, shouldBackground } = evaluateCache({
      lastSyncedAt,
      hasData: !!cachedEntry,
      forceSync,
      maxAgeMs: RECORD_CACHE_MAX_AGE_MS,
      backgroundAgeMs: RECORD_CACHE_BACKGROUND_REFRESH_MS,
    });

    if (!shouldSync && cachedEntry) {
      if (shouldBackground) {
        const backgroundStart = Date.now();
        getEntryFromGas({
          ...sheetConfig,
          entryId,
          rowIndexHint: effectiveRowIndex,
        })
          .then((result) => {
            const backgroundDuration = Date.now() - backgroundStart;
            perfLogger.logRecordGasRead(backgroundDuration, entryId, "single-background");
            const mapped = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
            if (!mapped) return;
            const nextRowIndex = typeof result.rowIndex === "number" ? result.rowIndex : effectiveRowIndex;
            upsertRecordInCache(formId, mapped, { rowIndex: nextRowIndex }).catch((err) => {
              console.error("[perf][records] background cache update failed", err);
            });
          })
          .catch((error) => {
            console.error("[perf][records] background getEntry failed", error);
          });
      }
      console.log("[perf][records] getEntry cache hit", { formId, entryId, cacheAge, rowIndexHint: effectiveRowIndex });
      perfLogger.logRecordCacheHit(tGetCacheEnd - tGetCacheStart, entryId);
      return cachedEntry;
    }

    const startedAt = Date.now();
    console.log("[perf][records] getEntry start", { formId, entryId, rowIndexHint: effectiveRowIndex });

    const tBeforeGas = performance.now();
    const result = await getEntryFromGas({
      ...sheetConfig,
      entryId,
      rowIndexHint: effectiveRowIndex,
    });
    const tAfterGas = performance.now();
    console.log(`[PERF] dataStore.getEntry getEntryFromGas - Time: ${(tAfterGas - tBeforeGas).toFixed(2)}ms`);

    const tBeforeMap = performance.now();
    const mapped = result.record ? mapSheetRecordToEntry(result.record, formId) : null;
    const tAfterMap = performance.now();
    console.log(`[PERF] dataStore.getEntry mapSheetRecordToEntry - Time: ${(tAfterMap - tBeforeMap).toFixed(2)}ms`);

    if (mapped) {
      const nextRowIndex = typeof result.rowIndex === "number" ? result.rowIndex : effectiveRowIndex;
      const tBeforeUpsert = performance.now();
      await upsertRecordInCache(formId, mapped, { rowIndex: nextRowIndex });
      const tAfterUpsert = performance.now();
      console.log(`[PERF] dataStore.getEntry upsertRecordInCache - Time: ${(tAfterUpsert - tBeforeUpsert).toFixed(2)}ms`);

      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;
      console.log("[perf][records] getEntry done", { formId, entryId, fromCache: false, durationMs, rowIndex: nextRowIndex });
      perfLogger.logRecordGasRead(tAfterGas - tBeforeGas, entryId, "single-sync");
      perfLogger.logRecordCacheUpdate(tAfterUpsert - tBeforeUpsert, entryId);
      return mapped;
    }

    const finishedAt = Date.now();
    console.log("[perf][records] getEntry done", { formId, entryId, fromCache: !!cachedEntry, durationMs: finishedAt - startedAt, fallbackCache: true });
    if (cachedEntry) {
      perfLogger.logRecordCacheHit(tGetCacheEnd - tGetCacheStart, entryId);
    }
    return cachedEntry;
  },
  async deleteEntry(formId, entryId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);

    if (sheetConfig) {
      await deleteEntryFromGas({ ...sheetConfig, entryId });
    } else {
      throw new Error("Spreadsheet not configured for this form");
    }

    await deleteRecordFromCache(formId, entryId);
  },
  async importForms(jsonList) {
    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }
    const created = [];
    for (const item of jsonList) {
      if (!item) continue;
      const record = buildFormRecord({
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
};
