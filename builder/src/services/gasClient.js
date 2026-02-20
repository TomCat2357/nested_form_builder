import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";

export const hasScriptRun = () =>
  typeof google !== "undefined" &&
  google?.script?.run;

const normalizeScriptRunError = (err) => {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err.message === "string") return new Error(err.message);
  try {
    return new Error(JSON.stringify(err) || "Apps Script call failed");
  } catch (jsonErr) {
    return new Error("Apps Script call failed");
  }
};

const callScriptRun = (functionName, payload) =>
  new Promise((resolve, reject) => {
    if (!hasScriptRun()) {
      reject(new Error("この機能はGoogle Apps Script環境でのみ利用可能です"));
      return;
    }
    google.script.run
      .withSuccessHandler((result) => resolve(result))
      .withFailureHandler((error) => reject(normalizeScriptRunError(error)))[functionName](payload);
  });

export const validateSpreadsheet = async (spreadsheetIdOrUrl) => {
  if (!spreadsheetIdOrUrl) {
    throw new Error("Spreadsheet URL/ID is required");
  }
  const result = await callScriptRun("nfbValidateSpreadsheet", spreadsheetIdOrUrl);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Spreadsheet validation failed");
  }
  return result;
};


export const submitResponses = async ({ spreadsheetId, sheetName = "Data", payload }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  const body = { ...(payload || {}), spreadsheetId, sheetName };
  const result = await callScriptRun("saveResponses", body);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Apps Script call failed");
  }
  return result;
};

export const deleteEntry = async ({ spreadsheetId, sheetName = "Data", entryId }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!entryId) throw new Error("entryId is required");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
    id: entryId,
  };

  const result = await callScriptRun("deleteRecord", payload);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Delete failed");
  }
  return result;
};

export const getEntry = async ({ spreadsheetId, sheetName = "Data", entryId, rowIndexHint = null }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!entryId) throw new Error("entryId is required");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
    id: entryId,
    rowIndexHint,
  };

  const result = await callScriptRun("getRecord", payload);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Get record failed");
  }
  return {
    record: result.record || null,
    rowIndex: typeof result.rowIndex === "number" ? result.rowIndex : null,
  };
};

export const listEntries = async ({ spreadsheetId, sheetName = "Data", formId = null }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
  };
  if (formId) {
    payload.formId = formId;
  }

  const result = await callScriptRun("listRecords", payload);
  if (!result || result.ok === false) {
    console.error("[gasClient] Result validation failed - result:", result);
    throw new Error(result?.error || "List failed");
  }
  return {
    records: result.records || [],
    headerMatrix: result.headerMatrix || []
  };
};

// ========================================
// Form Management APIs (Google Drive)
// ========================================

/**
 * フォーム管理API呼び出しの共通ヘルパー
 * @param {string} functionName - GAS関数名
 * @param {*} args - 引数
 * @param {string} errorMessage - エラーメッセージ
 * @returns {Promise<*>} - API結果
 */
const callFormApi = async (functionName, args, errorMessage) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }

  try {
    const result = await callScriptRun(functionName, args);
    if (!result || result.ok === false) {
      throw new Error(result?.error || errorMessage);
    }
    return result;
  } catch (error) {
    console.error(`[gasClient] ${functionName} failed`, error);
    throw error;
  }
};

export const listForms = async (options = {}) => {
  const result = await callFormApi("nfbListForms", options, "List forms failed");
  return {
    forms: result.forms || [],
    loadFailures: result.loadFailures || [],
  };
};

export const getForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const result = await callFormApi("nfbGetForm", formId, "Get form failed");
  return result.form || null;
};

export const saveForm = async (form, targetUrl = null) => {
  if (!form || !form.id) throw new Error("Form with ID is required");
  const payload = { form, targetUrl };
  const result = await callFormApi("nfbSaveForm", payload, "Save form failed");
  return { form: result.form, fileUrl: result.fileUrl };
};

export const deleteFormFromDrive = async (formId) => {
  if (!formId) throw new Error("formId is required");
  return await callFormApi("nfbDeleteForm", formId, "Delete form failed");
};

export const deleteFormsFromDrive = async (formIds) => {
  if (!Array.isArray(formIds) || formIds.length === 0) {
    throw new Error("formIds array is required");
  }
  const result = await callScriptRun("nfbDeleteForms", formIds);
  if (!result) {
    throw new Error("Batch delete forms failed");
  }

  const deleted = Number.isFinite(result.deleted) ? result.deleted : Number(result.deleted) || 0;
  if (result.ok === false && deleted === 0) {
    throw new Error(result?.error || "Batch delete forms failed");
  }

  return result;
};

export const archiveForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const result = await callFormApi("nfbArchiveForm", formId, "Archive form failed");
  return result.form || null;
};

export const unarchiveForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const result = await callFormApi("nfbUnarchiveForm", formId, "Unarchive form failed");
  return result.form || null;
};

export const archiveForms = async (formIds) => {
  if (!Array.isArray(formIds) || formIds.length === 0) {
    throw new Error("formIds array is required");
  }
  return await callFormApi("nfbArchiveForms", formIds, "Batch archive forms failed");
};

export const unarchiveForms = async (formIds) => {
  if (!Array.isArray(formIds) || formIds.length === 0) {
    throw new Error("formIds array is required");
  }
  return await callFormApi("nfbUnarchiveForms", formIds, "Batch unarchive forms failed");
};

export const importFormsFromDrive = async (url) => {
  if (!url) throw new Error("Google Drive URL is required");
  const result = await callFormApi("nfbImportFormsFromDrive", url, "Import from Drive failed");
  return {
    forms: result.forms || [],
    skipped: result.skipped || 0,
    parseFailed: result.parseFailed || 0,
    totalFiles: result.totalFiles || 0,
  };
};

export const importThemeFromDrive = async (url) => {
  if (!url) throw new Error("Google Drive URL is required");
  const result = await callScriptRun("nfbImportThemeFromDrive", url);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Theme import failed");
  }
  return {
    css: result.css || "",
    fileName: result.fileName || "",
    fileUrl: result.fileUrl || url,
  };
};

export const debugGetMapping = async () => {
  try {
    const result = await callScriptRun("nfbDebugGetMapping", {});
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Debug get mapping failed");
    }
    return result;
  } catch (error) {
    console.error(`[gasClient] debugGetMapping failed`, error);
    throw error;
  }
};

// ========================================
// 管理者キー管理API
// ========================================

/**
 * 管理者キーを取得する
 * @returns {Promise<string>} 管理者キー
 */
export const getAdminKey = async () => {
  const result = await callScriptRun("nfbGetAdminKey", {});
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Get admin key failed");
  }
  return result.adminKey || "";
};

/**
 * 管理者キーを設定する
 * @param {string} newKey - 新しい管理者キー（空文字で認証無効化）
 * @returns {Promise<string>} 設定後の管理者キー
 */
export const setAdminKey = async (newKey) => {
  const result = await callScriptRun("nfbSetAdminKey", newKey);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Set admin key failed");
  }
  return result.adminKey || "";
};
