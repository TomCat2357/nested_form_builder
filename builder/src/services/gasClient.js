import { normalizeSpreadsheetId } from "../utils/spreadsheet.js";

export const hasScriptRun = () => typeof google !== "undefined" && google?.script?.run;

const normalizeScriptRunError = (err) => {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err.message === "string") return new Error(err.message);
  try { return new Error(JSON.stringify(err) || "Apps Script call failed"); }
  catch (jsonErr) { return new Error("Apps Script call failed"); }
};

const createGasApiError = (message, { code, result } = {}) => {
  const error = new Error(message);
  if (code) error.code = code;
  if (result !== undefined) error.result = result;
  return error;
};

const callScriptRun = (functionName, payload) =>
  new Promise((resolve, reject) => {
    if (!hasScriptRun()) {
      reject(new Error("この機能はGoogle Apps Script環境でのみ利用可能です"));
      return;
    }
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => reject(normalizeScriptRunError(error)))[functionName](payload);
  });

// DRY化のための共通APIラッパー
const fetchGasApi = async (functionName, payload, errorMessage) => {
  try {
    const result = await callScriptRun(functionName, payload);
    if (!result || result.ok === false) {
      throw createGasApiError(result?.error || errorMessage, {
        code: result?.code,
        result,
      });
    }
    return result;
  } catch (error) {
    console.error(`[gasClient] ${functionName} failed`, error);
    throw error;
  }
};

export const validateSpreadsheet = (idOrUrl) => {
  if (!idOrUrl) throw new Error("Spreadsheet URL/ID is required");
  return fetchGasApi("nfbValidateSpreadsheet", idOrUrl, "Spreadsheet validation failed");
};

export const submitResponses = ({ spreadsheetId, sheetName = "Data", payload }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  return fetchGasApi("saveResponses", { ...payload, spreadsheetId, sheetName }, "Apps Script call failed");
};

export const acquireSaveLock = ({ spreadsheetId, sheetName = "Data" }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  return fetchGasApi("nfbAcquireSaveLock", { spreadsheetId: normalizeSpreadsheetId(spreadsheetId), sheetName }, "Apps Script call failed");
};

export const deleteEntry = ({ spreadsheetId, sheetName = "Data", entryId }) => {
  if (!spreadsheetId || !entryId) throw new Error("spreadsheetId and entryId are required");
  return fetchGasApi("deleteRecord", { spreadsheetId: normalizeSpreadsheetId(spreadsheetId), sheetName, id: entryId }, "Delete failed");
};

export const getEntry = async ({ spreadsheetId, sheetName = "Data", entryId, rowIndexHint = null }) => {
  if (!spreadsheetId || !entryId) throw new Error("spreadsheetId and entryId are required");
  const result = await fetchGasApi("getRecord", { spreadsheetId: normalizeSpreadsheetId(spreadsheetId), sheetName, id: entryId, rowIndexHint }, "Get record failed");
  return { record: result.record || null, rowIndex: typeof result.rowIndex === "number" ? result.rowIndex : null };
};

export const exportSearchResults = async ({ spreadsheetTitle = "", headerRows, rows, themeColors = null }) => {
  if (!Array.isArray(headerRows) || headerRows.length === 0) throw new Error("headerRows is required");
  if (!Array.isArray(rows)) throw new Error("rows must be an array");

  const CHUNK_SIZE = 100;
  const result = await fetchGasApi("nfbExportSearchResults", { spreadsheetTitle, headerRows, rows: rows.slice(0, CHUNK_SIZE), themeColors }, "Export failed");
  const headerCount = result.headerCount || headerRows.length;
  for (let i = CHUNK_SIZE; i < rows.length; i += CHUNK_SIZE) {
    await fetchGasApi("nfbAppendExportRows", { spreadsheetId: result.spreadsheetId, rows: rows.slice(i, i + CHUNK_SIZE), themeColors, headerCount, rowOffset: i }, "Append chunk failed");
  }
  return { ...result, exportedCount: rows.length };
};

export const listEntries = async ({ spreadsheetId, sheetName = "Data", formId = null, lastSpreadsheetReadAt = null, forceFullSync = false }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  const normalizedLastSpreadsheetReadAt = Number(lastSpreadsheetReadAt);
  const payload = {
    spreadsheetId: normalizeSpreadsheetId(spreadsheetId),
    sheetName,
    formId,
    forceFullSync: !!forceFullSync,
  };
  if (!forceFullSync && Number.isFinite(normalizedLastSpreadsheetReadAt) && normalizedLastSpreadsheetReadAt > 0) {
    payload.lastSpreadsheetReadAt = normalizedLastSpreadsheetReadAt;
  }
  const result = await fetchGasApi("listRecords", payload, "スプレッドシートからデータ一覧を読み取れませんでした");
  return {
    records: result.records || [],
    headerMatrix: result.headerMatrix || [],
    isDelta: !!result.isDelta,
    allIds: Array.isArray(result.allIds) ? result.allIds : null,
    count: Number.isFinite(result.count) ? result.count : (result.records || []).length,
    sheetLastUpdatedAt: Number.isFinite(result.sheetLastUpdatedAt) ? result.sheetLastUpdatedAt : 0,
  };
};

