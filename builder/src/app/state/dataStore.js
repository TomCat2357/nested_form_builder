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
  archiveForm as archiveFormInGas,
  unarchiveForm as unarchiveFormInGas,
  hasScriptRun,
} from "../../services/gasClient.js";

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
        const forms = await listFormsFromGas({ includeArchived });
        return forms.map((form) => ensureDisplayInfo(form));
      } catch (error) {
        console.warn("[dataStore] Failed to fetch forms from Google Drive, falling back to localStorage:", error);
      }
    }

    // Fallback to localStorage
    const forms = loadForms();
    return forms.filter((form) => includeArchived || !form.archived);
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
  async createForm(payload) {
    const record = buildFormRecord({ ...payload, id: genId() });

    // Try to save to Google Drive via GAS
    if (hasScriptRun()) {
      try {
        const savedForm = await saveFormToGas(record);
        return savedForm ? ensureDisplayInfo(savedForm) : record;
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
  async updateForm(formId, updates) {
    // First get the current form
    const current = await this.getForm(formId);
    if (!current) {
      throw new Error("Form not found: " + formId);
    }

    const next = buildFormRecord({
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      archived: updates.archived ?? current.archived,
      schemaVersion: updates.schemaVersion ?? current.schemaVersion,
    });

    // Try to save to Google Drive via GAS
    if (hasScriptRun()) {
      try {
        const savedForm = await saveFormToGas(next);
        return savedForm ? ensureDisplayInfo(savedForm) : next;
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
    // Try to delete from Google Drive via GAS
    if (hasScriptRun()) {
      try {
        await deleteFormFromGas(formId);
      } catch (error) {
        console.warn("[dataStore] Failed to delete form from Google Drive, falling back to localStorage:", error);
      }
    }

    // Also delete from localStorage
    persistForms((forms) => forms.filter((form) => form.id !== formId));
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
    persistForms((forms) => {
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
  async exportForms(formIds) {
    // Get forms from current source (Google Drive or localStorage)
    const allForms = await this.listForms({ includeArchived: true });
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
