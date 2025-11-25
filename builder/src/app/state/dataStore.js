import { computeSchemaHash, stripSchemaIDs } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import {
  getCachedEntryWithIndex,
  clearRecordsCache,
  saveRecordsToCache,
  upsertRecordInCache,
  updateRecordsMeta,
} from "./recordsCache.js";
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

const nowIso = () => new Date().toISOString();
const nowUnixMs = () => Date.now();
const DEFAULT_SHEET_NAME = "Responses";

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
  formId,
  createdAt: record.createdAt,
  modifiedAt: record.modifiedAt,
  createdAtUnixMs: record.createdAtUnixMs ?? null,
  modifiedAtUnixMs: record.modifiedAtUnixMs ?? null,
  data: record.data || {},
  dataUnixMs: record.dataUnixMs || {},
  order: Object.keys(record.data || {}),
});

const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

const buildFormRecord = (input) => {
  const now = nowIso();
  const nowMs = nowUnixMs();
  const schema = Array.isArray(input.schema) ? input.schema : [];
  const displayFieldSettings = collectDisplayFieldSettings(schema);
  
  // settings内にformTitleを確保
  const settings = input.settings || {};
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
    createdAt: input.createdAt || now,
    modifiedAt: now,
    createdAtUnixMs: Number.isFinite(input.createdAtUnixMs) ? input.createdAtUnixMs : nowMs,
    modifiedAtUnixMs: nowMs,
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
    // First get the current form
    const current = await this.getForm(formId);

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
  async archiveForms(formIds) {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return { forms: [], updated: 0 };

    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }

    const result = await archiveFormsInGas(targetIds);
    return {
      forms: (result.forms || []).map((form) => (form ? ensureDisplayInfo(form) : null)).filter(Boolean),
      updated: result.updated || 0,
      errors: result.errors || [],
    };
  },
  async unarchiveForms(formIds) {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return { forms: [], updated: 0 };

    if (!hasScriptRun()) {
      throw new Error("GAS unavailable");
    }

    const result = await unarchiveFormsInGas(targetIds);
    return {
      forms: (result.forms || []).map((form) => (form ? ensureDisplayInfo(form) : null)).filter(Boolean),
      updated: result.updated || 0,
      errors: result.errors || [],
    };
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
    const now = nowIso();
    const nowMs = nowUnixMs();
    const record = {
      id: payload.id || genId(),
      formId,
      createdAt: payload.createdAt || now,
      createdAtUnixMs: Number.isFinite(payload.createdAtUnixMs) ? payload.createdAtUnixMs : nowMs,
      modifiedAt: now,
      modifiedAtUnixMs: nowMs,
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
    const gasResult = await listEntriesFromGas(sheetConfig);
    const entries = (gasResult.records || []).map((record) => mapSheetRecordToEntry(record, formId));

    // Sort by ID in ascending order when fetching from spreadsheet
    entries.sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    const entryIndexMap = {};
    entries.forEach((item, idx) => {
      entryIndexMap[item.id] = idx;
    });

    await saveRecordsToCache(formId, entries, gasResult.headerMatrix || [], { schemaHash: form.schemaHash });
    await updateRecordsMeta(formId, { entryIndexMap });
    const finishedAt = Date.now();
    console.log("[perf][records] listEntries done", { formId, count: entries.length, durationMs: finishedAt - startedAt });
    return { entries, headerMatrix: gasResult.headerMatrix || [], entryIndexMap, cacheTimestamp: Date.now() };
  },
  async getEntry(formId, entryId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);
    if (!sheetConfig) {
      throw new Error("Spreadsheet not configured for this form");
    }

    const { entry: cachedEntry, rowIndex } = await getCachedEntryWithIndex(formId, entryId);
    const startedAt = Date.now();
    console.log("[perf][records] getEntry start", { formId, entryId, rowIndexHint: rowIndex });

    const record = await getEntryFromGas({ ...sheetConfig, entryId, rowIndexHint: rowIndex });
    const mapped = record ? mapSheetRecordToEntry(record, formId) : null;
    if (mapped) {
      await upsertRecordInCache(formId, mapped, { rowIndex });
    }
    const finishedAt = Date.now();
    console.log("[perf][records] getEntry done", { formId, entryId, fromCache: !mapped, durationMs: finishedAt - startedAt });
    return mapped || cachedEntry;
  },
  async deleteEntry(formId, entryId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);

    if (sheetConfig) {
      await deleteEntryFromGas({ ...sheetConfig, entryId });
    } else {
      throw new Error("Spreadsheet not configured for this form");
    }

    await clearRecordsCache(formId);
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
      return clone(cleaned);
    });
  },
};