export const listForms = (options = {}) => fetchGasApi("nfbListForms", options, "List forms failed").then(r => ({ forms: r.forms || [], loadFailures: r.loadFailures || [] }));
export const getForm = (formId) => { if (!formId) throw new Error("formId is required"); return fetchGasApi("nfbGetForm", formId, "Get form failed").then(r => r.form || null); };
export const saveForm = (form, targetUrl = null, saveMode = "auto") => { if (!form || !form.id) throw new Error("Form with ID is required"); return fetchGasApi("nfbSaveForm", { form, targetUrl, saveMode }, "Save form failed").then(r => ({ form: r.form, fileUrl: r.fileUrl })); };
export const deleteFormFromDrive = (formId) => { if (!formId) throw new Error("formId is required"); return fetchGasApi("nfbDeleteForm", formId, "Delete form failed"); };
export const deleteFormsFromDrive = (formIds) => { if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required"); return fetchGasApi("nfbDeleteForms", formIds, "Batch delete forms failed"); };
export const archiveForm = (formId) => { if (!formId) throw new Error("formId is required"); return fetchGasApi("nfbArchiveForm", formId, "Archive form failed").then(r => r.form || null); };
export const unarchiveForm = (formId) => { if (!formId) throw new Error("formId is required"); return fetchGasApi("nfbUnarchiveForm", formId, "Unarchive form failed").then(r => r.form || null); };
export const archiveForms = (formIds) => { if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required"); return fetchGasApi("nfbArchiveForms", formIds, "Batch archive forms failed"); };
export const unarchiveForms = (formIds) => { if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required"); return fetchGasApi("nfbUnarchiveForms", formIds, "Batch unarchive forms failed"); };
export const importFormsFromDrive = (url) => { if (!url) throw new Error("Google Drive URL is required"); return fetchGasApi("nfbImportFormsFromDrive", url, "Import from Drive failed").then(r => ({ forms: r.forms || [], skipped: r.skipped || 0, parseFailed: r.parseFailed || 0, totalFiles: r.totalFiles || 0 })); };
export const registerImportedForm = (payload) => { if (!payload || !payload.form || !payload.fileId) throw new Error("form and fileId are required"); return fetchGasApi("nfbRegisterImportedForm", payload, "Register imported form failed"); };
export const importThemeFromDrive = (url) => { if (!url) throw new Error("Google Drive URL is required"); return fetchGasApi("nfbImportThemeFromDrive", url, "Theme import failed").then(r => ({ css: r.css || "", fileName: r.fileName || "", fileUrl: r.fileUrl || url })); };
export const debugGetMapping = () => fetchGasApi("nfbDebugGetMapping", {}, "Debug get mapping failed");
export const getAdminKey = () => fetchGasApi("nfbGetAdminKey", {}, "Get admin key failed").then(r => r.adminKey || "");
export const setAdminKey = (newKey) => fetchGasApi("nfbSetAdminKey", newKey, "Set admin key failed").then(r => r.adminKey || "");
export const getAdminEmail = () => fetchGasApi("nfbGetAdminEmail", {}, "Get admin email failed").then(r => r.adminEmail || "");
export const setAdminEmail = (newEmail) => fetchGasApi("nfbSetAdminEmail", newEmail, "Set admin email failed").then(r => r.adminEmail || "");
export const getRestrictToFormOnly = () => fetchGasApi("nfbGetRestrictToFormOnly", {}, "Get restrict to form only failed").then(r => Boolean(r.restrictToFormOnly));
export const setRestrictToFormOnly = (value) => fetchGasApi("nfbSetRestrictToFormOnly", value, "Set restrict to form only failed").then(r => Boolean(r.restrictToFormOnly));
export const saveExcelToDrive = ({ filename, base64 }) => fetchGasApi("nfbSaveExcelToDrive", { filename, base64 }, "Driveへの保存に失敗しました");

export const syncRecordsProxy = async (payload) => {
  const spreadsheetId = normalizeSpreadsheetId(payload?.spreadsheetId);
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  const result = await fetchGasApi("syncRecordsProxy", { ...payload, spreadsheetId }, "Sync failed");
  return result;
};
