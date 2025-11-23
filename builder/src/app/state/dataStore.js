import { computeSchemaHash, stripSchemaIDs } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
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
  hasScriptRun,
  debugGetMapping,
} from "../../services/gasClient.js";

const FORMS_STORAGE_KEY = "nfb.forms.v1";
const ENTRIES_STORAGE_KEY = "nfb.entries.v1";

const nowIso = () => new Date().toISOString();
const nowUnixMs = () => Date.now();
const DEFAULT_SHEET_NAME = "Responses";

const readStorage = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`failed to read localStorage key ${key}`, error);
    return fallback;
  }
};

const writeStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`failed to write localStorage key ${key}`, error);
  }
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

const cacheEntries = (formId, entries) =>
  persistEntries((entriesByForm) => {
    entriesByForm[formId] = entries;
    return entriesByForm;
  });

const loadForms = () => {
  const forms = readStorage(FORMS_STORAGE_KEY, []);
  return (Array.isArray(forms) ? forms : []).map((form) => ensureDisplayInfo(form));
};
const loadEntries = () => readStorage(ENTRIES_STORAGE_KEY, {});

const saveForms = (forms) => writeStorage(FORMS_STORAGE_KEY, forms);
const saveEntries = (entries) => writeStorage(ENTRIES_STORAGE_KEY, entries);

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

const getEntriesForForm = (entriesByForm, formId) => {
  const list = Array.isArray(entriesByForm[formId]) ? entriesByForm[formId] : [];
  return list.slice();
};

const persistForms = (producer) => {
  const forms = loadForms();
  const nextForms = producer(forms.slice());
  saveForms(nextForms);
  return nextForms;
};

const persistEntries = (producer) => {
  const entries = loadEntries();
  const nextEntries = producer({ ...entries });
  saveEntries(nextEntries);
  return nextEntries;
};

