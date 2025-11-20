import { computeSchemaHash, stripSchemaIDs } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import {
  deleteEntry as deleteEntryFromGas,
  listEntries as listEntriesFromGas,
  getEntry as getEntryFromGas,
  hasScriptRun,
} from "../../services/gasClient.js";
import { importFormsFromDrive, loadFormsFromDrive, saveFormsToDrive } from "../../services/formsDriveClient.js";

const FORMS_STORAGE_KEY = "nfb.forms.v1";
const ENTRIES_STORAGE_KEY = "nfb.entries.v1";

const nowIso = () => new Date().toISOString();

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

const loadFormsFromLocal = () => {
  const forms = readStorage(FORMS_STORAGE_KEY, []);
  return normalizeFormsList(forms);
};
const loadEntries = () => readStorage(ENTRIES_STORAGE_KEY, {});

const saveFormsToLocal = (forms) => writeStorage(FORMS_STORAGE_KEY, forms);
const saveEntries = (entries) => writeStorage(ENTRIES_STORAGE_KEY, entries);
const normalizeFormsList = (forms) =>
  (Array.isArray(forms) ? forms : []).map((form) => {
    const normalized = ensureDisplayInfo(form);
    const activeDriveUrl = driveFormsUrl || (typeof normalized.driveFileUrl === "string" ? normalized.driveFileUrl : "");
    return {
      ...normalized,
      driveFileUrl: activeDriveUrl,
    };
  });
let cachedForms = null;
let driveFormsUrl = "";

const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

const buildFormRecord = (input) => {
  const now = nowIso();
  const schema = Array.isArray(input.schema) ? input.schema : [];
  const displayFieldSettings = collectDisplayFieldSettings(schema);
  return {
    id: input.id || genId(),
    name: input.name || "無題のフォーム",
    description: input.description || "",
    schema,
    settings: input.settings || {},
    schemaHash: computeSchemaHash(schema),
    importantFields: displayFieldSettings.map((item) => item.path),
    displayFieldSettings,
    createdAt: input.createdAt || now,
    modifiedAt: now,
    archived: !!input.archived,
    schemaVersion: Number.isFinite(input.schemaVersion) ? input.schemaVersion : 1,
    driveFileUrl: typeof input.driveFileUrl === "string" ? input.driveFileUrl : driveFormsUrl,
  };
};

const getEntriesForForm = (entriesByForm, formId) => {
  const list = Array.isArray(entriesByForm[formId]) ? entriesByForm[formId] : [];
  return list.slice();
};

const loadFormsFromDriveIfAvailable = async () => {
  if (!hasScriptRun()) return null;
  try {
    const result = await loadFormsFromDrive();
    if (result?.fileUrl) {
      driveFormsUrl = result.fileUrl;
    }
    const normalized = normalizeFormsList(result?.forms);
    cachedForms = normalized;
    saveFormsToLocal(normalized);
    return normalized;
  } catch (error) {
    console.warn("[dataStore] Failed to load forms from Drive", error);
    return null;
  }
};

const loadFormsWithCache = async () => {
  if (cachedForms) return cachedForms;
  const local = loadFormsFromLocal();
  cachedForms = local;
  const remote = await loadFormsFromDriveIfAvailable();
  return remote || cachedForms;
};

const syncFormsToDrive = async (forms) => {
  if (!hasScriptRun()) return;
  try {
    const result = await saveFormsToDrive({ forms, fileUrl: driveFormsUrl });
    if (result?.fileUrl) {
      driveFormsUrl = result.fileUrl;
      return result;
    }
  } catch (error) {
    console.warn("[dataStore] Failed to save forms to Drive", error);
  }
  return null;
};

