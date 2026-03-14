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
    const safeFunctionName = typeof functionName === "string" ? functionName.trim() : "";
    if (!safeFunctionName) {
      reject(new Error("Apps Script functionName is required"));
      return;
    }

    const runner = google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler((error) => reject(normalizeScriptRunError(error)));

    const remoteFunction = runner?.[safeFunctionName];
    if (typeof remoteFunction !== "function") {
      reject(new Error(`Apps Script function "${safeFunctionName}" is not available`));
      return;
    }

    try {
      remoteFunction.call(runner, payload);
    } catch (error) {
      reject(normalizeScriptRunError(error));
    }
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

export const listForms = async (options = {}) => {
  const r = await fetchGasApi("nfbListForms", options, "List forms failed");
  return { forms: r.forms || [], loadFailures: r.loadFailures || [] };
};
export const getForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const r = await fetchGasApi("nfbGetForm", formId, "Get form failed");
  return r.form || null;
};
export const saveForm = async (form, targetUrl = null, saveMode = "auto") => {
  if (!form || !form.id) throw new Error("Form with ID is required");
  const r = await fetchGasApi("nfbSaveForm", { form, targetUrl, saveMode }, "Save form failed");
  return { form: r.form, fileUrl: r.fileUrl };
};
export const deleteFormFromDrive = (formId) => { if (!formId) throw new Error("formId is required"); return fetchGasApi("nfbDeleteForm", formId, "Delete form failed"); };
export const deleteFormsFromDrive = (formIds) => { if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required"); return fetchGasApi("nfbDeleteForms", formIds, "Batch delete forms failed"); };
export const archiveForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const r = await fetchGasApi("nfbArchiveForm", formId, "Archive form failed");
  return r.form || null;
};
export const unarchiveForm = async (formId) => {
  if (!formId) throw new Error("formId is required");
  const r = await fetchGasApi("nfbUnarchiveForm", formId, "Unarchive form failed");
  return r.form || null;
};
export const archiveForms = (formIds) => { if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required"); return fetchGasApi("nfbArchiveForms", formIds, "Batch archive forms failed"); };
export const unarchiveForms = (formIds) => { if (!Array.isArray(formIds) || formIds.length === 0) throw new Error("formIds array is required"); return fetchGasApi("nfbUnarchiveForms", formIds, "Batch unarchive forms failed"); };
export const importFormsFromDrive = async (url) => {
  if (!url) throw new Error("Google Drive URL is required");
  const r = await fetchGasApi("nfbImportFormsFromDrive", url, "Import from Drive failed");
  return { forms: r.forms || [], skipped: r.skipped || 0, parseFailed: r.parseFailed || 0, totalFiles: r.totalFiles || 0 };
};
export const registerImportedForm = (payload) => { if (!payload || !payload.form || !payload.fileId) throw new Error("form and fileId are required"); return fetchGasApi("nfbRegisterImportedForm", payload, "Register imported form failed"); };
export const importThemeFromDrive = async (url) => {
  if (!url) throw new Error("Google Drive URL is required");
  const r = await fetchGasApi("nfbImportThemeFromDrive", url, "Theme import failed");
  return { css: r.css || "", fileName: r.fileName || "", fileUrl: r.fileUrl || url };
};
export const debugGetMapping = () => fetchGasApi("nfbDebugGetMapping", {}, "Debug get mapping failed");
export const getAdminKey = async () => { const r = await fetchGasApi("nfbGetAdminKey", {}, "Get admin key failed"); return r.adminKey || ""; };
export const setAdminKey = async (newKey) => { const r = await fetchGasApi("nfbSetAdminKey", newKey, "Set admin key failed"); return r.adminKey || ""; };
export const getAdminEmail = async () => { const r = await fetchGasApi("nfbGetAdminEmail", {}, "Get admin email failed"); return r.adminEmail || ""; };
export const setAdminEmail = async (newEmail) => { const r = await fetchGasApi("nfbSetAdminEmail", newEmail, "Set admin email failed"); return r.adminEmail || ""; };
export const getRestrictToFormOnly = async () => { const r = await fetchGasApi("nfbGetRestrictToFormOnly", {}, "Get restrict to form only failed"); return Boolean(r.restrictToFormOnly); };
export const setRestrictToFormOnly = async (value) => { const r = await fetchGasApi("nfbSetRestrictToFormOnly", value, "Set restrict to form only failed"); return Boolean(r.restrictToFormOnly); };
export const saveExcelToDrive = ({ filename, base64 }) => fetchGasApi("nfbSaveExcelToDrive", { filename, base64 }, "Driveへの保存に失敗しました");
const isSingleRecordPrintPayload = (payload) => {
  return Boolean(payload && payload.fileName && Array.isArray(payload.items));
};

const isMultiRecordPrintPayload = (payload) => {
  return Boolean(
    payload
      && payload.fileName
      && Array.isArray(payload.records)
      && payload.records.length > 0
      && payload.records.every((record) => record && record.fileName && Array.isArray(record.items)),
  );
};

export const createRecordPrintDocument = (payload) => {
  if (!isSingleRecordPrintPayload(payload) && !isMultiRecordPrintPayload(payload)) {
    throw new Error("print document payload is invalid");
  }
  return fetchGasApi("nfbCreateRecordPrintDocument", payload, "印刷様式の出力に失敗しました");
};

export const syncRecordsProxy = async (payload) => {
  const spreadsheetId = normalizeSpreadsheetId(payload?.spreadsheetId);
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  const result = await fetchGasApi("syncRecordsProxy", { ...payload, spreadsheetId }, "Sync failed");
  return result;
};