export const dataStore = {
  async listForms({ includeArchived = false } = {}) {
    // Try to fetch from Google Drive via GAS
    if (hasScriptRun()) {
      try {
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
        };
      } catch (error) {
        console.warn("[dataStore] Failed to fetch forms from Google Drive, falling back to localStorage:", error);
      }
    }

    // Fallback to localStorage
    const forms = loadForms();
    console.log("[dataStore.listForms] Using localStorage:", { count: forms.length });
    const filtered = forms.filter((form) => includeArchived || !form.archived);
    return {
      forms: filtered,
      loadFailures: [],
    };
  },
  async getForm(formId) {
    // Try to fetch from Google Drive via GAS
    if (hasScriptRun()) {
      try {
        const form = await getFormFromGas(formId);
        return form ? ensureDisplayInfo(form) : null;
      } catch (error) {
        console.warn("[dataStore] Failed to fetch form from Google Drive, falling back to localStorage:", error);
      }
    }

    // Fallback to localStorage
    const forms = loadForms();
    return forms.find((form) => form.id === formId) || null;
  },
  async createForm(payload, targetUrl = null) {
    // buildFormRecordにID生成を委ねる（payloadにidがあればそれを使用、なければ生成）
    const record = buildFormRecord(payload);
    console.log("[dataStore.createForm] Creating form:", { id: record.id, hasPayloadId: !!payload.id, targetUrl });

    // Try to save to Google Drive via GAS
    if (hasScriptRun()) {
      try {
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
      } catch (error) {
        console.warn("[dataStore] Failed to save form to Google Drive, falling back to localStorage:", error);
      }
    }

    // Fallback to localStorage
    persistForms((forms) => {
      forms.push(record);
      return forms;
    });
    return record;
  },
  async updateForm(formId, updates, targetUrl = null) {
    // First get the current form
    let current = await this.getForm(formId);

    // If getForm failed (returns null), try to use existing form data from updates
    // This handles the case where GAS getForm fails but we already have the form in memory
    if (!current) {
      // If updates contains enough data to reconstruct the form, use it
      if (updates && updates.id === formId && updates.createdAt) {
        current = updates;
      } else {
        throw new Error("Form not found: " + formId);
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

    // Try to save to Google Drive via GAS
    if (hasScriptRun()) {
      try {
        const result = await saveFormToGas(next, targetUrl);
        const savedForm = result?.form || result;
        const fileUrl = result?.fileUrl;

        // fileUrlをフォームに保存（新しいURLが返された場合は更新）
        const formWithUrl = { ...savedForm, driveFileUrl: fileUrl || next.driveFileUrl };
        return formWithUrl ? ensureDisplayInfo(formWithUrl) : next;
      } catch (error) {
        console.warn("[dataStore] Failed to update form in Google Drive, falling back to localStorage:", error);
      }
    }

    // Fallback to localStorage
    let updated = null;
    persistForms((forms) => {
      const index = forms.findIndex((form) => form.id === formId);
      if (index === -1) return forms;
      updated = next;
      forms[index] = next;
      return forms;
    });
    return updated;
  },
  async setFormArchivedState(formId, archived) {
    const nowMs = nowUnixMs();
    // Try to use GAS API
    if (hasScriptRun()) {
      try {
        const savedForm = archived ? await archiveFormInGas(formId) : await unarchiveFormInGas(formId);
        return savedForm ? ensureDisplayInfo(savedForm) : null;
      } catch (error) {
        console.warn("[dataStore] Failed to update form archive state in Google Drive, falling back to localStorage:", error);
      }
    }

    // Fallback to localStorage
    let updated = null;
    persistForms((forms) => {
      const index = forms.findIndex((form) => form.id === formId);
      if (index === -1) return forms;
      const current = forms[index];
      const next = { ...current, archived, modifiedAt: nowIso(), modifiedAtUnixMs: nowMs };
      updated = next;
      forms[index] = next;
      return forms;
    });
    return updated;
  },
  async archiveForm(formId) {
    return this.setFormArchivedState(formId, true);
  },
  async unarchiveForm(formId) {
    return this.setFormArchivedState(formId, false);
  },
  async deleteForms(formIds) {
    const targetIds = Array.isArray(formIds) ? formIds.filter(Boolean) : [formIds].filter(Boolean);
    if (!targetIds.length) return;

    // Try to delete from Google Drive via GAS (batch first, fallback to single)
    if (hasScriptRun()) {
      try {
        await deleteFormsFromGas(targetIds);
      } catch (batchError) {
        console.warn("[dataStore] Failed to batch delete forms via GAS, fallback to single delete:", batchError);
        for (const formId of targetIds) {
          try {
            await deleteFormFromGas(formId);
          } catch (singleError) {
            console.warn(`[dataStore] Failed to delete form ${formId} via GAS`, singleError);
          }
        }
      }
    }

    // Also delete from localStorage
    persistForms((forms) => forms.filter((form) => !targetIds.includes(form.id)));
    persistEntries((entries) => {
      const next = { ...entries };
      targetIds.forEach((formId) => {
        delete next[formId];
      });
      return next;
    });
  },
  async deleteForm(formId) {
    await this.deleteForms([formId]);
  },
  async upsertEntry(formId, payload) {
    let saved = null;
    persistEntries((entriesByForm) => {
      const list = getEntriesForForm(entriesByForm, formId);
      const now = nowIso();
      const nowMs = nowUnixMs();
      if (payload.id) {
        const idx = list.findIndex((entry) => entry.id === payload.id);
        if (idx !== -1) {
          const current = list[idx];
          const next = {
            ...current,
            ...payload,
            id: current.id,
            formId,
            createdAt: current.createdAt,
            createdAtUnixMs: current.createdAtUnixMs ?? nowMs,
            modifiedAt: now,
            modifiedAtUnixMs: nowMs,
            data: payload.data || current.data,
            dataUnixMs: payload.dataUnixMs || current.dataUnixMs || {},
            order: payload.order || current.order || Object.keys(payload.data || current.data || {}),
          };
          list[idx] = next;
          saved = next;
        }
      }
      if (!saved) {
        const record = {
          id: payload.id || genId(),
          formId,
          createdAt: now,
          createdAtUnixMs: nowMs,
          modifiedAt: now,
          modifiedAtUnixMs: nowMs,
          data: payload.data || {},
          dataUnixMs: payload.dataUnixMs || {},
          order: payload.order || Object.keys(payload.data || {}),
        };
        list.unshift(record);
        saved = record;
      }
      entriesByForm[formId] = list;
      return entriesByForm;
    });
    return saved;
  },
  async listEntries(formId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);

    if (sheetConfig) {
      try {
        const gasResult = await listEntriesFromGas(sheetConfig);
        const entries = (gasResult.records || []).map((record) => mapSheetRecordToEntry(record, formId));

        // Sort by ID in ascending order when fetching from spreadsheet
        entries.sort((a, b) => {
          if (a.id < b.id) return -1;
          if (a.id > b.id) return 1;
          return 0;
        });

        cacheEntries(formId, entries);
        return { entries, headerMatrix: gasResult.headerMatrix || [] };
      } catch (error) {
        console.error("[dataStore] Failed to fetch from Google Sheets:", error);
      }
    }

    const entries = loadEntries();
    return { entries: getEntriesForForm(entries, formId), headerMatrix: [] };
  },
  async getEntry(formId, entryId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);

    if (sheetConfig) {
      try {
        const record = await getEntryFromGas({ ...sheetConfig, entryId });
        return record ? mapSheetRecordToEntry(record, formId) : null;
      } catch (error) {
        console.error("[dataStore.getEntry] Spreadsheet取得エラー:", error);
      }
    }

    const entries = loadEntries();
    return getEntriesForForm(entries, formId).find((entry) => entry.id === entryId) || null;
  },
  async deleteEntry(formId, entryId) {
    const form = await this.getForm(formId);
    const sheetConfig = getSheetConfig(form);

    if (sheetConfig) {
      try {
        await deleteEntryFromGas({ ...sheetConfig, entryId });
      } catch (error) {
        console.error("[dataStore] Failed to delete from Google Sheets:", error);
        throw new Error(`スプレッドシートからの削除に失敗しました: ${error.message}`);
      }
    }

    persistEntries((entriesByForm) => {
      const list = getEntriesForForm(entriesByForm, formId).filter((entry) => entry.id !== entryId);
      entriesByForm[formId] = list;
      return entriesByForm;
    });
  },
  async importForms(jsonList) {
    const created = [];
    persistForms((forms) => {
      jsonList.forEach((item) => {
        if (!item) return;
        // buildFormRecordにID生成を委ねる（itemにidがあればそれを使用、なければ生成）
        const record = buildFormRecord({
          ...item,
          createdAt: item.createdAt,
          schemaVersion: item.schemaVersion,
        });
        created.push(record);
        forms.push(record);
      });
      return forms;
    });
    return created;
  },
  async exportForms(formIds) {
    // Get forms from current source (Google Drive or localStorage)
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