const persistForms = async (producer, { fileUrl } = {}) => {
  if (typeof fileUrl === "string") {
    driveFormsUrl = fileUrl.trim();
  }
  const forms = await loadFormsWithCache();
  const nextForms = normalizeFormsList(producer(forms.slice()));
  cachedForms = nextForms;
  saveFormsToLocal(nextForms);
  const syncResult = await syncFormsToDrive(nextForms);
  if (syncResult?.fileUrl && syncResult.fileUrl !== driveFormsUrl) {
    driveFormsUrl = syncResult.fileUrl;
    const withUpdatedDriveUrl = normalizeFormsList(nextForms);
    cachedForms = withUpdatedDriveUrl;
    saveFormsToLocal(withUpdatedDriveUrl);
    return withUpdatedDriveUrl;
  }
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
    const forms = await loadFormsWithCache();
    return forms.filter((form) => includeArchived || !form.archived);
  },
  async getDriveFileUrl() {
    if (!cachedForms) await loadFormsWithCache();
    return driveFormsUrl;
  },
  async getForm(formId) {
    const forms = await loadFormsWithCache();
    return forms.find((form) => form.id === formId) || null;
  },
  async createForm(payload) {
    let created = null;
    const nextForms = await persistForms((forms) => {
      const record = buildFormRecord({ ...payload, id: genId() });
      created = record;
      forms.push(record);
      return forms;
    }, { fileUrl: payload?.driveFileUrl });
    return nextForms.find((form) => form.id === created.id) || created;
  },
  async updateForm(formId, updates) {
    let updated = null;
    const nextForms = await persistForms((forms) => {
      const index = forms.findIndex((form) => form.id === formId);
      if (index === -1) return forms;
      const current = forms[index];
      const next = buildFormRecord({
        ...current,
        ...updates,
        id: current.id,
        createdAt: current.createdAt,
        archived: updates.archived ?? current.archived,
        schemaVersion: updates.schemaVersion ?? current.schemaVersion,
      });
      updated = next;
      forms[index] = next;
      return forms;
    }, { fileUrl: updates?.driveFileUrl });
    return nextForms.find((form) => form.id === updated?.id) || updated;
  },
  async setFormArchivedState(formId, archived) {
    let updated = null;
    await persistForms((forms) => {
      const index = forms.findIndex((form) => form.id === formId);
      if (index === -1) return forms;
      const current = forms[index];
      const next = { ...current, archived, modifiedAt: nowIso() };
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
  async deleteForm(formId) {
    await persistForms((forms) => forms.filter((form) => form.id !== formId));
    persistEntries((entries) => {
      delete entries[formId];
      return entries;
    });
  },
  async upsertEntry(formId, payload) {
    let saved = null;
    persistEntries((entriesByForm) => {
      const list = getEntriesForForm(entriesByForm, formId);
      const now = nowIso();
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
            modifiedAt: now,
            data: payload.data || current.data,
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
          modifiedAt: now,
          data: payload.data || {},
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
    // First, get the form to check if we should fetch from GAS
    const form = await this.getForm(formId);

    // Fetch from GAS if settings are configured
    if (form?.settings?.spreadsheetId) {
      try {
        const gasResult = await listEntriesFromGas({
          gasUrl: form.settings.gasUrl || "",
          spreadsheetId: form.settings.spreadsheetId,
          sheetName: form.settings.sheetName || "Responses",
        });

        const gasRecords = gasResult.records || [];
        const headerMatrix = gasResult.headerMatrix || [];

        // Transform GAS records to our entry format
        const entries = gasRecords.map((record) => {
          return {
            id: record.id,
            "No.": record["No."],
            formId,
            createdAt: record.createdAt,
            modifiedAt: record.modifiedAt,
            data: record.data || {},
            order: Object.keys(record.data || {}),
          };
        });

        // Sort by ID in ascending order when fetching from spreadsheet
        entries.sort((a, b) => {
          if (a.id < b.id) return -1;
          if (a.id > b.id) return 1;
          return 0;
        });

        // Update local storage with fetched data
        persistEntries((entriesByForm) => {
          entriesByForm[formId] = entries;
          return entriesByForm;
        });

        return { entries, headerMatrix };
      } catch (error) {
        console.error("[dataStore] Failed to fetch from Google Sheets:", error);
      }
    }

    // Fall back to local storage
    const entries = loadEntries();
    return { entries: getEntriesForForm(entries, formId), headerMatrix: [] };
  },
  async getEntry(formId, entryId) {
    // First, get the form to check if we should fetch from GAS
    const form = await this.getForm(formId);

    // Fetch from GAS if settings are configured
    if (form?.settings?.spreadsheetId) {
      try {
        const record = await getEntryFromGas({
          gasUrl: form.settings.gasUrl || "",
          spreadsheetId: form.settings.spreadsheetId,
          sheetName: form.settings.sheetName || "Responses",
          entryId,
        });

        if (record) {
          return {
            id: record.id,
            "No.": record["No."],
            formId,
            createdAt: record.createdAt,
            modifiedAt: record.modifiedAt,
            data: record.data || {},
            order: Object.keys(record.data || {}),
          };
        }

        return null;
      } catch (error) {
        console.error("[dataStore.getEntry] Spreadsheet取得エラー:", error);
      }
    }

    // Fall back to local storage
    const entries = loadEntries();
    return getEntriesForForm(entries, formId).find((entry) => entry.id === entryId) || null;
  },
  async deleteEntry(formId, entryId) {
    // First, get the form to check if we need to call GAS
    const form = await this.getForm(formId);

    // Delete from GAS if settings are configured
    if (form?.settings?.spreadsheetId) {
      try {
        await deleteEntryFromGas({
          gasUrl: form.settings.gasUrl || "",
          spreadsheetId: form.settings.spreadsheetId,
          sheetName: form.settings.sheetName || "Responses",
          entryId,
        });
      } catch (error) {
        console.error("[dataStore] Failed to delete from Google Sheets:", error);
        throw new Error(`スプレッドシートからの削除に失敗しました: ${error.message}`);
      }
    }

    // Then delete from local storage
    persistEntries((entriesByForm) => {
      const list = getEntriesForForm(entriesByForm, formId).filter((entry) => entry.id !== entryId);
      entriesByForm[formId] = list;
      return entriesByForm;
    });
  },
  async importForms(jsonList) {
    const created = [];
    await persistForms((forms) => {
      jsonList.forEach((item) => {
        if (!item) return;
        const record = buildFormRecord({
          ...item,
          id: genId(),
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
  async importFormsFromDrive(targetUrl) {
    const { forms } = await importFormsFromDrive({ targetUrl });
    return forms || [];
  },
  async exportForms(formIds) {
    const forms = await loadFormsWithCache();
    const selected = forms.filter((form) => formIds.includes(form.id));
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
