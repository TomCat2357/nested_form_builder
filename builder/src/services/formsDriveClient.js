import { callScriptFunction, hasScriptRun } from "./gasClient.js";

export const loadFormsFromDrive = async () => {
  if (!hasScriptRun()) throw new Error("google.script.run is not available");
  const result = await callScriptFunction("nfbLoadFormsFromDrive");
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Driveからフォームを取得できませんでした");
  }
  return {
    forms: Array.isArray(result.forms) ? result.forms : [],
    fileUrl: result.fileUrl || "",
  };
};

export const saveFormsToDrive = async ({ forms, fileUrl } = {}) => {
  if (!hasScriptRun()) throw new Error("google.script.run is not available");
  const payload = {
    forms: Array.isArray(forms) ? forms : [],
    fileUrl,
  };
  const result = await callScriptFunction("nfbSaveFormsToDrive", payload);
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Driveへの保存に失敗しました");
  }
  return {
    fileUrl: result.fileUrl || "",
    count: Number.isFinite(result.count) ? result.count : payload.forms.length,
  };
};

export const importFormsFromDrive = async ({ targetUrl } = {}) => {
  if (!hasScriptRun()) throw new Error("google.script.run is not available");
  const result = await callScriptFunction("nfbImportFormsFromDrive", { targetUrl });
  if (!result || result.ok === false) {
    throw new Error(result?.error || "Driveからのインポートに失敗しました");
  }
  return {
    forms: Array.isArray(result.forms) ? result.forms : [],
    files: Array.isArray(result.files) ? result.files : [],
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
  };
};
