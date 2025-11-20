import { computeSchemaHash, stripSchemaIDs } from "../../core/schema.js";
import { genId } from "../../core/ids.js";
import { collectDisplayFieldSettings } from "../../utils/formPaths.js";
import {
  deleteEntry as deleteEntryFromGas,
  listEntries as listEntriesFromGas,
  getEntry as getEntryFromGas,
  listForms as listFormsFromGas,
  getForm as getFormFromGas,
  createForm as createFormInGas,
  updateForm as updateFormInGas,
  deleteForm as deleteFormFromGas,
  setFormArchived as setFormArchivedInGas,
  getAutoDetectedGasUrl
} from "../../services/gasClient.js";

// ========================================
// ストレージキー
// ========================================
// フォーム管理はGoogle Driveに完全移行
// エントリキャッシュのみlocalStorageを使用（パフォーマンスのため）
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

// エントリ（回答データ）のキャッシュ管理（パフォーマンスのため）
const loadEntries = () => readStorage(ENTRIES_STORAGE_KEY, {});
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

const persistEntries = (producer) => {
  const entries = loadEntries();
  const nextEntries = producer({ ...entries });
  saveEntries(nextEntries);
  return nextEntries;
};

export const dataStore = {
  async listForms({ includeArchived = false } = {}) {
    // Google DriveからフォームList取得（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    try {
      const forms = await listFormsFromGas({ gasUrl, includeArchived});
      return forms.map((form) => ensureDisplayInfo(form));
    } catch (error) {
      console.error("[dataStore.listForms] Drive取得エラー:", error);
      throw new Error(`フォーム一覧の取得に失敗しました: ${error.message}`);
    }
  },
  async getForm(formId) {
    // Google Driveから単一フォームを取得（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    try {
      const form = await getFormFromGas({ gasUrl, formId });
      return form ? ensureDisplayInfo(form) : null;
    } catch (error) {
      console.error("[dataStore.getForm] Drive取得エラー:", error);
      throw new Error(`フォームの取得に失敗しました: ${error.message}`);
    }
  },
  async createForm(payload) {
    // Google Driveに直接保存（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    const record = buildFormRecord({ ...payload, id: genId() });
    const saveUrl = payload.saveUrl || "";

    try {
      // Driveに保存（保存先URL指定）
      const savedForm = await createFormInGas({ gasUrl, formData: record, saveUrl });
      return ensureDisplayInfo(savedForm);
    } catch (error) {
      console.error("[dataStore.createForm] Drive保存エラー:", error);
      throw new Error(`フォームの作成に失敗しました: ${error.message}`);
    }
  },
  async updateForm(formId, updates) {
    // Google Driveで直接更新（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    try {
      // Driveで更新
      const savedForm = await updateFormInGas({ gasUrl, formId, updates });
      return ensureDisplayInfo(savedForm);
    } catch (error) {
      console.error("[dataStore.updateForm] Drive更新エラー:", error);
      throw new Error(`フォームの更新に失敗しました: ${error.message}`);
    }
  },
  async setFormArchivedState(formId, archived) {
    // Google Driveでアーカイブ状態を更新（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    try {
      const savedForm = await setFormArchivedInGas({ gasUrl, formId, archived });
      return ensureDisplayInfo(savedForm);
    } catch (error) {
      console.error("[dataStore.setFormArchivedState] Driveアーカイブエラー:", error);
      throw new Error(`アーカイブ状態の変更に失敗しました: ${error.message}`);
    }
  },
  async archiveForm(formId) {
    return this.setFormArchivedState(formId, true);
  },
  async unarchiveForm(formId) {
    return this.setFormArchivedState(formId, false);
  },
  async deleteForm(formId) {
    // Google Driveから削除（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    try {
      await deleteFormFromGas({ gasUrl, formId });
      // エントリキャッシュも削除
      persistEntries((entries) => {
        delete entries[formId];
        return entries;
      });
    } catch (error) {
      console.error("[dataStore.deleteForm] Drive削除エラー:", error);
      throw new Error(`フォームの削除に失敗しました: ${error.message}`);
    }
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
    // Google Driveに直接インポート（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    const created = [];
    for (const item of jsonList) {
      if (!item) continue;

      const record = buildFormRecord({
        ...item,
        id: genId(),
        createdAt: item.createdAt,
        schemaVersion: item.schemaVersion,
      });

      try {
        // Driveに保存（マイドライブルートにデフォルト保存）
        const savedForm = await createFormInGas({ gasUrl, formData: record, saveUrl: "" });
        created.push(ensureDisplayInfo(savedForm));
      } catch (error) {
        console.warn(`[dataStore.importForms] フォーム ${record.id} のDrive保存エラー:`, error);
        // エラーでもスキップして続行
      }
    }

    return created;
  },
  async exportForms(formIds) {
    // Google Driveから取得してエクスポート（自動検出URL使用）
    const gasUrl = getAutoDetectedGasUrl();

    try {
      const allForms = await listFormsFromGas({ gasUrl, includeArchived: true });
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
    } catch (error) {
      console.error("[dataStore.exportForms] Driveエクスポートエラー:", error);
      throw new Error(`フォームのエクスポートに失敗しました: ${error.message}`);
    }
  },
};

// ========================================
// Google Drive同期API（互換性のため残す、実際は常にDriveベース）
// ========================================

/**
 * フォーム一覧を再取得（Drive完全移行モードでは常にDriveから取得）
 * @returns {Promise<Object>} 同期結果
 */
export const syncFromDrive = async () => {
  const gasUrl = getAutoDetectedGasUrl();

  try {
    // Driveから全フォーム取得（アーカイブ含む）
    const driveForms = await listFormsFromGas({ gasUrl, includeArchived: true });

    return {
      success: true,
      count: driveForms.length,
    };
  } catch (error) {
    console.error("[syncFromDrive] エラー:", error);
    throw new Error(`Drive同期エラー: ${error.message}`);
  }
};

/**
 * Drive完全移行モードでは不要（互換性のため残す）
 * @returns {Promise<Object>} 同期結果
 */
export const syncToDrive = async () => {
  return {
    success: true,
    message: "Drive完全移行モードでは、すべての操作が自動的にDriveに反映されます",
  };
};
