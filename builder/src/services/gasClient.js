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
      reject(new Error("google.script.run is not available"));
      return;
    }
    google.script.run
      .withSuccessHandler((result) => resolve(result))
      .withFailureHandler((error) => reject(normalizeScriptRunError(error)))[functionName](payload);
  });

export const loadUserSettings = async () => {
  if (!hasScriptRun()) return null;
  try {
    const result = await callScriptRun("nfbLoadUserSettings");
    if (result && typeof result === "object") return result;
    return null;
  } catch (error) {
    console.warn("[gasClient] loadUserSettings failed", error);
    return null;
  }
};

export const saveUserSettings = async (settings) => {
  if (!hasScriptRun()) return null;
  try {
    const result = await callScriptRun("nfbSaveUserSettings", settings || {});
    return result && typeof result === "object" ? result : null;
  } catch (error) {
    console.warn("[gasClient] saveUserSettings failed", error);
    return null;
  }
};

export const submitResponses = async ({ spreadsheetId, sheetName = "Responses", payload }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!hasScriptRun()) throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");

  const body = { ...(payload || {}), spreadsheetId, sheetName };
  const result = await callScriptRun("saveResponses", body);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Apps Script call failed");
  }
  return result;
};

export const deleteEntry = async ({ spreadsheetId, sheetName = "Responses", entryId }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!entryId) throw new Error("entryId is required");
  if (!hasScriptRun()) throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");

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

export const getEntry = async ({ spreadsheetId, sheetName = "Responses", entryId }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!entryId) throw new Error("entryId is required");
  if (!hasScriptRun()) throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
    id: entryId,
  };

  const result = await callScriptRun("getRecord", payload);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Get record failed");
  }
  return result.record || null;
};

export const listEntries = async ({ spreadsheetId, sheetName = "Responses" }) => {
  if (!spreadsheetId) throw new Error("spreadsheetId is required");
  if (!hasScriptRun()) throw new Error("この機能はGoogle Apps Script環境でのみ利用可能です");

  const cleanSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  const payload = {
    spreadsheetId: cleanSpreadsheetId,
    sheetName,
  };

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

export const listForms = async (options = {}) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }

  try {
    const result = await callScriptRun("nfbListForms", options);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "List forms failed");
    }
    return result.forms || [];
  } catch (error) {
    console.error("[gasClient] listForms failed", error);
    throw error;
  }
};

export const getForm = async (formId) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }
  if (!formId) throw new Error("formId is required");

  try {
    const result = await callScriptRun("nfbGetForm", formId);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Get form failed");
    }
    return result.form || null;
  } catch (error) {
    console.error("[gasClient] getForm failed", error);
    throw error;
  }
};

export const saveForm = async (form, targetUrl = null) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }
  if (!form || !form.id) throw new Error("Form with ID is required");

  try {
    const payload = { form, targetUrl };
    const result = await callScriptRun("nfbSaveForm", payload);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Save form failed");
    }
    return { form: result.form, fileUrl: result.fileUrl };
  } catch (error) {
    console.error("[gasClient] saveForm failed", error);
    throw error;
  }
};

export const deleteFormFromDrive = async (formId) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }
  if (!formId) throw new Error("formId is required");

  try {
    const result = await callScriptRun("nfbDeleteForm", formId);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Delete form failed");
    }
    return result;
  } catch (error) {
    console.error("[gasClient] deleteFormFromDrive failed", error);
    throw error;
  }
};

export const archiveForm = async (formId) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }
  if (!formId) throw new Error("formId is required");

  try {
    const result = await callScriptRun("nfbArchiveForm", formId);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Archive form failed");
    }
    return result.form || null;
  } catch (error) {
    console.error("[gasClient] archiveForm failed", error);
    throw error;
  }
};

export const unarchiveForm = async (formId) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }
  if (!formId) throw new Error("formId is required");

  try {
    const result = await callScriptRun("nfbUnarchiveForm", formId);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Unarchive form failed");
    }
    return result.form || null;
  } catch (error) {
    console.error("[gasClient] unarchiveForm failed", error);
    throw error;
  }
};

export const importFormsFromDrive = async (url) => {
  if (!hasScriptRun()) {
    throw new Error("Form management is only available in google.script.run environment");
  }
  if (!url) throw new Error("Google Drive URL is required");

  try {
    const result = await callScriptRun("nfbImportFormsFromDrive", url);
    if (!result || result.ok === false) {
      throw new Error(result?.error || "Import from Drive failed");
    }
    return { forms: result.forms || [], skipped: result.skipped || 0 };
  } catch (error) {
    console.error("[gasClient] importFormsFromDrive failed", error);
    throw error;
  }
};
